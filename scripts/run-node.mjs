import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const name = process.argv[2];
if (!name) {
  console.error("usage: npm run node <peerName>");
  process.exit(1);
}

const env = loadEnv("nodes", name);
console.log(`[run-node] starting ${name}`, env);

const child = spawn("npm", ["run", "start"], {
  cwd: resolve(ROOT, "node"),
  env: { ...process.env, ...env },
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
