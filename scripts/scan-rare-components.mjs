// Audits a vocabulary JSON dump for decomposition components outside the BMP
// (the class of character that renders as tofu without the self-hosted CJK
// fallback font - see scripts/cjk-fallback.mjs) and reports any that aren't
// yet in scripts/data/cjk-fallback-known.json, so the font actually vendored
// by `npm run vendor` stays in sync with real data.
//
// Usage:
//   node scripts/scan-rare-components.mjs fixtures/data.json
//   node scripts/scan-rare-components.mjs /tmp/export.json
//   npx wrangler d1 execute ch-study --remote --json \
//     --command "SELECT char, decomposition FROM characters WHERE decomposition IS NOT NULL" \
//     > /tmp/prod.json && node scripts/scan-rare-components.mjs /tmp/prod.json
//
// Accepts either the app's /api/export shape ({ vocabulary: [...] }) or a
// raw `wrangler d1 execute --json` result array - format is auto-detected.
import { readFileSync } from "node:fs";
import {
  loadKnownRareChars,
  blockFileFor,
  rareCharsInVocabulary,
} from "./cjk-fallback.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/scan-rare-components.mjs <file.json>");
  process.exit(2);
}
const raw = JSON.parse(readFileSync(path, "utf8"));
const vocabulary = Array.isArray(raw)
  ? [
      {
        characters: raw
          .flatMap((batch) => batch.results || [])
          .map((row) => ({
            ...row,
            decomposition:
              typeof row.decomposition === "string"
                ? JSON.parse(row.decomposition)
                : row.decomposition,
          })),
      },
    ]
  : (raw.vocabulary ?? []);

const found = rareCharsInVocabulary(vocabulary);
const known = new Set(loadKnownRareChars().chars);
const unknown = [...found].filter((ch) => !known.has(ch));

console.log(`Scanned ${vocabulary.length} vocabulary entr(y/ies).`);
console.log(`Rare (non-BMP) components found: ${found.size}`);
for (const ch of found) {
  const cp = ch.codePointAt(0).toString(16).toUpperCase();
  const file = blockFileFor(ch) || "NO MANIFEST BLOCK COVERS THIS";
  console.log(
    `  ${ch} (U+${cp}) -> ${file}${known.has(ch) ? "" : "  [NOT in cjk-fallback-known.json]"}`,
  );
}
if (unknown.length) {
  console.log(
    `\n${unknown.length} character(s) need to be added to scripts/data/cjk-fallback-known.json, then rerun \`npm run vendor\`.`,
  );
  process.exit(1);
}
console.log("\nAll rare components are already covered.");
