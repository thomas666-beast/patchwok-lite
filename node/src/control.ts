// Patchwork Lite — local control channel
// The node exposes a tiny line-based JSON control socket on localhost.
// One node → one port. Multiple nodes → multiple ports.
// The Vue client (Task 9) will talk to this same socket.

import net from "node:net";

export type ControlHandler = (
  cmd: string,
  args: string[],
) => Promise<unknown> | unknown;

export function startControlServer(port: number, handler: ControlHandler) {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const result = await handler(msg.cmd, msg.args ?? []);
          socket.write(JSON.stringify({ ok: true, result }) + "\n");
        } catch (err) {
          socket.write(
            JSON.stringify({ ok: false, error: (err as Error).message }) + "\n",
          );
        }
      }
    });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[control] listening on 127.0.0.1:${port}`);
  });
  return server;
}
