// Regenerates scripts/data/hanamin-blocks.json from the installed
// @vp-tw/cjk-web-fonts-hanamin package's HanaMinB unicode-range CSS. Run this
// again after upgrading that package in case its chunking changes.
import { readFileSync, writeFileSync } from "node:fs";
const css = readFileSync(
  "node_modules/@vp-tw/cjk-web-fonts-hanamin/dist/HanaMinB/HanaMin.css",
  "utf8",
);
const blocks = [];
const re = /url\(([^)]+)\)[^;]*;\s*\n\s*unicode-range:\s*([^;]+);/g;
let m;
while ((m = re.exec(css))) {
  const ranges = m[2].split(",").map((p) => {
    p = p.trim();
    if (p.includes("-")) {
      const [a, b] = p.replace(/U\+/g, "").split("-");
      return [parseInt(a, 16), parseInt(b, 16)];
    }
    const v = parseInt(p.replace("U+", ""), 16);
    return [v, v];
  });
  blocks.push({ file: m[1], ranges });
}
writeFileSync(
  "scripts/data/hanamin-blocks.json",
  JSON.stringify(blocks, null, 1) + "\n",
);
console.log(`Wrote ${blocks.length} block entries.`);
