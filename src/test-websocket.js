const { spawn } = require("child_process");
const http = require("http");
const WebSocket = require("ws");
const { SERIAL_CONSOLE_CONFIG } = require("./serial-console");

const PORT = 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html",
  });

  res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>EC2 Boot Log Test</title>
</head>

<body>
  <h1>EC2 Serial Console</h1>

  <pre id="logs"></pre>

  <script>
    const logs = document.getElementById("logs");

    const socket = new WebSocket("ws://localhost:${PORT}");

    socket.onopen = () => {
      logs.textContent += "[WebSocket connected]\\\\n";
    };

    socket.onmessage = (event) => {
      logs.textContent += event.data;
      logs.scrollTop = logs.scrollHeight;
    };

    socket.onerror = (error) => {
      logs.textContent += "\\\\n[WebSocket error]\\\\n";
      console.error(error);
    };

    socket.onclose = () => {
      logs.textContent += "\\\\n[WebSocket closed]\\\\n";
    };
  </script>
</body>
</html>
  `);
});

const wss = new WebSocket.Server({
  server,
});

wss.on("connection", (socket) => {
  console.log("Browser connected to WebSocket.");

  socket.on("close", () => {
    console.log("Browser disconnected.");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard test server running at http://localhost:${PORT}`);
});

const ssh = spawn(
  "ssh",
  [
    "-i",
    "/tmp/aws-serial-test/key",
    `${SERIAL_CONSOLE_CONFIG.instanceId}.port${SERIAL_CONSOLE_CONFIG.serialPort}@${SERIAL_CONSOLE_CONFIG.endpoint}`,
  ],
  {
    stdio: ["inherit", "pipe", "pipe"],
  }
);

ssh.stdout.on("data", (data) => {
  const text = data.toString();

  console.log("[SERIAL]", JSON.stringify(text));

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  }
});

ssh.stderr.on("data", (data) => {
  console.error("[SSH]", data.toString());
});

ssh.on("close", (code, signal) => {
  console.log(`SSH closed. code=${code}, signal=${signal}`);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  }

  server.close();
});
