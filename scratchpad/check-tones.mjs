import { readFile } from 'node:fs/promises';
import { toneVariants, parseSyllables } from '../public/js/pinyin.js';
import { normalizePinyin } from '../public/js/validation.js';
const result = JSON.parse(await readFile(new URL('./tone-vocabulary.json', import.meta.url), 'utf8'));
const rows = result.flatMap(r => r.results || []);
const failures = [], fallback = [];
for (const row of rows) {
  const count = [...row.simplified].length;
  const variants = toneVariants(row.pinyin, count);
  if (!parseSyllables(row.pinyin, count)) fallback.push(row);
  if (variants.length < 3 || variants.includes(row.pinyin.normalize('NFC')) || new Set(variants).size !== variants.length || variants.some(s => normalizePinyin(s) !== normalizePinyin(row.pinyin))) failures.push({ ...row, variants });
}
console.log(JSON.stringify({ checked: rows.length, failures, fallback }, null, 2));
if (!rows.length || failures.length) process.exitCode = 1;
