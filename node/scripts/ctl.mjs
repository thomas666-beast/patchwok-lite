// Usage: node scripts/ctl.mjs <port> <cmd> [args...]
import net from "node:net";

const [port, cmd, ...args] = process.argv.slice(2);
if (!port || !cmd) {
  console.error("usage: ctl.mjs <port> <cmd> [args...]");
  process.exit(1);
}

const socket = net.createConnection({ port: Number(port), host: "127.0.0.1" });
let buffer = "";

socket.on("connect", () => {
  socket.write(JSON.stringify({ cmd, args }) + "\n");
});

socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const res = JSON.parse(line);
    if (res.ok) {
      console.log(JSON.stringify(res.result, null, 2));
    } else {
      console.error("error:", res.error);
    }
    socket.end();
    process.exit(res.ok ? 0 : 1);
  }
});

socket.on("error", (err) => {
  console.error("connection error:", err.message);
  process.exit(1);
});
