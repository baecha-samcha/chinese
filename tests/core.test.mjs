import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateRow,
  normalizePinyin,
  leaves,
  usableComponents,
  assemblyEligible,
} from "../public/js/validation.js";
import { sameComponentMultiset, diffComponentMultiset } from "../public/js/utils.js";
import XLSX from "xlsx";
import { parseCSV, toCSV, parseXLSXSheet } from "../public/js/import.js";
import {
  componentChoices,
  weightedPick,
  weight,
  grade,
  makeQuestion,
  buildExam,
  eligible,
  buildQueue,
  drawFromQueue,
  poolSignature,
} from "../public/js/study.js";
// Deterministic, seeded PRNG (mulberry32) so shuffle/pick tests are
// reproducible instead of occasionally passing by luck of Math.random().
function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
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
test("sameComponentMultiset ignores pick order but keeps multiplicity", () => {
  assert.ok(sameComponentMultiset(["人", "丶", "乛"], ["人", "乛", "丶"]));
  assert.ok(!sameComponentMultiset(["木", "木", "日"], ["木", "日"]));
  assert.ok(sameComponentMultiset(["木", "木", "日"], ["日", "木", "木"]));
});
test("diffComponentMultiset pinpoints wrong/missing components, never as a Set", () => {
  assert.deepEqual(diffComponentMultiset(["囗", "玉"], ["口", "玉"]), {
    matched: ["玉"],
    missing: ["囗"],
    extra: ["口"],
    correct: false,
  });
  assert.ok(diffComponentMultiset(["囗", "玉"], ["玉", "囗"]).correct);
  const dup = diffComponentMultiset(["木", "木", "日"], ["木", "日", "口"]);
  assert.deepEqual(dup.missing, ["木"]);
  assert.deepEqual(dup.extra, ["口"]);
  const full = diffComponentMultiset(["礻", "兄"], ["兄", "礻"]);
  assert.deepEqual(full.missing, []);
  assert.deepEqual(full.extra, []);
  assert.ok(full.correct);
});
test("component grading accepts any pick order but rejects wrong multiplicity or set", () => {
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
  const expected = q.nodes.map((n) => n.value);
  assert.ok(expected.length >= 2);
  assert.ok(grade(q, [...expected].reverse()));
  assert.ok(!grade(q, expected.slice(1)));
});
test("assembly answer uses direct children, not a flattened recursive decomposition", () => {
  // 祝 = 礻 + 兄, where 兄 additionally carries its own (unrelated to this
  // question) breakdown into 口 + 儿 for a possible future detailed drill.
  const zhu = {
    type: "layout",
    layout: "left-right",
    children: [
      { type: "character", value: "礻" },
      {
        type: "character",
        value: "兄",
        decomposition: {
          type: "layout",
          layout: "top-bottom",
          children: [
            { type: "character", value: "口" },
            { type: "character", value: "儿" },
          ],
        },
      },
    ],
  };
  assert.deepEqual(usableComponents(zhu, "祝").map((n) => n.value), [
    "礻",
    "兄",
  ]);
});
test("a nested component's own decomposition only applies when it is the question root", () => {
  // 想 = 相 + 心 (its own top-level decomposition)
  const xiang = {
    type: "layout",
    layout: "top-bottom",
    children: [
      { type: "character", value: "相" },
      { type: "character", value: "心" },
    ],
  };
  // 相 = 木 + 目, as 相's own separate top-level decomposition elsewhere
  const xiangComponent = {
    type: "layout",
    layout: "left-right",
    children: [
      { type: "character", value: "木" },
      { type: "character", value: "目" },
    ],
  };
  assert.deepEqual(usableComponents(xiang, "想").map((n) => n.value), [
    "相",
    "心",
  ]);
  assert.deepEqual(
    usableComponents(xiangComponent, "相").map((n) => n.value),
    ["木", "目"],
  );
});
test("assembly excludes decompositions with fewer than 2 usable direct children", () => {
  assert.equal(assemblyEligible({ char: "木", decomposition: null }), false);
  assert.equal(
    assemblyEligible({
      char: "木",
      decomposition: { type: "character", value: "木" },
    }),
    false,
  );
  assert.equal(
    assemblyEligible({
      char: "人",
      decomposition: {
        type: "layout",
        layout: "left-right",
        children: [
          { type: "character", value: "人" },
          { type: "character", value: "" },
        ],
      },
    }),
    false,
  );
  assert.equal(
    assemblyEligible({
      char: "好",
      decomposition: {
        type: "layout",
        layout: "left-right",
        children: [
          { type: "character", value: "女" },
          { type: "character", value: "子" },
        ],
      },
    }),
    true,
  );
});
test("characters with degenerate decomposition stay out of assembly but remain in meaning study", () => {
  const synthetic = {
    vocabulary: [
      {
        id: 9001,
        simplified: "木",
        meaning: "나무",
        pinyin: "mù",
        characters: [
          { char: "木", decomposition: { type: "character", value: "木" } },
        ],
      },
    ],
  };
  assert.equal(eligible(synthetic, "write").length, 0);
  assert.equal(eligible(synthetic, "learn").length, 1);
});
test("distractor pool favors components at a similar decomposition depth when other signals are tied", () => {
  const nodes = [
    { value: "礻", path: "root.0", position: "first" },
    { value: "兄", path: "root.1", position: "second" },
  ];
  const sameDepth = { value: "訁", path: "root.0", position: "other" };
  const muchDeeper = { value: "宀", path: "root.0.0.0.0", position: "other" };
  const options = componentChoices(nodes, [sameDepth, muchDeeper]);
  assert.ok(options.includes("訁"));
  assert.ok(!options.includes("宀"));
  // the same signal also works from the server-shaped `depth` field directly
  const options2 = componentChoices(nodes, [
    { value: "訁", depth: 1, position: "other" },
    { value: "宀", depth: 5, position: "other" },
  ]);
  assert.ok(options2.includes("訁"));
  assert.ok(!options2.includes("宀"));
});
test("assembly heuristic excludes over-fragmented decompositions but respects an explicit override", () => {
  // 4 flat leaves — one more than the >3-leaf line found by auditing every
  // real decomposition in production data (every legitimate 2-3 part split,
  // 好=女+子 through 前=䒑+月+刂, stayed at <=3; only over-fragmented entries
  // like 德=彳+十+罒+一+心 went past it).
  const fragmented = {
    char: "亮",
    decomposition: {
      type: "layout",
      layout: "top-bottom",
      children: [
        { type: "character", value: "亠" },
        { type: "character", value: "口" },
        { type: "character", value: "冖" },
        { type: "character", value: "几" },
      ],
    },
  };
  assert.equal(assemblyEligible(fragmented), false);
  assert.equal(
    assemblyEligible({ ...fragmented, assemblyEnabled: true }),
    true,
    "explicit assemblyEnabled:true overrides the automatic heuristic",
  );
  const shallow = {
    char: "好",
    decomposition: {
      type: "layout",
      layout: "left-right",
      children: [
        { type: "character", value: "女" },
        { type: "character", value: "子" },
      ],
    },
  };
  assert.equal(assemblyEligible(shallow), true);
  assert.equal(
    assemblyEligible({ ...shallow, assemblyEnabled: false }),
    false,
    "explicit assemblyEnabled:false overrides an otherwise-eligible decomposition",
  );
  // Deeply nested (3 layout levels) even with only a few leaves is excluded
  // by the same "stay at a meaningful component grain" reasoning.
  const deep = {
    char: "南",
    decomposition: {
      type: "layout",
      layout: "top-bottom",
      children: [
        { type: "character", value: "十" },
        {
          type: "layout",
          layout: "surround",
          children: [
            { type: "character", value: "冂" },
            {
              type: "layout",
              layout: "top-bottom",
              children: [
                { type: "character", value: "丷" },
                { type: "character", value: "干" },
              ],
            },
          ],
        },
      ],
    },
  };
  assert.equal(assemblyEligible(deep), false);
});
test("a vocabulary word with zero assembly-eligible characters is safely dropped, not just its bad character", () => {
  const word = {
    id: 9002,
    simplified: "亮好",
    meaning: "밝고 좋다",
    pinyin: "liàng hǎo",
    characters: [
      {
        char: "亮",
        decomposition: {
          type: "layout",
          layout: "top-bottom",
          children: [
            { type: "character", value: "亠" },
            { type: "character", value: "口" },
            { type: "character", value: "冖" },
            { type: "character", value: "几" },
          ],
        },
      },
      { char: "好", decomposition: { type: "character", value: "好" } },
    ],
  };
  assert.equal(eligible({ vocabulary: [word] }, "write").length, 0);
  const mixed = {
    id: 9003,
    simplified: "亮学",
    meaning: "밝고 배우다",
    pinyin: "liàng xué",
    characters: [
      word.characters[0],
      {
        char: "学",
        decomposition: {
          type: "layout",
          layout: "top-bottom",
          children: [
            { type: "character", value: "⺍" },
            { type: "character", value: "冖" },
            { type: "character", value: "子" },
          ],
        },
      },
    ],
  };
  const pool = eligible({ vocabulary: [mixed] }, "write");
  assert.equal(pool.length, 1);
  assert.equal(pool[0].key, "write:9003:1");
});
test("poolSignature is order-independent but changes when membership changes", () => {
  const a = [{ key: "x" }, { key: "y" }, { key: "z" }];
  const shuffled = [{ key: "z" }, { key: "x" }, { key: "y" }];
  assert.equal(poolSignature(a), poolSignature(shuffled));
  assert.notEqual(poolSignature(a), poolSignature([{ key: "x" }, { key: "y" }]));
});
test("buildQueue includes every eligible item at least once per cycle, weak items capped at 4 copies", () => {
  const pool = [{ key: "fresh" }, { key: "mastered" }, { key: "struggling" }];
  const stats = {
    mastered: { correct: 30, wrong: 0, streak: 30 },
    struggling: { correct: 0, wrong: 50, streak: 0 },
  };
  const bag = buildQueue(pool, undefined, stats, seeded(1));
  const counts = Object.fromEntries(
    pool.map((p) => [p.key, bag.filter((b) => b.key === p.key).length]),
  );
  assert.ok(counts.fresh >= 1);
  assert.ok(counts.mastered >= 1);
  assert.ok(counts.struggling > counts.mastered);
  assert.ok(counts.struggling <= 4);
});
test("drawFromQueue is a shuffle bag: no item is skipped and none repeats before a full cycle completes", () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({ key: `q${i}` }));
  const stats = {}; // no history -> every item gets the same baseline weight
  let state = { queue: [], signature: "" };
  const rng = seeded(42);
  let lastKey;
  const seenThisCycle = new Set();
  for (let draw = 0; draw < pool.length; draw++) {
    state = drawFromQueue(state, pool, lastKey, rng);
    assert.ok(state.item, `draw ${draw} produced no item`);
    assert.ok(
      !seenThisCycle.has(state.item.key),
      `"${state.item.key}" repeated before the ${pool.length}-item cycle finished`,
    );
    seenThisCycle.add(state.item.key);
    lastKey = state.item.key;
  }
  assert.equal(seenThisCycle.size, pool.length);
  // Weighting only changes how many *extra* copies a weak item gets within a
  // cycle, and buildQueue always seeds baseline stats fresh here, so a
  // second full cycle must again cover every item at least once.
  const secondCycleSeen = new Set();
  for (let draw = 0; draw < pool.length * 2; draw++) {
    state = drawFromQueue(state, pool, lastKey, rng);
    secondCycleSeen.add(state.item.key);
    lastKey = state.item.key;
  }
  assert.equal(secondCycleSeen.size, pool.length);
});
test("drawFromQueue never repeats the immediately previous question when an alternative exists", () => {
  const pool = [{ key: "a" }, { key: "b" }, { key: "c" }];
  let state = { queue: [], signature: "" };
  const rng = seeded(7);
  let lastKey;
  for (let i = 0; i < 200; i++) {
    const before = lastKey;
    state = drawFromQueue(state, pool, lastKey, rng);
    if (before !== undefined) assert.notEqual(state.item.key, before);
    lastKey = state.item.key;
  }
});
test("drawFromQueue handles a single-item pool without an infinite loop or crash", () => {
  const pool = [{ key: "only" }];
  let state = { queue: [], signature: "" };
  let lastKey;
  for (let i = 0; i < 5; i++) {
    state = drawFromQueue(state, pool, lastKey, Math.random);
    assert.equal(state.item.key, "only");
    lastKey = state.item.key;
  }
});
test("drawFromQueue handles an empty pool without throwing", () => {
  const state = drawFromQueue({ queue: [], signature: "" }, [], undefined, Math.random);
  assert.equal(state.item, null);
});
test("drawFromQueue rebuilds cleanly when the pool changes mid-session (settings/data change), dropping stale queue entries", () => {
  const wide = Array.from({ length: 6 }, (_, i) => ({ key: `w${i}` }));
  const narrow = wide.slice(0, 2);
  let state = { queue: [], signature: "" };
  const rng = seeded(3);
  state = drawFromQueue(state, wide, undefined, rng);
  // Narrow the pool (e.g. a settings change) before the wide cycle finished.
  state = drawFromQueue(state, narrow, state.item.key, rng);
  assert.ok(narrow.some((n) => n.key === state.item.key));
  for (let i = 0; i < 20; i++)
    state = drawFromQueue(state, narrow, state.item.key, rng);
  assert.ok(narrow.some((n) => n.key === state.item.key));
});

test("weighted duplicate queues avoid repeats and preserve every deferred copy", () => {
  const a = { key: "A" },
    b = { key: "B" },
    pool = [a, b];
  for (const rng of [() => 0, () => 0.999]) {
    for (const queue of [[a, a, b], [a, a], [a], []]) {
      const original = [...queue];
      const result = drawFromQueue(
        { queue, signature: poolSignature(pool) },
        pool,
        "A",
        rng,
      );
      assert.equal(result.item.key, "B");
      const expected = queue.includes(b) ? original : [...original, a, b];
      assert.deepEqual(
        [result.item, ...result.queue].map((x) => x.key).sort(),
        expected.map((x) => x.key).sort(),
      );
      assert.deepEqual(queue, original);
    }
    const result = drawFromQueue(
      { queue: [a, a], signature: poolSignature([a]) },
      [a],
      "A",
      rng,
    );
    assert.equal(result.item, a);
    assert.deepEqual(result.queue, [a]);
  }
});

test("XLSX validates original headers with cell positions before mapping rows", () => {
  const parse = (rows, origin = "A1") =>
    parseXLSXSheet(
      XLSX,
      XLSX.utils.aoa_to_sheet(rows, { origin }),
      "vocabulary",
      "vocabulary",
    );
  const headers = ["simplified", "pinyin", "meaning"];
  assert.deepEqual(
    parse([
      [" simplified ", " pinyin ", " meaning ", ""],
      ["河", "hé", "강", ""],
    ]),
    [{ simplified: "河", pinyin: "hé", meaning: "강" }],
  );
  assert.throws(
    () =>
      parse([
        [...headers, " meaning "],
        ["河", "hé", "강", "다른 뜻"],
      ]),
    /vocabulary.*C1, D1.*중복/,
  );
  assert.throws(
    () =>
      parse([
        [...headers, ""],
        ["河", "hé", "강", 0],
      ]),
    /D1.*헤더/,
  );
  assert.throws(
    () =>
      parse([
        ["simplified", "pinyin"],
        ["河", "hé"],
      ]),
    /필수 열 누락: meaning/,
  );
  assert.throws(() => parse([headers]), /빈 시트/);
  assert.throws(() => parse([]), /빈 시트/);
});

test("pinyin parses syllables and preserves separators, case and ü", async () => {
  const { parseSyllables, markTone } = await import("../public/js/pinyin.js");
  for (const [input, count, texts, tones] of [
    ["shǒujī", 2, ["shǒu", "jī"], [3, 1]],
    ["zǎoshang", 2, ["zǎo", "shang"], [3, 0]],
    ["Zhōngguó", 2, ["Zhōng", "guó"], [1, 2]],
    [
      "shàngshàng ge yuè",
      4,
      ["shàng", "shàng", " ", "ge", " ", "yuè"],
      [4, 4, 0, 0, 0, 4],
    ],
    ["Éluósī", 3, ["É", "luó", "sī"], [2, 2, 1]],
    ["Xī'ān", 2, ["Xī", "'", "ān"], [1, 0, 1]],
    ["nǚ lǜ", 2, ["nǚ", " ", "lǜ"], [3, 0, 4]],
    // No apostrophe means the next syllable does not start with a/o/e.
    ["niángāo", 2, ["nián", "gāo"], [2, 1]],
    ["Jiānádà", 3, ["Jiā", "ná", "dà"], [1, 2, 4]],
  ]) {
    const parts = parseSyllables(input.normalize("NFD"), count);
    assert.deepEqual(
      parts.map((p) => p.text),
      texts,
    );
    assert.deepEqual(
      parts.map((p) => p.tone),
      tones,
    );
    assert.equal(parts.map((p) => p.text).join(""), input);
  }
  assert.equal(parseSyllables("not-pinyin", 2), null);
  assert.deepEqual(
    parseSyllables("xian", 2).map((p) => p.text),
    ["xi", "an"],
  );
  assert.deepEqual(
    parseSyllables("niángāo").map((p) => p.text),
    ["nián", "gāo"],
  );
  assert.deepEqual(
    parseSyllables("xian", 1).map((p) => p.text),
    ["xian"],
  );
  assert.deepEqual(
    parseSyllables("huār", 2).map((p) => p.text),
    ["huā", "r"],
  );
  for (const [input, tone, output] of [
    ["shou", 3, "shǒu"],
    ["gui", 4, "guì"],
    ["liu", 2, "liú"],
    ["NÜ", 3, "NǙ"],
    ["É", 1, "Ē"],
    ["lüe", 4, "lüè"],
    ["hǎo", 0, "hao"],
  ])
    assert.equal(markTone(input, tone), output);
});

test("tone variants change only tones and prefer one-syllable mistakes", async () => {
  const { parseSyllables, toneVariants } =
    await import("../public/js/pinyin.js");
  for (const [pinyin, count] of [
    ["shǒujī", 2],
    ["zǎoshang", 2],
    ["Zhōngguó", 2],
    ["shàngshàng ge yuè", 4],
    ["Éluósī", 3],
    ["Xī’ān", 2],
    ["nǚ", 1],
    ["lǜ", 1],
    ["ba", 1],
  ]) {
    const variants = toneVariants(pinyin.normalize("NFD"), count);
    assert.equal(variants.length, 3);
    assert.equal(new Set(variants).size, 3);
    assert.ok(!variants.includes(pinyin));
    const original = parseSyllables(pinyin, count);
    for (const variant of variants) {
      assert.equal(variant, variant.normalize("NFC"));
      assert.equal(normalizePinyin(variant), normalizePinyin(pinyin));
      const withoutTones = (s) => s.normalize("NFD").replace(/[\u0304\u0301\u030c\u0300]/g, "");
      assert.equal(withoutTones(variant), withoutTones(pinyin));
      const parts = parseSyllables(variant, count);
      assert.equal(
        parts.filter((p, i) => p.tone !== original[i].tone).length,
        1,
      );
      assert.equal(
        variant.replace(/[^\s'’]/g, ""),
        pinyin.replace(/[^\s'’]/g, ""),
      );
    }
  }
  assert.deepEqual(toneVariants("ba", 1), ["bā", "bá", "bǎ"]);
  assert.ok(toneVariants("rènshi", 2, 8).includes("rènshí"));
  assert.ok(toneVariants("rènshí", 2, 8).includes("rènshi"));
  assert.equal(toneVariants("ba", 1, 100).length, 4);
  assert.equal(toneVariants("baba", 2, 100).length, 24);
  assert.equal(toneVariants("?", 1).length, 0);
  assert.deepEqual(toneVariants("?ā!", 1), ["?á!", "?ǎ!", "?à!"]);
});

test("tone questions have four choices and exclude unchangeable entries only in tone mode", () => {
  const v = {
    id: 999,
    simplified: "手机",
    pinyin: "shǒujī".normalize("NFD"),
    meaning: "휴대폰",
  };
  const source = { vocabulary: [v, { ...v, id: 1000, pinyin: "?" }] };
  const settings = { pronunciationMode: "tone" };
  const q = makeQuestion(source, "pronunciation", settings);
  assert.equal(q.prompt, "手机");
  assert.equal(q.type, "choice");
  assert.equal(q.options.length, 4);
  assert.ok(q.options.includes("shǒujī"));
  assert.equal(q.answer, "shǒujī");
  assert.equal(eligible(source, "pronunciation", settings).length, 1);
  assert.equal(eligible(source, "pronunciation").length, 2);
  assert.equal(eligible(source, "learn", settings).length, 2);
});
