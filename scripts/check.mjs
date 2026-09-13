import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
for (const f of await readdir("public/js"))
  if (f.endsWith(".js")) {
    const r = spawnSync(process.execPath, ["--check", `public/js/${f}`], {
      stdio: "inherit",
    });
    if (r.status) process.exit(r.status);
  }
const r = spawnSync("node", ["node_modules/typescript/bin/tsc", "--noEmit"], {
  stdio: "inherit",
});
process.exit(r.status || 0);
