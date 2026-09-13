import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateRow,
  normalizePinyin,
  leaves,
} from "../public/js/validation.js";
import { parseCSV, toCSV } from "../public/js/import.js";
import {
  componentChoices,
  weightedPick,
  weight,
  grade,
  makeQuestion,
  buildExam,
} from "../public/js/study.js";
const data = JSON.parse(await readFile("fixtures/data.json", "utf8"));
for (const k of ["vocabulary", "sentences", "grammar", "culture"])
  data[k].forEach((r, i) => (r.id = i + 1));
data.components = data.vocabulary.flatMap((v) =>
  v.characters.flatMap((c) => leaves(c.decomposition)),
);
test("all seed rows satisfy server/shared validation", () => {
  for (const k of ["vocabulary", "sentences", "grammar", "culture"])
    for (const r of data[k]) assert.notEqual(validateRow(k, r).status, "ERROR");
});
test("accented, spaced, numbered pinyin search", () => {
  assert.equal(normalizePinyin("hǎo"), "hao");
  assert.equal(normalizePinyin("nǐ"), "ni");
  assert.equal(normalizePinyin("xuéshēng"), "xuesheng");
  assert.equal(normalizePinyin("xue2 sheng1"), "xuesheng");
});
test("required fields, malformed JSON, mismatched characters and recursive limits rejected", () => {
  for (const r of [
    {},
    { ...data.vocabulary[0], characters: "{" },
    { ...data.vocabulary[0], characters: [{ char: "好" }] },
  ])
    assert.equal(validateRow("vocabulary", r).status, "ERROR");
  let n = { type: "character", value: "木" };
  for (let i = 0; i < 10; i++)
    n = {
      type: "layout",
      layout: "left-right",
      children: [n, { type: "character", value: "木" }],
    };
  assert.equal(
    validateRow("vocabulary", {
      ...data.vocabulary[0],
      characters: [{ char: "请", decomposition: n }],
    }).status,
    "ERROR",
  );
});
test("duplicates and ambiguous pinyin are warnings", () => {
  assert.ok(
    validateRow("vocabulary", data.vocabulary[0], data.vocabulary).duplicates
      .length,
  );
  assert.ok(
    validateRow(
      "vocabulary",
      { ...data.vocabulary[0], simplified: "情", characters: [{ char: "情" }] },
      data.vocabulary,
    ).warnings.length,
  );
});
test("CSV quoted commas, newlines, unicode BOM and JSON roundtrip", () => {
  const rows = [
    {
      simplified: "好",
      meaning: "좋다, 좋아요\n두 줄",
      characters: JSON.stringify([{ char: "好" }]),
    },
  ];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
  assert.throws(() => parseCSV('a,b\n"open,x'));
  assert.throws(() => parseCSV("a,a\n1,2"));
});
test("CSV export neutralizes spreadsheet formulas", () => {
  assert.equal(parseCSV(toCSV([{ meaning: "=1+1" }]))[0].meaning, "'=1+1");
});
test("sentence validation rejects incorrect token sequence", () => {
  assert.equal(
    validateRow("sentences", {
      ...data.sentences[0],
      tokens: ["学生", "你", "是", "吗"],
    }).status,
    "ERROR",
  );
});
test("nested question clause is explicitly accepted, no global 吗 filter", () => {
  const g = validateRow("grammar", data.grammar[0]);
  assert.notEqual(g.status, "ERROR");
  assert.ok(g.data.correct_examples.includes("你知道他喜欢什么吗？"));
});
test("component candidates contain correct values and only observed relevant alternatives", () => {
  const nodes = leaves(data.vocabulary[0].characters[0].decomposition);
  const options = componentChoices(nodes, data.components);
  assert.ok(options.includes("讠") && options.includes("青"));
  assert.ok(options.every((v) => data.components.some((c) => c.value === v)));
  const variants = new Set(
    Array.from({ length: 30 }, () =>
      componentChoices(nodes, data.components).join(""),
    ),
  );
  assert.ok(variants.size > 5);
});
test("weak-point sampling weights wrong answers higher", () => {
  const stats = {
    strong: { correct: 20, wrong: 0, streak: 10 },
    weak: { correct: 0, wrong: 10, streak: 0 },
  };
  assert.ok(weight("weak", stats) > weight("strong", stats));
  let weak = 0;
  for (let i = 0; i < 100; i++)
    if (
      weightedPick(
        [{ key: "strong" }, { key: "weak" }],
        (x) => x.key,
        () => i / 100,
        stats,
      ).key === "weak"
    )
      weak++;
  assert.ok(weak > 75);
});
test("multi-character decomposition, repeated components and token punctuation grading", () => {
  const q = makeQuestion(
    data,
    "write",
    { difficulty: "hard" },
    {
      key: "test",
      v: data.vocabulary[7],
      c: data.vocabulary[7].characters[0],
      i: 0,
    },
  );
  assert.equal(q.answer, "学");
  assert.ok(!q.prompt.includes("xuéxiào"));
  assert.ok(
    grade(
      q,
      q.nodes.map((n) => n.value),
    ),
  );
  assert.ok(!grade(q, ["木"]));
  assert.ok(grade({ type: "order", answer: "你是学生吗？" }, "你是学生吗"));
  assert.ok(grade({ type: "short", answer: "춘절" }, " 춘절 "));
});
test("five grammar question types produce explicit answers", () => {
  for (const grammarMode of ["correct", "wrong", "error", "blank", "order"]) {
    const q = makeQuestion(
      data,
      "grammar",
      { grammarMode },
      { key: "g", item: data.grammar[0] },
    );
    assert.ok(q);
    assert.ok(q.answer);
  }
});
test("mixed exam allocates exact counts without repeated keys", () => {
  const q = buildExam(data, {
    learn: 3,
    write: 3,
    pronunciation: 2,
    sentence: 2,
    grammar: 2,
    culture: 2,
  });
  assert.equal(q.length, 14);
  for (const area of [
    "learn",
    "write",
    "pronunciation",
    "sentence",
    "grammar",
    "culture",
  ]) {
    const selected = q.filter((x) => x.area === area);
    assert.equal(new Set(selected.map((x) => x.key)).size, selected.length);
  }
  assert.throws(() => buildExam(data, { sentence: 100 }));
});
