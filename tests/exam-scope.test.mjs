import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { examMigrationSql, selectExamScope, applyPendingMigrations } from "../scripts/exam-scope.mjs";
import { validateRow, examTags } from "../public/js/validation.js";
import { filterStudyExam, filterStudyScope, eligible } from "../public/js/study.js";
import { generateExam } from "../public/js/exam/engine.js";

const evidence = JSON.parse(fs.readFileSync("scripts/data/exam-2026-midterm.json", "utf8"));
const scope = JSON.parse(fs.readFileSync("public/data/exam-scope.json", "utf8"));
const migration = fs.readFileSync("migrations/0004_exam_scope.sql", "utf8");
const EXAM = evidence.exam.id;
// The 28 unsourced words with no sourced duplicate in production before 0004.
const UNSOURCED = ["们", "见", "谢", "南丁格尔", "贝多芬", "居里", "甘地", "大", "了", "狗", "两", "天", "回", "家", "劳动节", "音乐", "考试", "棒", "冷", "知道", "中学", "桌子", "下", "汉语", "还", "加油", "日", "玩儿"];

test("evidence: all 28 unsourced words are either restored with PDF pages or left unconfirmed", () => {
  const restored = evidence.sourceRecovery.vocabulary, unconfirmed = evidence.unconfirmed.vocabulary;
  assert.deepEqual([...restored, ...unconfirmed].map((r) => r.simplified).sort(), [...UNSOURCED].sort());
  assert.equal(restored.length, 19);
  assert.deepEqual(unconfirmed.map((r) => r.simplified), ["棒", "冷", "知道", "中学", "桌子", "汉语", "还", "加油", "日"]);
  for (const r of [...restored, ...evidence.sourceRecovery.sentences]) {
    assert.ok(r.evidence.length, r.id);
    for (const e of r.evidence) {
      // PDF p.1-20 are textbook spreads (pp.30-75), p.21-28 the supplement.
      if (e.doc === "textbook") assert.ok(e.pdfPage >= 1 && e.pdfPage <= 20 && e.page >= 30 && e.page <= 75, JSON.stringify(e));
      else assert.ok(e.doc === "supplement" && e.pdfPage >= 21 && e.pdfPage <= 28 && e.page === e.pdfPage - 20, JSON.stringify(e));
      assert.ok(e.text.trim());
    }
    const docs = new Set(r.evidence.map((e) => e.doc));
    assert.equal(r.found, docs.size === 2 ? "both" : [...docs][0], r.id);
    // Found in both: recorded as textbook, like the existing sourced rows.
    assert.equal(r.source, r.found === "supplement" ? 1 : 0, r.id);
  }
  assert.deepEqual(restored.filter((r) => r.source === 1).map((r) => r.simplified), ["下", "玩儿"]);
  for (const r of unconfirmed) assert.ok(r.reason);
});

test("evidence: tag members exclude unconfirmed rows and include every restored row", () => {
  const ids = (kind) => new Set(evidence.members[kind].map(([id]) => id));
  for (const r of evidence.unconfirmed.vocabulary) assert.ok(!ids("vocabulary").has(r.id), r.simplified);
  for (const [kind, rows] of Object.entries(evidence.sourcedNotInPdf))
    for (const r of rows) assert.ok(!ids(kind).has(r.id), `${kind} ${r.id}`);
  for (const [kind, rows] of Object.entries(evidence.sourceRecovery))
    for (const r of rows) assert.ok(ids(kind).has(r.id), `${kind} ${r.id}`);
  assert.deepEqual(Object.fromEntries(Object.entries(evidence.members).map(([k, v]) => [k, v.length])), { vocabulary: 311, sentences: 121, grammar: 24, culture: 37 });
});

test("migration 0004 is exactly what the evidence generates", () => {
  assert.equal(examMigrationSql(evidence, { schema: true }), migration);
});

// Fresh database from the repo migrations with rows at production ids, plus
// rows the migration must not touch.
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  for (const name of ["0001_initial.sql", "0002_study_source.sql", "0003_sentence_pinyin_category.sql"]) {
    db.exec(fs.readFileSync(`migrations/${name}`, "utf8"));
    db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
  }
  const vocab = db.prepare("INSERT INTO vocabulary (id,simplified,pinyin,pinyin_normalized,meaning,characters,source) VALUES (?,?,?,?,?,'[]',?)");
  for (const [id, simplified, source] of [
    [1, "你", 0], [3, "们", null], [6, "见", 1], [111, "家", null], [136, "下", null], [122, "棒", null],
    [223, "差不多", 0], [233, "龙舟", 0], [2, "好", null], [110, "猫", null],
  ]) vocab.run(id, simplified, "x", "x", "뜻", source);
  // Migration 0003 already inserted six sentences at ids 1-6 here, so id 5/6
  // hold other text than production and must not be restored or tagged.
  const sentence = db.prepare("INSERT INTO sentences (id,korean,chinese,tokens,source) VALUES (?,?,?,'[]',?)");
  for (const [id, chinese, source] of [[31, "你家有几口人？", null], [37, "老师，再见！", 0], [35, "你好！", 0]]) sentence.run(id, "한국어", chinese, source);
  db.prepare("INSERT INTO grammar_rules (id,title,explanation,correct_examples,wrong_examples,tags) VALUES (1,'不에 대하여','설명','[]','[]','[\"부정\"]')").run();
  db.prepare("INSERT INTO culture_items (id,category,question,answer) VALUES (99,'기타','범위 밖 질문','답')").run();
  return db;
}
const row = (db, table, id) => db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const tags = (db, table, id) => JSON.parse(row(db, table, id).exam_tags);

test("migration 0004 restores only NULL sources it has evidence for, by id and content, and tags without deleting", () => {
  const db = database();
  const count = (t) => db.prepare(`SELECT count(*) n FROM ${t}`).get().n;
  const before = { v: count("vocabulary"), s: count("sentences"), c: count("characters") };
  const sentencesBefore = db.prepare("SELECT id,chinese,source FROM sentences ORDER BY id").all();
  assert.deepEqual(applyPendingMigrations(db), ["0004_exam_scope.sql"]);
  assert.deepEqual({ v: count("vocabulary"), s: count("sentences"), c: count("characters") }, before);
  assert.deepEqual(db.prepare("SELECT id,label FROM exams").all().map((r) => ({ ...r })), [{ id: EXAM, label: "2026 중간고사" }]);
  // Restored: textbook 们/家, supplement 下. Kept: 见 already had source 1.
  assert.equal(row(db, "vocabulary", 3).source, 0);
  assert.equal(row(db, "vocabulary", 111).source, 0);
  assert.equal(row(db, "vocabulary", 136).source, 1);
  assert.equal(row(db, "vocabulary", 6).source, 1);
  // Unconfirmed 棒, a NULL duplicate (好) and a different word at a restored id stay NULL.
  for (const id of [122, 2, 110]) assert.equal(row(db, "vocabulary", id).source, null, id);
  assert.equal(row(db, "sentences", 31).source, 1);
  // 0003's sentences at ids 5/6 are not the production rows: untouched.
  for (const s of sentencesBefore.filter((s) => s.id <= 6)) {
    const { id, chinese, source } = row(db, "sentences", s.id);
    assert.deepEqual({ id, chinese, source }, { ...s });
    assert.deepEqual(tags(db, "sentences", s.id), []);
  }
  // Tagged members; untagged: unconfirmed words, handwriting/Korean-only rows,
  // unsourced duplicates, content mismatches and rows outside the evidence.
  for (const id of [1, 3, 6, 111, 136]) assert.deepEqual(tags(db, "vocabulary", id), [EXAM], id);
  for (const id of [122, 223, 233, 2, 110]) assert.deepEqual(tags(db, "vocabulary", id), [], id);
  assert.deepEqual(tags(db, "sentences", 31), [EXAM]);
  assert.deepEqual(tags(db, "sentences", 35), [EXAM]);
  assert.deepEqual(tags(db, "sentences", 37), []);
  assert.deepEqual(tags(db, "grammar_rules", 1), [EXAM]);
  assert.deepEqual(JSON.parse(row(db, "grammar_rules", 1).tags), ["부정"]);
  assert.deepEqual(tags(db, "culture_items", 99), []);
});

test("migration data is idempotent and keeps other exams' tags; one row can be in several exams", () => {
  const db = database();
  applyPendingMigrations(db);
  db.exec("INSERT INTO exams (id,label,sort_order) VALUES ('2026-final','2026 기말고사',1)");
  db.exec("UPDATE vocabulary SET exam_tags=json_insert(exam_tags,'$[#]','2026-final') WHERE id IN (111,110)");
  db.exec(migration.slice(migration.indexOf("-- 2026 중간고사")));
  assert.deepEqual(tags(db, "vocabulary", 111), [EXAM, "2026-final"]);
  assert.deepEqual(tags(db, "vocabulary", 110), ["2026-final"]);
  const midterm = selectExamScope(db, EXAM), final = selectExamScope(db, "2026-final");
  assert.deepEqual(midterm.exam, { id: EXAM, label: "2026 중간고사" });
  assert.deepEqual(midterm.vocabulary.map((r) => r.id), [1, 3, 6, 111, 136]);
  assert.deepEqual(final.vocabulary.map((r) => r.id), [110, 111]);
  assert.throws(() => selectExamScope(db, "2027-midterm"), /등록되지 않은 시험 범위/);
  assert.throws(() => db.exec("INSERT INTO exams (id,label) VALUES ('Bad Id','x')"));
});

test("exam-scope.json is the 2026-midterm tag scope with restored sources and no unconfirmed rows", () => {
  assert.deepEqual(scope.exam, { id: EXAM, label: "2026 중간고사" });
  for (const kind of ["vocabulary", "sentences", "grammar", "culture"])
    assert.deepEqual(scope[kind].map((r) => r.id), evidence.members[kind].map(([id]) => id).sort((a, b) => a - b), kind);
  const byId = (kind) => new Map(scope[kind].map((r) => [r.id, r]));
  for (const [kind, rows] of Object.entries(evidence.sourceRecovery))
    for (const r of rows) assert.equal(byId(kind).get(r.id).source, r.source, `${kind} ${r.id}`);
  const words = new Set(scope.vocabulary.map((r) => r.simplified));
  for (const w of ["们", "见", "谢", "家", "两", "玩儿", "下"]) assert.ok(words.has(w), w);
  for (const w of ["棒", "冷", "知道", "中学", "桌子", "汉语", "还", "加油", "日", "龙舟", "差不多"]) assert.ok(!words.has(w), w);
  // One row per word: unsourced duplicates are represented by the sourced row.
  assert.equal(words.size, scope.vocabulary.length);
  assert.deepEqual(scope.provenance.migrationsApplied, ["0004_exam_scope.sql"]);
});

test("generated exams keep 29 questions, 100 points and 50 minutes and record the exam scope", () => {
  const e = generateExam(scope, { now: 0 });
  assert.equal(e.questions.length, 29);
  assert.equal(e.questions.reduce((s, q) => s + q.points, 0), 100);
  assert.equal(e.deadline, 50 * 60 * 1000);
  assert.deepEqual(e.exam, scope.exam);
  assert.equal(e.scopeVersion, scope.version);
});

test("exam_tags: arrays, JSON or comma lists; format and registry checked; missing column is not an overwrite", () => {
  const base = { simplified: "家", pinyin: "jiā", meaning: "집", source: 0 };
  const known = new Set([EXAM, "2026-final"]);
  assert.deepEqual(validateRow("vocabulary", { ...base, exam_tags: [EXAM, "2026-final", EXAM] }, [], known).data.exam_tags, [EXAM, "2026-final"]);
  assert.deepEqual(validateRow("vocabulary", { ...base, exam_tags: '["2026-final"]' }, [], known).data.exam_tags, ["2026-final"]);
  assert.deepEqual(validateRow("culture", { category: "c", question: "q", answer: "a", exam_tags: "2026-midterm, 2026-final" }, [], known).data.exam_tags, [EXAM, "2026-final"]);
  const missing = validateRow("vocabulary", base, [], known);
  assert.deepEqual(missing.data.exam_tags, []);
  assert.ok(!missing.present.includes("exam_tags"));
  assert.ok(validateRow("vocabulary", { ...base, exam_tags: "" }, [], known).present.includes("exam_tags"));
  assert.match(validateRow("vocabulary", { ...base, exam_tags: ["2027-final"] }, [], known).errors.join(), /등록되지 않은 시험 범위 2027-final/);
  for (const bad of [["2026 Midterm"], [1], "2026_midterm", [""]])
    assert.match(validateRow("vocabulary", { ...base, exam_tags: bad }, [], known).errors.join(), /exam_tags/, JSON.stringify(bad));
  assert.throws(() => examTags(Array(21).fill("a")));
  // Tags never change the meaning of source.
  assert.equal(validateRow("vocabulary", { ...base, exam_tags: [EXAM] }, [], known).data.source, 0);
});

test("study filters: exam scope and source are separate and combine", () => {
  const chars = (s) => [...s].map((char) => ({ char, decomposition: null }));
  const data = {
    vocabulary: [
      { id: 1, simplified: "家", pinyin: "jiā", meaning: "집", source: 0, exam_tags: [EXAM, "2026-final"], characters: chars("家") },
      { id: 2, simplified: "下", pinyin: "xià", meaning: "다음", source: 1, exam_tags: [EXAM], characters: chars("下") },
      { id: 3, simplified: "桌子", pinyin: "zhuōzi", meaning: "책상", source: null, exam_tags: [], characters: chars("桌子") },
      { id: 4, simplified: "猫", pinyin: "māo", meaning: "고양이", source: 0, characters: chars("猫") },
    ],
    sentences: [{ id: 1, korean: "a", chinese: "家", tokens: ["家"], source: 0, exam_tags: [EXAM] }, { id: 2, korean: "b", chinese: "猫", tokens: ["猫"], source: 0, exam_tags: [] }],
    grammar: [{ id: 1, title: "g1", exam_tags: [EXAM] }, { id: 2, title: "g2", exam_tags: ["2026-final"] }],
    culture: [{ id: 1, question: "c1", exam_tags: [] }, { id: 2, question: "c2", exam_tags: [EXAM] }],
    components: [],
  };
  const ids = (d) => Object.fromEntries(["vocabulary", "sentences", "grammar", "culture"].map((k) => [k, d[k].map((r) => r.id)]));
  assert.equal(filterStudyExam(data, {}), data);
  assert.deepEqual(ids(filterStudyExam(data, { studyExam: EXAM })), { vocabulary: [1, 2], sentences: [1], grammar: [1], culture: [2] });
  assert.deepEqual(ids(filterStudyExam(data, { studyExam: "2026-final" })), { vocabulary: [1], sentences: [], grammar: [2], culture: [] });
  // Source still means provenance: textbook ∩ midterm.
  assert.deepEqual(ids(filterStudyScope(data, { studySource: "0", studyExam: EXAM })), { vocabulary: [1], sentences: [1], grammar: [1], culture: [2] });
  assert.deepEqual(ids(filterStudyScope(data, { studySource: "1" })).vocabulary, [2]);
  const keys = eligible(data, "learn", { studyExam: EXAM, studyTarget: "word" }).map((e) => e.item.row.simplified).sort();
  assert.deepEqual(keys, ["下", "家"]);
});
