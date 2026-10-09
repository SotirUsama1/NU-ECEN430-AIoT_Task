const { spawn } = require("child_process");

const ssh = spawn(
  "ssh",
  [
    "-i",
    "/tmp/aws-serial-test/key",
    "i-07cd9a05a4fb8d592.port0@serial-console.ec2-instance-connect.eu-west-3.aws",
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
