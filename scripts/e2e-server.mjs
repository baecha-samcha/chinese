import { spawnSync, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
const state = ".wrangler/e2e-state";
await rm(state, { recursive: true, force: true });
for (const args of [
  ["d1", "migrations", "apply", "ch-study", "--local", "--persist-to", state],
  [
    "d1",
    "execute",
    "ch-study",
    "--local",
    "--persist-to",
    state,
    "--file=fixtures/seed.sql",
  ],
]) {
  const r = spawnSync("npx", ["wrangler", ...args], { stdio: "inherit" });
  if (r.status) process.exit(r.status);
}
const child = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--name",
    "ch-study-e2e",
    "--ip",
    "127.0.0.1",
    "--port",
    "8788",
    "--host",
    "127.0.0.1:8788",
    "--persist-to",
    state,
    "--var",
    "LOCAL_DEV:true",
  ],
  { stdio: "inherit" },
);
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (c) => process.exit(c || 0));
