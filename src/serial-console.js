const {
  EC2InstanceConnectClient,
  SendSerialConsoleSSHPublicKeyCommand,
} = require("@aws-sdk/client-ec2-instance-connect");

const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const REGION = "eu-west-3";
const INSTANCE_ID = "i-07cd9a05a4fb8d592";
const SERIAL_PORT = 0;

const SERIAL_ENDPOINT =
  "serial-console.ec2-instance-connect.eu-west-3.aws";
const CONNECT_TIMEOUT_SECONDS = 15;
const SERIAL_CONSOLE_CONFIG = Object.freeze({
  region: REGION,
  instanceId: INSTANCE_ID,
  serialPort: SERIAL_PORT,
  endpoint: SERIAL_ENDPOINT,
});

function log(message, details = {}) {
  console.info(`[serial-console] ${message}`, details);
}

function safeAwsError(error) {
  return {
    name: error.name,
    code: error.name,
    httpStatusCode: error.$metadata?.httpStatusCode,
    requestId: error.$metadata?.requestId,
    message: error.message,
  };
}

/**
 * Creates an SSH connection to the EC2 serial console.
 *
 * The returned object exposes the SSH process so the caller
 * can listen to stdout/stderr and terminate the connection.
 */
async function connectSerialConsole() {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "ec2-serial-")
  );

  const privateKeyPath = path.join(tempDir, "serial-key");
  const publicKeyPath = `${privateKeyPath}.pub`;

  let ssh;

  try {
    // Generate one temporary key pair and use its matching halves throughout.
    await generateKeyPair(privateKeyPath);

    const publicKey = fs
      .readFileSync(publicKeyPath, "utf8")
      .trim();

    const fingerprint = crypto
      .createHash("sha256")
      .update(Buffer.from(publicKey.split(" ")[1], "base64"))
      .digest("base64")
      .replace(/=+$/, "");
    const keyFingerprint = `SHA256:${fingerprint}`;
    log("Temporary ED25519 key generated", { fingerprint: keyFingerprint });

    // Register the exact public key paired with privateKeyPath.
    const client = new EC2InstanceConnectClient({
      region: REGION,
    });

    const command = new SendSerialConsoleSSHPublicKeyCommand({
      InstanceId: INSTANCE_ID,
      SerialPort: SERIAL_PORT,
      SSHPublicKey: publicKey,
    });

    const registrationStartedAt = Date.now();
    log("Registering serial-console public key", {
      instanceId: INSTANCE_ID,
      region: REGION,
      serialPort: SERIAL_PORT,
      fingerprint: keyFingerprint,
    });

    let response;
    try {
      response = await client.send(command);
    } catch (error) {
      console.error("[serial-console] AWS key registration failed", {
        ...safeAwsError(error),
        durationMs: Date.now() - registrationStartedAt,
      });
      throw new Error(`AWS serial-console key registration failed (${error.name || "unknown AWS error"})`, { cause: error });
    }

    log("AWS key registration completed", {
      durationMs: Date.now() - registrationStartedAt,
      success: response.Success === true,
      requestId: response.$metadata?.requestId,
    });

    if (!response.Success) {
      console.error("[serial-console] AWS did not authorize the public key", {
        requestId: response.$metadata?.requestId,
        instanceId: INSTANCE_ID,
        region: REGION,
        serialPort: SERIAL_PORT,
      });
      throw new Error(
        "AWS rejected the serial-console public key (Success was false). Check IAM permissions, instance state, serial-console access, and active-session limits."
      );
    }

    // Connect using the exact SSH invocation that we validated.
    ssh = spawn(
      "ssh",
      [
        // The serial console is an interactive terminal. SSH sees piped stdio
        // from Node, so force a PTY instead of relying on local TTY detection.
        "-tt",
        "-v",
        "-i",
        privateKeyPath,
        "-o", "IdentitiesOnly=yes",
        "-o", "BatchMode=yes",
        "-o", "PreferredAuthentications=publickey",
        "-o", "PasswordAuthentication=no",
        "-o", `ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
        `${INSTANCE_ID}.port${SERIAL_PORT}@${SERIAL_ENDPOINT}`,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    log("SSH process started", {
      pid: ssh.pid,
      instanceId: INSTANCE_ID,
      region: REGION,
      serialPort: SERIAL_PORT,
      connectTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
      fingerprint: keyFingerprint,
    });

    const cleanup = () => {
      try {
        fs.rmSync(tempDir, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        console.error(
          "Failed to remove temporary serial-console key:",
          error
        );
      }
    };

    ssh.on("close", cleanup);
    ssh.on("error", cleanup);
    ssh.on("close", (code, signal) => {
      log("SSH process closed", { code, signal, fingerprint: keyFingerprint });
    });
    ssh.on("error", (error) => {
      console.error("[serial-console] SSH process error", {
        message: error.message,
        code: error.code,
        fingerprint: keyFingerprint,
      });
    });

    return {
      process: ssh,

      /**
       * Send keyboard input to the serial console.
       */
      write(data) {
        if (!ssh.stdin.destroyed && ssh.stdin.writable) {
          ssh.stdin.write(data);
          return true;
        }
        return false;
      },

      /**
       * Close the SSH serial-console connection.
       */
      close() {
        if (!ssh.killed) {
          ssh.kill("SIGTERM");
        }
      },
    };
  } catch (error) {
    console.error("[serial-console] Connection setup failed", {
      message: error.message,
    });
    try {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    } catch {}

    throw error;
  }
}

function generateKeyPair(privateKeyPath) {
  return new Promise((resolve, reject) => {
    const sshKeygen = execFile(
      "ssh-keygen",
      [
        "-t",
        "ed25519",
        "-f",
        privateKeyPath,
        "-N",
        "",
        "-C",
        `ec2-serial-${crypto.randomUUID()}`,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stderr = "";

    sshKeygen.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    sshKeygen.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `ssh-keygen failed with code ${code}: ${stderr}`
          )
        );
      }
    });

    sshKeygen.on("error", reject);
  });
}

module.exports = {
  connectSerialConsole,
  SERIAL_CONSOLE_CONFIG,
};
