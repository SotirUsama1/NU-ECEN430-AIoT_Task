const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const pty = require("node-pty");

function loadDashboardRuntimeConfig() {
  const configPath = path.join(__dirname, "..", "dashboard.env");
  let contents;
  try {
    contents = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  const runtimeKeys = new Set([
    "AWS_REGION",
    "AWS_PROFILE",
    "EC2_INSTANCE_ID",
    "EC2_SERIAL_PORT",
    "BROWSER_SSH_TARGET",
    "BROWSER_SSH_KEY_PATH",
  ]);
  for (const line of contents.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (runtimeKeys.has(key)) process.env[key] = line.slice(separator + 1).trim();
  }
}

loadDashboardRuntimeConfig();

const {
  EC2Client,
  DescribeInstancesCommand,
  DescribeInstanceStatusCommand,
  GetSerialConsoleAccessStatusCommand,
  RebootInstancesCommand,
} = require("@aws-sdk/client-ec2");
const {
  CloudWatchClient,
  GetMetricDataCommand,
  ListMetricsCommand,
} = require("@aws-sdk/client-cloudwatch");

const {
  connectSerialConsole,
  SERIAL_CONSOLE_CONFIG,
} = require("./serial-console");

const PORT = 3001;
const HOST = process.env.DASHBOARD_HOST?.trim() || "127.0.0.1";
const { region: REGION, instanceId: INSTANCE_ID, serialPort: SERIAL_PORT } = SERIAL_CONSOLE_CONFIG;
const BROWSER_SSH_TARGET = process.env.BROWSER_SSH_TARGET?.trim();
const BROWSER_SSH_KEY_PATH = process.env.BROWSER_SSH_KEY_PATH?.trim();
const MAX_SSH_INPUT_LENGTH = 512 * 1024;
const MAX_SERIAL_INPUT_LENGTH = 4096;
const DASHBOARD_REFRESH_MS = 30_000;

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  maxPayload: 1024 * 1024,
});

const ec2Client = new EC2Client({ region: REGION });
const cloudWatchClient = new CloudWatchClient({ region: REGION });

app.use("/vendor/xterm", express.static(path.join(__dirname, "..", "node_modules", "@xterm", "xterm", "lib")));
app.use("/vendor/xterm-css", express.static(path.join(__dirname, "..", "node_modules", "@xterm", "xterm", "css")));
app.use("/vendor/fit", express.static(path.join(__dirname, "..", "node_modules", "@xterm", "addon-fit", "lib")));
app.use(express.static("public"));

let serialConnection = null;
let serialConsoleAuthenticated = false;
let serialStarting = false;
let serialReconnectTimer = null;
let serialReconnectAttempt = 0;
let serialReconnectRequested = false;
const sshSessions = new Map();
let dashboardRefresh = null;

function scheduleSerialReconnect() {
  if (!serialReconnectRequested || serialReconnectTimer || wss.clients.size === 0) return;
  const delayMs = Math.min(5_000 * (2 ** serialReconnectAttempt), 60_000);
  serialReconnectAttempt = Math.min(serialReconnectAttempt + 1, 4);
  sendStatus(`Serial console reconnecting in ${Math.ceil(delayMs / 1000)} seconds...`);
  serialReconnectTimer = setTimeout(() => {
    serialReconnectTimer = null;
    if (wss.clients.size > 0) startSerialConsole();
  }, delayMs);
  serialReconnectTimer.unref();
}

function broadcast(data) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, (error) => {
        if (error) console.error("WebSocket send failed:", error.message);
      });
    }
  }
}

function sendStatus(message) {
  broadcast(JSON.stringify({ type: "status", message }));
}

function sendToClient(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message), (error) => {
      if (error) console.error("WebSocket send failed:", error.message);
    });
  }
}

function latestMetricValue(metricResults, id) {
  const metric = metricResults?.find((result) => result.Id === id);
  if (!metric?.Values?.length) return null;
  let latestIndex = 0;
  for (let index = 1; index < metric.Values.length; index++) {
    if (metric.Timestamps[index] > metric.Timestamps[latestIndex]) latestIndex = index;
  }
  return metric.Values[latestIndex];
}

function metricSeries(metricResults, id, divisor = 1) {
  const metric = metricResults?.find((result) => result.Id === id);
  if (!metric?.Values?.length) return [];
  return metric.Values.map((value, index) => ({
    timestamp: metric.Timestamps[index]?.toISOString(),
    value: value / divisor,
  })).filter((point) => point.timestamp && Number.isFinite(point.value))
    .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

async function findAgentMetric(metricName, { rootOnly = false } = {}) {
  let nextToken;
  const matches = [];
  for (let page = 0; page < 5; page++) {
    const response = await cloudWatchClient.send(new ListMetricsCommand({
      Namespace: "CWAgent",
      MetricName: metricName,
      Dimensions: [{ Name: "InstanceId", Value: INSTANCE_ID }],
      NextToken: nextToken,
    }));
    matches.push(...(response.Metrics || []));
    nextToken = response.NextToken;
    if (!nextToken) break;
  }

  const instanceMetrics = matches.filter((metric) =>
    metric.Dimensions?.some((dimension) => dimension.Name === "InstanceId" && dimension.Value === INSTANCE_ID)
  );
  if (rootOnly) {
    return instanceMetrics.find((metric) =>
      metric.Dimensions?.some((dimension) => dimension.Name.toLowerCase() === "path" && dimension.Value === "/")
    ) || null;
  }
  return instanceMetrics[0] || null;
}

async function fetchCloudWatchMetrics(ec2PeriodSeconds = 300) {
  const startTime = new Date(Date.now() - 30 * 60 * 1000);
  const endTime = new Date();
  const definitions = [
    { Id: "cpu", Namespace: "AWS/EC2", MetricName: "CPUUtilization", Stat: "Average", Period: ec2PeriodSeconds },
    { Id: "network_in", Namespace: "AWS/EC2", MetricName: "NetworkIn", Stat: "Sum", Period: ec2PeriodSeconds },
    { Id: "network_out", Namespace: "AWS/EC2", MetricName: "NetworkOut", Stat: "Sum", Period: ec2PeriodSeconds },
  ];

  const [memoryResult, diskResult] = await Promise.allSettled([
    findAgentMetric("mem_used_percent"),
    findAgentMetric("disk_used_percent", { rootOnly: true }),
  ]);
  const memoryMetric = memoryResult.status === "fulfilled" ? memoryResult.value : null;
  const diskMetric = diskResult.status === "fulfilled" ? diskResult.value : null;

  if (memoryMetric) definitions.push({
    Id: "memory", Namespace: "CWAgent", MetricName: "mem_used_percent",
    Stat: "Average", Dimensions: memoryMetric.Dimensions, Period: 60,
  });
  if (diskMetric) definitions.push({
    Id: "disk", Namespace: "CWAgent", MetricName: "disk_used_percent",
    Stat: "Average", Dimensions: diskMetric.Dimensions, Period: 60,
  });

  const response = await cloudWatchClient.send(new GetMetricDataCommand({
    StartTime: startTime,
    EndTime: endTime,
    ScanBy: "TimestampDescending",
    MetricDataQueries: definitions.map((definition) => ({
      Id: definition.Id,
      ReturnData: true,
      MetricStat: {
        Metric: {
          Namespace: definition.Namespace,
          MetricName: definition.MetricName,
          Dimensions: definition.Dimensions || [{ Name: "InstanceId", Value: INSTANCE_ID }],
        },
        Period: definition.Period,
        Stat: definition.Stat,
      },
    })),
  }));

  return {
    cpuPercent: latestMetricValue(response.MetricDataResults, "cpu"),
    memoryPercent: latestMetricValue(response.MetricDataResults, "memory"),
    diskPercent: latestMetricValue(response.MetricDataResults, "disk"),
    networkInBytesPerSecond: (() => {
      const value = latestMetricValue(response.MetricDataResults, "network_in");
      return value === null ? null : value / ec2PeriodSeconds;
    })(),
    networkOutBytesPerSecond: (() => {
      const value = latestMetricValue(response.MetricDataResults, "network_out");
      return value === null ? null : value / ec2PeriodSeconds;
    })(),
    series: {
      cpu: metricSeries(response.MetricDataResults, "cpu"),
      memory: metricSeries(response.MetricDataResults, "memory"),
      disk: metricSeries(response.MetricDataResults, "disk"),
      networkIn: metricSeries(response.MetricDataResults, "network_in", ec2PeriodSeconds),
      networkOut: metricSeries(response.MetricDataResults, "network_out", ec2PeriodSeconds),
    },
    historyMinutes: 30,
    agentPeriodSeconds: 60,
    ec2PeriodSeconds,
    timestamp: response.MetricDataResults?.flatMap((result) => result.Timestamps || [])
      .sort((left, right) => right - left)[0] || null,
    agentConfigured: Boolean(memoryMetric || diskMetric),
    agentDiscoveryError: memoryResult.status === "rejected" || diskResult.status === "rejected",
  };
}

async function refreshDashboard() {
  if (dashboardRefresh) return dashboardRefresh;

  dashboardRefresh = (async () => {
    const [instanceResult, statusResult, serialResult] = await Promise.allSettled([
      ec2Client.send(new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] })),
      ec2Client.send(new DescribeInstanceStatusCommand({ InstanceIds: [INSTANCE_ID], IncludeAllInstances: true })),
      ec2Client.send(new GetSerialConsoleAccessStatusCommand({})),
    ]);
    const instance = instanceResult.status === "fulfilled"
      ? instanceResult.value.Reservations?.flatMap((reservation) => reservation.Instances || [])
        .find((item) => item.InstanceId === INSTANCE_ID)
      : null;
    const ec2PeriodSeconds = instance?.Monitoring?.State === "enabled" ? 60 : 300;
    const [metricsResult] = await Promise.allSettled([fetchCloudWatchMetrics(ec2PeriodSeconds)]);
    const instanceStatus = statusResult.status === "fulfilled"
      ? statusResult.value.InstanceStatuses?.find((item) => item.InstanceId === INSTANCE_ID)
      : null;
    const serialEnabled = serialResult.status === "fulfilled"
      ? serialResult.value.SerialConsoleAccessEnabled
      : null;
    const data = {
      config: {
        region: REGION,
        instanceId: INSTANCE_ID,
        serialPort: SERIAL_PORT,
        refreshIntervalSeconds: DASHBOARD_REFRESH_MS / 1000,
        sshConfigured: Boolean(BROWSER_SSH_TARGET),
      },
      instance: instance ? {
        id: instance.InstanceId,
        state: instance.State?.Name || "unknown",
        region: REGION,
        availabilityZone: instance.Placement?.AvailabilityZone || null,
        type: instance.InstanceType || null,
        ami: instance.ImageId || null,
        keyName: instance.KeyName || null,
        launchTime: instance.LaunchTime?.toISOString() || null,
      } : null,
      checks: {
        instance: instanceStatus?.InstanceStatus?.Status || "unknown",
        system: instanceStatus?.SystemStatus?.Status || "unknown",
        instanceReachability: instanceStatus?.InstanceStatus?.Details?.find((detail) => detail.Name === "reachability")?.Status || "unknown",
        systemReachability: instanceStatus?.SystemStatus?.Details?.find((detail) => detail.Name === "reachability")?.Status || "unknown",
      },
      serialConsoleEnabled: serialEnabled,
      metrics: metricsResult.status === "fulfilled" ? metricsResult.value : null,
      errors: {
        instance: instanceResult.status === "rejected" ? instanceResult.reason.name : null,
        checks: statusResult.status === "rejected" ? statusResult.reason.name : null,
        serialConsole: serialResult.status === "rejected" ? serialResult.reason.name : null,
        metrics: metricsResult.status === "rejected" ? metricsResult.reason.name : null,
      },
      updatedAt: new Date().toISOString(),
    };
    broadcast(JSON.stringify({ type: "dashboard-data", data }));
    return data;
  })();

  try {
    return await dashboardRefresh;
  } finally {
    dashboardRefresh = null;
  }
}

async function rebootInstance(socket, requestedInstanceId) {
  if (requestedInstanceId !== INSTANCE_ID) {
    sendToClient(socket, { type: "reboot-result", success: false, message: "Instance ID did not match the configured instance." });
    return;
  }
  try {
    await ec2Client.send(new RebootInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
    broadcast(JSON.stringify({ type: "reboot-result", success: true, message: `Reboot request sent for ${INSTANCE_ID}.` }));
    setTimeout(() => refreshDashboard(), 5_000).unref();
  } catch (error) {
    console.error("EC2 reboot request failed:", { name: error.name, requestId: error.$metadata?.requestId });
    sendToClient(socket, {
      type: "reboot-result",
      success: false,
      message: `Reboot failed (${error.name || "AWS error"}). Check ec2:RebootInstances permission and instance state.`,
    });
  }
}

function startBrowserSsh(socket, cols = 80, rows = 24) {
  if (sshSessions.has(socket)) {
    sendToClient(socket, { type: "ssh-status", message: "SSH shell is already running." });
    return;
  }

  // The destination is server configuration, never a value supplied by a browser.
  if (!BROWSER_SSH_TARGET || BROWSER_SSH_TARGET.startsWith("-") || /\s/.test(BROWSER_SSH_TARGET)) {
    sendToClient(socket, {
      type: "ssh-status",
      message: "SSH shell is not configured. Set BROWSER_SSH_TARGET to a trusted SSH alias or user@host and restart the dashboard.",
    });
    return;
  }

  console.log(`Starting browser SSH shell for configured target ${BROWSER_SSH_TARGET}.`);
  const sshEnv = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
    SSH_AGENT_PID: process.env.SSH_AGENT_PID,
    TERM: "xterm-256color",
  };
  for (const [key, value] of Object.entries(sshEnv)) {
    if (value === undefined) delete sshEnv[key];
  }

  let ssh;
  try {
    const sshArgs = [
      "-tt",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=15",
      "-o", "ClearAllForwardings=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "CheckHostIP=no",
      "-o", "UserKnownHostsFile=/run/dashboard-ssh/known_hosts",
      "-o", `HostKeyAlias=ec2-dashboard-${REGION}-${INSTANCE_ID}`,
    ];
    if (BROWSER_SSH_KEY_PATH) {
      const identityFile = BROWSER_SSH_KEY_PATH === "~"
        ? process.env.HOME
        : BROWSER_SSH_KEY_PATH.startsWith("~/")
          ? path.join(process.env.HOME || "", BROWSER_SSH_KEY_PATH.slice(2))
          : path.resolve(BROWSER_SSH_KEY_PATH);
      sshArgs.push("-i", identityFile, "-o", "IdentitiesOnly=yes");
    }
    sshArgs.push("--", BROWSER_SSH_TARGET);

    ssh = pty.spawn("ssh", sshArgs, {
      name: "xterm-256color",
      cols: Math.max(20, Math.min(300, Number(cols) || 80)),
      rows: Math.max(5, Math.min(120, Number(rows) || 24)),
      cwd: process.env.HOME,
      env: sshEnv,
    });
  } catch (error) {
    console.error("Could not start browser SSH terminal:", error.message);
    sendToClient(socket, { type: "ssh-status", message: `Could not start SSH terminal: ${error.message}` });
    return;
  }
  sshSessions.set(socket, ssh);
  sendToClient(socket, { type: "ssh-status", message: "SSH terminal started." });

  ssh.onData((data) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 2 * 1024 * 1024) {
      sendToClient(socket, { type: "ssh-status", message: "SSH terminal closed because the browser could not keep up with its output." });
      stopBrowserSsh(socket);
      return;
    }
    sendToClient(socket, { type: "ssh-output", data });
  });
  ssh.onExit(({ exitCode, signal }) => {
    if (sshSessions.get(socket) === ssh) sshSessions.delete(socket);
    console.log(`Browser SSH shell closed. code=${exitCode}, signal=${signal}`);
    sendToClient(socket, { type: "ssh-status", message: `SSH shell closed (code=${exitCode}, signal=${signal || "none"}).` });
  });
}

function stopBrowserSsh(socket) {
  const ssh = sshSessions.get(socket);
  if (!ssh) return;
  try {
    ssh.kill();
  } catch (error) {
    console.error("Could not stop browser SSH terminal:", error.message);
  }
}

async function startSerialConsole() {
  if (serialConnection || serialStarting) {
    return;
  }

  if (serialReconnectTimer) {
    clearTimeout(serialReconnectTimer);
    serialReconnectTimer = null;
  }

  serialConsoleAuthenticated = false;
  serialStarting = true;

  try {
    console.log("Starting EC2 serial console...");
    sendStatus("Registering temporary SSH key with AWS...");

    serialConnection = await connectSerialConsole();

    const ssh = serialConnection.process;

    console.log("Serial console SSH process started.");
    sendStatus("SSH started; waiting for serial-console authentication...");

    let authenticated = false;
    let stderrTail = "";
    let authFailureReported = false;
    let networkFailureReported = false;
    const authWatchdog = setTimeout(() => {
      if (!authenticated) {
        console.warn("SSH has not reported authentication success after 25 seconds; keeping the process alive for diagnosis.");
        sendStatus("Still waiting for SSH authentication; the connection remains open for diagnosis.");
      }
    }, 25_000);
    authWatchdog.unref();

    ssh.stdout.on("data", (data) => {
      console.info(`[SERIAL] received ${data.length} bytes; forwarding to ${wss.clients.size} WebSocket client(s)`);
      if (process.env.SERIAL_LOG_DATA === "1") {
        console.info("[SERIAL data]", JSON.stringify(data.toString()));
      }
      broadcast(JSON.stringify({ type: "serial", data: data.toString() }));
    });

    ssh.stderr.on("data", (data) => {
      const text = data.toString();
      // SSH diagnostics stay out of the boot-log stream. Retain a short tail
      // to classify failures without exposing diagnostic text to browsers.
      stderrTail = (stderrTail + text).slice(-8192);
      console.info(`[SSH] received ${data.length} diagnostic bytes`);
      if (process.env.SERIAL_SSH_DEBUG === "1") {
        console.info("[SSH diagnostic]", text.trimEnd());
      }
      if (!authenticated && /Authenticated to .* using "publickey"/i.test(stderrTail)) {
        authenticated = true;
        serialConsoleAuthenticated = true;
        serialReconnectRequested = true;
        serialReconnectAttempt = 0;
        clearTimeout(authWatchdog);
        console.log("SSH public-key authentication succeeded; serial stream is open.");
        sendStatus("Authenticated; waiting for serial-console output.");
      }
      if (!authFailureReported && /Permission denied \(publickey\)/i.test(stderrTail)) {
        authFailureReported = true;
        console.error("SSH public-key authentication failed.");
        sendStatus("SSH authentication failed. Check the registered key, IAM/instance eligibility, and authorization timing.");
      }
      if (!networkFailureReported && /Connection timed out|Operation timed out|Could not resolve hostname|No route to host|Connection refused/i.test(stderrTail)) {
        networkFailureReported = true;
        console.error("SSH could not establish the network connection.");
        sendStatus("SSH connection failed before authentication. Check endpoint reachability and network access.");
      }
    });

    ssh.on("close", (code, signal) => {
      clearTimeout(authWatchdog);
      console.log(
        `Serial console closed. code=${code}, signal=${signal}`
      );

      if (authenticated && code === 0) {
        sendStatus("Authenticated serial session ended.");
      } else if (authenticated) {
        sendStatus(`Authenticated serial session ended (code=${code}, signal=${signal || "none"}).`);
      } else if (!/Permission denied \(publickey\)/i.test(stderrTail)) {
        sendStatus(`SSH ended before authentication (code=${code}, signal=${signal || "none"}).`);
      }

      serialConnection = null;
      serialConsoleAuthenticated = false;

      sendStatus("Serial console disconnected.");
      if (authenticated) serialReconnectRequested = true;
      scheduleSerialReconnect();
    });

    ssh.on("error", (error) => {
      console.error("Serial SSH error:", error);
    });
  } catch (error) {
    serialConsoleAuthenticated = false;
    console.error(
      "Failed to start serial console:",
      error
    );

    sendStatus(`Serial console setup failed: ${error.message}`);
    scheduleSerialReconnect();
  } finally {
    serialStarting = false;
  }
}

wss.on("connection", (socket, request) => {
  const origin = request.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.host) {
        socket.close(1008, "WebSocket origin is not allowed");
        return;
      }
    } catch {
      socket.close(1008, "Invalid WebSocket origin");
      return;
    }
  }

  console.log("Browser connected.");

  socket.send(JSON.stringify({
    type: "status",
    message: serialConsoleAuthenticated
      ? "Authenticated; waiting for serial-console output."
      : "Connected to dashboard; starting serial-console connection.",
  }));

  socket.on("message", (message) => {
    let request;
    try {
      request = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (request.type === "ssh-start") {
      startBrowserSsh(socket, request.cols, request.rows);
    } else if (request.type === "ssh-stop") {
      stopBrowserSsh(socket);
    } else if (request.type === "ssh-input" && typeof request.data === "string") {
      const ssh = sshSessions.get(socket);
      if (ssh && request.data.length <= MAX_SSH_INPUT_LENGTH) {
        ssh.write(request.data);
      }
    } else if (request.type === "serial-input" && typeof request.data === "string") {
      if (request.data.length > MAX_SERIAL_INPUT_LENGTH) {
        sendToClient(socket, { type: "serial-input-result", success: false, message: "Serial input is too long (maximum 4096 characters)." });
      } else if (!serialConnection || !serialConsoleAuthenticated) {
        sendToClient(socket, { type: "serial-input-result", success: false, message: "The serial console is not authenticated yet." });
      } else {
        try {
          const written = serialConnection.write(request.data);
          sendToClient(socket, {
            type: "serial-input-result",
            success: written,
            message: written ? `Sent ${request.data.length} character${request.data.length === 1 ? "" : "s"} to the serial console.` : "The serial-console input stream is closed.",
          });
        } catch (error) {
          console.error("Could not write to the serial console:", error.message);
          sendToClient(socket, { type: "serial-input-result", success: false, message: "Could not write to the serial console." });
        }
      }
    } else if (request.type === "ssh-resize") {
      const ssh = sshSessions.get(socket);
      const cols = Number(request.cols);
      const rows = Number(request.rows);
      if (ssh && Number.isInteger(cols) && Number.isInteger(rows) && cols >= 20 && cols <= 300 && rows >= 5 && rows <= 120) {
        ssh.resize(cols, rows);
      }
    } else if (request.type === "refresh-dashboard") {
      refreshDashboard();
    } else if (request.type === "reboot-instance") {
      rebootInstance(socket, request.instanceId);
    }
  });

  socket.on("close", () => {
    stopBrowserSsh(socket);
    console.log("Browser disconnected.");
  });

  startSerialConsole();
  refreshDashboard();
});

server.listen(PORT, HOST, () => {
  console.log(
    `Dashboard running at http://localhost:${PORT} (bound to ${HOST})`
  );
});

setInterval(() => {
  if (wss.clients.size > 0) refreshDashboard();
}, DASHBOARD_REFRESH_MS).unref();
