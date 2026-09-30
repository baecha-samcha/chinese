import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateRow, leaves } from "../public/js/validation.js";
import { filterStudySource, eligible, makeQuestion, buildExam } from "../public/js/study.js";
import { parseCSV, toCSV, parseXLSXSheet } from "../public/js/import.js";
import XLSX from "xlsx";
const fixture = JSON.parse(await readFile("fixtures/data.json", "utf8"));
const data = {
  ...fixture,
  vocabulary: fixture.vocabulary.slice(0, 6).map((r, i) => ({ ...r, id: i + 1, source: i < 2 ? 0 : i < 4 ? 1 : null })),
  sentences: fixture.sentences.map((r, i) => ({ ...r, id: i + 1, source: i < 2 ? i : null })),
};
data.components = data.vocabulary.flatMap(v => v.characters.flatMap(c => leaves(c.decomposition)));
test("source accepts numeric XLSX and string CSV values without interpreting missing as zero", () => {
  for (const kind of ["vocabulary", "sentences"]) {
    const row = fixture[kind][0];
    for (const value of [0, 1, "0", "1", " 0 "]) {
      const result = validateRow(kind, { ...row, source: value });
      assert.equal(result.errors.length, 0);
      assert.equal(result.data.source, Number(value));
    }
    for (const value of [undefined, null, "", " "]) {
      const result = validateRow(kind, { ...row, source: value });
      assert.equal(result.data.source, null);
      assert(result.warnings.some(x => x.includes("출처 미지정")));
    }
    for (const value of [false, true, 2, -1, [], {}, "교과서", "0,1"]) {
      assert.equal(validateRow(kind, { ...row, source: value }).status, "ERROR");
    }
    const csvRow = parseCSV(toCSV([{ ...row, source: 0 }]))[0];
    assert.equal(validateRow(kind, csvRow).data.source, 0);
    const sheet = XLSX.utils.json_to_sheet([{ ...row, characters: JSON.stringify(row.characters), tokens: JSON.stringify(row.tokens), source: 1 }]);
    assert.equal(validateRow(kind, parseXLSXSheet(XLSX, sheet, kind, kind)[0]).data.source, 1);
  }
});
test("source limits all vocabulary modes, sentence pools and distractors while common areas remain", () => {
  for (const studySource of ["0", "1"]) {
    const settings = { studySource };
    const scoped = filterStudySource(data, settings);
    assert.equal(scoped.vocabulary.length, 2);
    assert.equal(scoped.sentences.length, 1);
    assert.equal(scoped.grammar, data.grammar);
    assert.equal(scoped.culture, data.culture);
    for (const area of ["learn", "pronunciation", "write", "sentence"]) {
      const pool = eligible(data, area, settings);
      assert(pool.length);
      for (const e of pool) assert.equal((e.v || e.item).source, Number(studySource));
      for (const e of pool) {
        const q = makeQuestion(data, area, { ...settings, direction: "forward" }, e);
        if (area === "learn") assert(q.options.every(o => scoped.vocabulary.some(v => v.meaning === o)));
        if (area === "pronunciation") assert(q.options.every(o => scoped.vocabulary.some(v => v.pinyin === o)));
        if (area === "write") assert(q.options.every(o => scoped.components.some(c => c.value === o)));
      }
    }
    const exam = buildExam(data, { learn: 2, sentence: 1 }, settings);
    assert.equal(exam.length, 3);
    assert.throws(() => buildExam(data, { sentence: 2 }, settings), /출제 가능한/);
  }
  assert.equal(eligible(data, "learn", { studySource: "all" }).length, 6);
  assert.equal(filterStudySource(data, {}), data);
  const legacy = { ...data, vocabulary: data.vocabulary.map(v => ({ ...v, source: null })) };
  assert.equal(eligible(legacy, "learn", { studySource: "0" }).length, 0);
  assert.equal(makeQuestion(legacy, "learn", { studySource: "0" }), null);
});
