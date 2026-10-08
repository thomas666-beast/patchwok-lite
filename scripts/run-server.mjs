import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const name = process.argv[2];
if (!name) {
  console.error("usage: npm run server <serverName>");
  process.exit(1);
}

const env = loadEnv("servers", name);
console.log(`[run-server] starting ${name}`, env);

const child = spawn("npm", ["run", "start"], {
  cwd: resolve(ROOT, "server"),
  env: { ...process.env, ...env },
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
