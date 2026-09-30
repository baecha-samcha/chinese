// Builds a human sanity-check report for the drafted sentence pinyin.
//   node scripts/review-sentence-pinyin.mjs <sentences.json> <vocabulary.json> > outputs/sentence-pinyin-review.md
// Inputs are the /api/sentences and /api/vocabulary responses. The pinyin
// each row will actually get is resolved the way production applies it:
// migration 0003's 자기소개 values first, then scripts/data/sentence-pinyin.sql
// (which only fills still-empty rows). Nothing is written anywhere else.
// Flags: REVIEW = marked by the generator; WARNING = a mechanical check that
// needs a human look; INFO = worth knowing, usually fine.
import { readFile } from "node:fs/promises";
import { pinyin as pinyinPro, polyphonic } from "pinyin-pro";
import { parseSyllables } from "../public/js/pinyin.js";
const [sentencesPath, vocabularyPath] = process.argv.slice(2);
if (!sentencesPath || !vocabularyPath) {
  console.error("usage: review-sentence-pinyin.mjs <sentences.json> <vocabulary.json>");
  process.exit(1);
}
const sentences = JSON.parse(await readFile(sentencesPath, "utf8"));
const vocabulary = JSON.parse(await readFile(vocabularyPath, "utf8"));
const sql = await readFile("scripts/data/sentence-pinyin.sql", "utf8");
const migration = await readFile("migrations/0003_sentence_pinyin_category.sql", "utf8");

const unquote = (s) => s.replace(/''/g, "'");
const draft = new Map(),
  review = new Map();
for (const m of sql.matchAll(/^-- REVIEW: (.+?) → (.+)$/gm)) review.set(m[1], m[2]);
for (const m of sql.matchAll(/^UPDATE sentences SET pinyin='((?:[^']|'')*)' WHERE chinese='((?:[^']|'')*)'/gm))
  draft.set(unquote(m[2]), unquote(m[1]));
const intro = new Map();
for (const m of migration.matchAll(/WHEN '((?:[^']|'')*)' THEN '((?:[^']|'')*)'/g))
  intro.set(unquote(m[1]), unquote(m[2]));

const vocab = new Map();
for (const v of vocabulary) {
  const set = vocab.get(v.simplified) || new Set();
  set.add(v.pinyin);
  vocab.set(v.simplified, set);
}
const han = /\p{Script=Han}/u;
const zhPunct = /[，。！？、：；]/g,
  enPunct = /[,.!?:;]/g;
// Personal names were hand-fixed in the generator, so they get their own flag.
const names = ["Jīn Dàhán", "Jīn", "Wáng Dōng", "Jīngjing"];
const rarelyAmbiguous = new Set("六");
const toneless = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");

function check(s, pinyin) {
  const flags = [];
  if (!pinyin) return [["WARNING", "병음 없음"]];
  const chars = [...s.chinese].filter((c) => han.test(c));
  // Syllables per written word; digits stay as-is in the pinyin.
  const words = pinyin
    .replace(enPunct, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ w, syl: /^\d+$/.test(w) ? null : parseSyllables(w) }));
  for (const { w, syl } of words)
    if (syl === null && !/^\d+$/.test(w)) flags.push(["WARNING", `병음 철자 인식 불가: ${w}`]);
  const syllables = words.flatMap(({ syl }) => (syl || []).filter((p) => p.vowelIndex >= 0 || /^r$/i.test(p.text)));
  if (syllables.length !== chars.length)
    flags.push(["WARNING", `음절 수 불일치: 한자 ${chars.length}자 / 병음 ${syllables.length}음절`]);
  if (/[0-9]/.test(s.chinese))
    flags.push(["WARNING", "아라비아 숫자 포함: 병음에도 숫자가 그대로 남아 직접 입력 채점 시 숫자/병음 중 어느 쪽이 정답인지 모호"]);
  else if (/[零一二三四五六七八九十百两][月号点岁口年]|几[月号点岁口]|公斤|米/.test(s.chinese))
    flags.push(["INFO", "숫자/단위 포함"]);
  const zh = (s.chinese.match(zhPunct) || []).length,
    en = (pinyin.match(enPunct) || []).length;
  if (zh !== en) flags.push(["WARNING", `문장부호 수 불일치: 한자 ${zh} / 병음 ${en}`]);
  for (const n of names)
    if (new RegExp(`(^|[^\\p{L}])${n}([^\\p{L}]|$)`, "u").test(pinyin)) {
      flags.push(["WARNING", `인명 표기(수동 보정): ${n}`]);
      break;
    }
  const raw = pinyin.split(/\s+/).filter(Boolean);
  const proper = raw
    .filter((w, i) => i > 0 && /\p{Lu}/u.test(w) && !/[.?!]$/.test(raw[i - 1]))
    .map((w) => w.replace(/[^\p{L}']/gu, ""))
    .filter((w) => !names.some((n) => n.includes(w)));
  if (proper.length) flags.push(["INFO", `고유명사: ${proper.join(", ")}`]);
  // Compare with pinyin-pro reading the whole sentence in context.
  if (syllables.length === chars.length) {
    const context = pinyinPro(chars.join(""), { type: "array", toneSandhi: true });
    const diffs = [],
      neutral = [];
    chars.forEach((c, i) => {
      const mine = syllables[i].text.toLowerCase(),
        theirs = (context[i] || "").toLowerCase();
      if (c === "儿" || mine === theirs) return;
      if (toneless(mine) === toneless(theirs) && mine === toneless(mine)) neutral.push(`${c} ${mine}/${theirs}`);
      else diffs.push(`${c}: 초안 ${mine} / pinyin-pro ${theirs}`);
    });
    if (diffs.length) flags.push(["WARNING", `pinyin-pro 문맥 판독과 다름 — ${diffs.join("; ")}`]);
    if (neutral.length) flags.push(["INFO", `경성 차이(초안 유지) — ${neutral.join(", ")}`]);
    // Word spacing: spans are recovered from each word's syllable count.
    let at = 0;
    const spans = words.map(({ w, syl }) => {
      const n = (syl || []).filter((p) => p.vowelIndex >= 0 || /^r$/i.test(p.text)).length;
      const text = chars.slice(at, at + n).join("");
      at += n;
      return { w, text, n };
    });
    for (let i = 0; i + 1 < spans.length; i++) {
      const joined = spans[i].text + spans[i + 1].text;
      if (spans[i].n && spans[i + 1].n && vocab.has(joined))
        flags.push(["WARNING", `띄어쓰기: ${joined}는 단어장의 한 단어인데 "${spans[i].w} ${spans[i + 1].w}"로 나뉨`]);
    }
    for (const sp of spans)
      if (sp.n > 1 && !vocab.has(sp.text) && !s.tokens.includes(sp.text) && !names.some((n) => n.replace(/\s/g, "").includes(sp.w.replace(/[^\p{L}]/gu, ""))))
        flags.push(["WARNING", `붙여쓰기: ${sp.text}(${sp.w})는 단어장 단어도 문장 token도 아님`]);
  }
  // Polyphonic characters whose reading came from the dictionary alone.
  for (const token of s.tokens) {
    const text = [...token].filter((c) => han.test(c)).join("");
    if (!text || vocab.has(text)) continue;
    for (const c of text)
      if (!rarelyAmbiguous.has(c) && polyphonic(c, { type: "array" })[0]?.length > 1)
        flags.push(["WARNING", `다음자(단어장 근거 없음): ${c} ∈ ${polyphonic(c, { type: "array" })[0].join("/")}`]);
  }
  return [...new Map(flags.map((f) => [f.join("|"), f])).values()];
}

const rows = sentences
  .map((s) => {
    const fromIntro = intro.has(s.chinese);
    const pinyin = s.pinyin || (fromIntro ? intro.get(s.chinese) : draft.get(s.chinese)) || "";
    const flags = check(s, pinyin);
    if (review.has(s.chinese))
      flags.unshift([
        "REVIEW",
        `${review.get(s.chinese)}${fromIntro ? " (단, migration 0003의 자기소개 값이 먼저 적용되어 이 초안은 실제로 쓰이지 않음)" : ""}`,
      ]);
    return { ...s, pinyin, category: s.category || (fromIntro ? "자기소개" : ""), flags, origin: fromIntro ? "migration 0003" : "sentence-pinyin.sql" };
  })
  .sort((a, b) => a.id - b.id);

const cell = (v) => String(v ?? "").replace(/\|/g, "\\|");
const level = (r) => (r.flags.some((f) => f[0] === "REVIEW") ? "REVIEW" : r.flags.some((f) => f[0] === "WARNING") ? "WARNING" : r.flags.length ? "INFO" : "");
const count = (l) => rows.filter((r) => level(r) === l).length;
const out = [
  "# 문장 병음 검수표",
  "",
  `생성: ${new Date().toISOString().slice(0, 10)} · 문장 ${rows.length}개 · REVIEW ${count("REVIEW")} · WARNING ${count("WARNING")} · INFO ${count("INFO")} · 이상 없음 ${count("")}`,
  "",
  "적용 병음 = production에 실제로 들어갈 값 (자기소개 6개는 migration 0003, 나머지는 scripts/data/sentence-pinyin.sql). source: 0 교과서 · 1 보충자료 · 빈칸 미지정.",
  "",
  "## REVIEW (생성기 표시)",
  "",
];
for (const r of rows.filter((r) => level(r) === "REVIEW"))
  out.push(
    `### id ${r.id} · ${r.chinese}`,
    "",
    `- 한국어 뜻: ${r.korean}`,
    `- 적용 병음: \`${r.pinyin}\` (${r.origin})`,
    ...(r.origin === "migration 0003" ? [`- 생성기 초안: \`${draft.get(r.chinese)}\``] : []),
    ...r.flags.map(([l, m]) => `- ${l}: ${m}`),
    "",
  );
out.push("## 전체 목록", "", "| id | 표시 | category | source | meaning | hanzi | pinyin | 확인 사항 |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows)
  out.push(
    `| ${r.id} | ${level(r)} | ${cell(r.category)} | ${r.source ?? ""} | ${cell(r.korean)} | ${cell(r.chinese)} | ${cell(r.pinyin)} | ${cell(r.flags.map(([l, m]) => `${l}: ${m}`).join("<br>"))} |`,
  );
const byChinese = Map.groupBy(rows, (r) => r.chinese);
const duplicates = [...byChinese].filter(([, g]) => g.length > 1);
out.push("", "## 중복 문장 (같은 hanzi)", "", duplicates.length ? "| hanzi | id | source | category | pinyin | meaning | explanation |" : "없음", ...(duplicates.length ? ["| --- | --- | --- | --- | --- | --- | --- |"] : []));
for (const [chinese, group] of duplicates)
  for (const r of group)
    out.push(`| ${cell(chinese)} | ${r.id} | ${r.source ?? ""} | ${cell(r.category)} | ${cell(r.pinyin)} | ${cell(r.korean)} | ${cell(r.explanation)} |`);
const byKorean = [...Map.groupBy(rows, (r) => r.korean)].filter(([, g]) => g.length > 1 && new Set(g.map((r) => r.chinese)).size > 1);
out.push("", "## 같은 한국어 뜻, 다른 hanzi", "", byKorean.length ? "| meaning | id | hanzi | source |" : "없음", ...(byKorean.length ? ["| --- | --- | --- | --- |"] : []));
for (const [korean, group] of byKorean)
  for (const r of group) out.push(`| ${cell(korean)} | ${r.id} | ${cell(r.chinese)} | ${r.source ?? ""} |`);
console.log(out.join("\n"));
