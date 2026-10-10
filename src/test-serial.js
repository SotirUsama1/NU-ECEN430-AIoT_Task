const { spawn } = require("child_process");
const { SERIAL_CONSOLE_CONFIG } = require("./serial-console");

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
  console.log("[STDOUT]", JSON.stringify(data.toString()));
});

ssh.stderr.on("data", (data) => {
  console.log("[STDERR]", JSON.stringify(data.toString()));
});

ssh.on("error", (error) => {
  console.error("SSH process error:", error);
});

ssh.on("close", (code, signal) => {
  console.log(`SSH closed. code=${code}, signal=${signal}`);
});
