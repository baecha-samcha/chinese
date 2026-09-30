// Turns scripts/data/assembly-overrides.json (a reviewed, reasoned list of
// "this specific character shouldn't be an assembly-question target" calls -
// see public/js/validation.js's assemblyEligible for the automatic baseline
// heuristic this overrides) into a SQL file that patches only the
// `assemblyEnabled` key of the matching character inside each vocabulary
// row's `characters` JSON, leaving everything else (decomposition included)
// byte-for-byte untouched. Idempotent: rows already carrying the target
// value are skipped.
//
// Usage (read the current state first, per this project's D1 change process):
//   npx wrangler d1 execute ch-study --remote --json \
//     --command "SELECT id, simplified, pinyin, characters FROM vocabulary" \
//     > /tmp/vocab-export.json
//   node scripts/apply-assembly-review.mjs /tmp/vocab-export.json /tmp/assembly-review.sql
//   npx wrangler d1 execute ch-study --local --file=/tmp/assembly-review.sql   # verify locally first
//   npx wrangler d1 execute ch-study --remote --file=/tmp/assembly-review.sql  # then apply
import { readFileSync, writeFileSync } from "node:fs";
import { validateRow } from "../public/js/validation.js";

const [, , exportPath, outPath] = process.argv;
if (!exportPath || !outPath) {
  console.error(
    "Usage: node scripts/apply-assembly-review.mjs <export.json> <out.sql>",
  );
  process.exit(2);
}
const overrides = JSON.parse(
  readFileSync(
    new URL("./data/assembly-overrides.json", import.meta.url),
    "utf8",
  ),
);
const raw = JSON.parse(readFileSync(exportPath, "utf8"));
const rows = raw.flatMap((batch) => batch.results || []);

const sqlEscape = (s) => `'${s.replace(/'/g, "''")}'`;
const statements = [];
let skipped = 0;

for (const ov of overrides) {
  const row = rows.find(
    (r) => r.simplified === ov.simplified && r.pinyin === ov.pinyin,
  );
  if (!row) {
    console.error(
      `NOT FOUND: ${ov.simplified} (${ov.pinyin}) - is this the right export?`,
    );
    process.exitCode = 1;
    continue;
  }
  const characters = JSON.parse(row.characters);
  const idx = characters.findIndex((c) => c.char === ov.char);
  if (idx < 0) {
    console.error(`Character ${ov.char} not found in ${ov.simplified} (id ${row.id})`);
    process.exitCode = 1;
    continue;
  }
  if (characters[idx].assemblyEnabled === ov.assemblyEnabled) {
    console.log(`Already set: ${ov.simplified} ${ov.char} -> assemblyEnabled=${ov.assemblyEnabled} (skipping)`);
    skipped++;
    continue;
  }
  characters[idx] = { ...characters[idx], assemblyEnabled: ov.assemblyEnabled };
  const patched = { ...row, characters: JSON.stringify(characters) };
  const check = validateRow("vocabulary", patched);
  if (check.status === "ERROR") {
    console.error(`Validation failed for ${ov.simplified}: ${check.errors.join(", ")}`);
    process.exitCode = 1;
    continue;
  }
  statements.push(
    `UPDATE vocabulary SET characters=${sqlEscape(JSON.stringify(characters))}, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=${Number(row.id)};`,
  );
  console.log(`Queued: ${ov.simplified} ${ov.char} -> assemblyEnabled=${ov.assemblyEnabled} (${ov.reason})`);
}

writeFileSync(outPath, statements.join("\n") + (statements.length ? "\n" : ""));
console.log(`\nWrote ${statements.length} statement(s) to ${outPath} (${skipped} already up to date).`);
