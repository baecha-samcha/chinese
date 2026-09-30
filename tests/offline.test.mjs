import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
const sw = await readFile("public/sw.js", "utf8");
const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
test("service worker precaches every module the learning app statically imports", async () => {
  const seen = new Set(), queue = ["app.js"];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = await readFile(`public/js/${file}`, "utf8");
    for (const [, dep] of src.matchAll(/^import[\s\S]*?from\s+"\.\/([^"]+)"/gm)) queue.push(dep);
  }
  for (const file of seen) assert.ok(shell.includes(`/js/${file}`), `${file} missing from SHELL`);
  assert.ok(!shell.includes("/js/admin.js"), "admin needs the server and should not be precached");
});
test("every precached and manifest file exists in public/", async () => {
  const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
  for (const url of [...shell, ...manifest.icons.map((i) => i.src)])
    if (url !== "/") await access(`public${url}`);
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
});
