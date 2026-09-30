import test from "node:test";
import assert from "node:assert/strict";
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
});
const {
  eligible,
  makeQuestion,
  grade,
  record,
  getStats,
  weight,
  directionWeight,
  drawFromQueue,
  scheduleRetry,
  buildExam,
  RETRY_GAP,
} = await import("../public/js/study.js");
const { quizDirections, quizFields, categories, expressionGroup } = await import(
  "../public/js/quiz.js"
);
const { pinyinAnswerKey } = await import("../public/js/pinyin.js");

function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const vocabulary = [
  ["好", "hǎo", "좋다"],
  ["晴", "qíng", "날이 개다"],
  ["情", "qíng", "감정"],
  ["学生", "xuésheng", "학생"],
  ["老师", "lǎoshī", "선생님"],
].map(([simplified, pinyin, meaning], i) => ({
  id: i + 1,
  simplified,
  traditional: simplified,
  pinyin,
  meaning,
  characters: [...simplified].map((char) => ({ char })),
  source: null,
}));
const intro = [
  ["제 소개 좀 할게요.", "我来自我介绍一下。", "Wǒ lái zìwǒ jièshào yíxià."],
  ["제가 소개해 드릴게요.", "我给你介绍一下。", "Wǒ gěinǐ jièshào yíxià."],
  ["만나서 기뻐요.", "见到你很高兴。", "Jiàndào nǐ hěn gāoxìng."],
  ["알게 되어 영광입니다.", "认识你很荣幸。", "Rènshi nǐ hěn róngxìng."],
  ["예전부터 존함을 들었습니다.", "久仰久仰！", "Jiǔyǎng jiǔyǎng!"],
  ["처음 뵙겠습니다.", "初次见面！", "Chūcì jiànmiàn."],
];
const sentences = [
  ...intro.map(([korean, chinese, pinyin], i) => ({
    id: 100 + i,
    korean,
    chinese,
    pinyin,
    category: "자기소개",
    tokens: [...chinese],
    source: null,
  })),
  { id: 200, korean: "생일 축하해!", chinese: "祝你生日快乐！", pinyin: "Zhù nǐ shēngrì kuàilè!", category: "축하", tokens: [], source: 0 },
  { id: 201, korean: "성공을 빌어!", chinese: "祝你成功！", pinyin: "Zhù nǐ chénggōng!", category: "축하", tokens: [], source: 0 },
  { id: 202, korean: "행복하길!", chinese: "祝你幸福！", pinyin: "Zhù nǐ xìngfú!", category: "축하", tokens: [], source: 0 },
  { id: 203, korean: "병음 없음", chinese: "你好！", pinyin: "", category: "", tokens: [], source: 0 },
];
const data = { vocabulary, sentences, components: [], grammar: [], culture: [] };
const directions = [
  ["meaning", "hanzi"],
  ["meaning", "pinyin"],
  ["hanzi", "meaning"],
  ["hanzi", "pinyin"],
  ["pinyin", "meaning"],
  ["pinyin", "hanzi"],
];
const fields = (studyTarget) => (x) =>
  studyTarget === "word"
    ? { meaning: x.meaning, hanzi: x.simplified, pinyin: x.pinyin }
    : { meaning: x.korean, hanzi: x.chinese, pinyin: x.pinyin };

for (const studyTarget of ["word", "sentence"])
  for (const [source, target] of directions)
    test(`${studyTarget}: ${source} → ${target} asks the right faces and grades them`, () => {
      store.clear();
      const settings = { studyTarget, quizSource: [source], quizTarget: [target] };
      const pool = eligible(data, "learn", settings);
      assert.ok(pool.length);
      for (const entry of pool) {
        const row = entry.item.row,
          face = fields(studyTarget)(row),
          q = makeQuestion(data, "learn", settings, entry);
        assert.equal(q.prompt, face[source]);
        assert.equal(q.answer, face[target]);
        assert.equal(q.key, `${entry.key}:${source}>${target}`);
        assert.equal(q.type, "choice");
        assert.ok(q.options.includes(q.answer));
        assert.ok(grade(q, q.answer));
        assert.ok(q.options.filter((o) => o !== q.answer).every((o) => !grade(q, o)));
        // Typed answers: offered for hanzi/pinyin targets, never for meaning.
        const typed = makeQuestion(data, "learn", { ...settings, answerMode: "input" }, entry);
        if (target === "meaning") assert.equal(typed.type, "choice");
        else {
          assert.equal(typed.type, "short");
          assert.ok(grade(typed, typed.answer));
          assert.ok(!grade(typed, `${typed.answer}x`));
        }
      }
    });

test("fields: every source × target pair except same-field, single direction, legacy direction setting", () => {
  assert.deepEqual(
    quizDirections({ quizSource: ["meaning", "hanzi", "pinyin"], quizTarget: ["meaning", "hanzi", "pinyin"] }).sort(),
    directions.map(([s, t]) => `${s}>${t}`).sort(),
  );
  assert.deepEqual(quizDirections({ quizSource: ["meaning"], quizTarget: ["pinyin"] }), ["meaning>pinyin"]);
  assert.deepEqual(quizDirections({ quizSource: ["hanzi"], quizTarget: ["hanzi"] }), []);
  assert.deepEqual(quizDirections({ quizSource: [], quizTarget: ["hanzi"] }), []);
  assert.deepEqual(quizDirections({ direction: "forward" }), ["hanzi>meaning"]);
  assert.deepEqual(quizDirections({ direction: "reverse" }), ["meaning>hanzi"]);
  assert.deepEqual(quizDirections({}).sort(), ["hanzi>meaning", "meaning>hanzi"]);
  assert.deepEqual(quizFields({ quizSource: ["bogus"], direction: "forward" }).source, []);
  // Repeating meaning → pinyin only ever asks that one direction.
  store.clear();
  const settings = { studyTarget: "sentence", quizSource: ["meaning"], quizTarget: ["pinyin"] };
  for (let i = 0; i < 20; i++) assert.equal(makeQuestion(data, "learn", settings).direction, "meaning>pinyin");
});

test("word and sentence targets use the same engine; 자기소개 category narrows sentences", () => {
  const words = eligible(data, "learn", { studyTarget: "word" });
  assert.equal(words.length, vocabulary.length);
  assert.ok(words.every((e) => e.key.startsWith("vocabulary:") && e.v));
  const all = eligible(data, "learn", { studyTarget: "sentence" });
  assert.equal(all.length, sentences.length);
  assert.deepEqual(categories(data, { studyTarget: "sentence" }), ["자기소개", "축하"]);
  assert.deepEqual(categories(data, { studyTarget: "word" }), []);
  const introPool = eligible(data, "learn", { studyTarget: "sentence", quizCategory: "자기소개" });
  assert.deepEqual(introPool.map((e) => e.item.hanzi).sort(), intro.map((r) => r[1]).sort());
  // A sentence without pinyin is skipped only for directions that need it.
  const pinyinPool = eligible(data, "learn", { studyTarget: "sentence", quizSource: ["meaning"], quizTarget: ["pinyin"] });
  assert.ok(!pinyinPool.some((e) => e.item.hanzi === "你好！"));
  assert.ok(all.some((e) => e.item.hanzi === "你好！"));
  // Source scope applies to sentences in the quiz as well.
  assert.ok(eligible(data, "learn", { studyTarget: "sentence", studySource: "0" }).every((e) => e.item.source === 0));
});

test("pinyin grading normalizes presentation, never tones", () => {
  const same = [
    ["Wǒ lái zìwǒ jièshào yíxià.", "wǒ lái zìwǒ jièshào yíxià"],
    ["Wǒ gěinǐ jièshào yíxià.", "WǑ GĚI NǏ JIÈSHÀO YÍXIÀ"],
    ["Chūcì jiànmiàn.", "  chūcì    jiànmiàn "],
    ["Jiǔyǎng jiǔyǎng!", "jiu3yang3 jiu3yang3"],
    ["lǜ", "lv4"],
    ["lǜ", "lu:4"],
    ["nǚ", "nv̌"],
    ["Xī'ān", "xī’ān"],
    ["hǎo", "hǎo"], // decomposed tone mark (NFD)
    ["ma", "ma5"],
  ];
  for (const [answer, typed] of same) assert.equal(pinyinAnswerKey(typed), pinyinAnswerKey(answer), typed);
  const different = [
    ["hǎo", "hao"],
    ["hǎo", "hāo"],
    ["lǜ", "lù"],
    ["shì", "sì"],
    ["qíng", "qǐng"],
  ];
  for (const [answer, typed] of different) assert.notEqual(pinyinAnswerKey(typed), pinyinAnswerKey(answer), typed);
  const q = makeQuestion(data, "learn", { studyTarget: "sentence", quizSource: ["meaning"], quizTarget: ["pinyin"], answerMode: "input" }, eligible(data, "learn", { studyTarget: "sentence", quizCategory: "자기소개" }).find((e) => e.item.hanzi === "我给你介绍一下。"));
  assert.ok(grade(q, "wo3 gei3 ni3 jie4shao4 yi2xia4"));
  assert.ok(!grade(q, "wo3 gei3 ni3 jie4shao4 yi1xia4"));
});

test("choice distractors never include another spelling of the answer", () => {
  const settings = { quizSource: ["hanzi"], quizTarget: ["pinyin"] };
  const entry = eligible(data, "learn", settings).find((e) => e.item.hanzi === "晴");
  for (let i = 0; i < 30; i++) {
    const q = makeQuestion(data, "learn", settings, entry);
    assert.equal(q.options.filter((o) => pinyinAnswerKey(o) === pinyinAnswerKey("qíng")).length, 1);
  }
});

test("progress is stored per item and direction; legacy item progress seeds meaning/hanzi only", () => {
  store.clear();
  const settings = { studyTarget: "sentence", quizCategory: "자기소개" };
  const entry = eligible(data, "learn", settings).find((e) => e.item.hanzi === "久仰久仰！");
  const ask = (source, target) =>
    makeQuestion(data, "learn", { ...settings, quizSource: [source], quizTarget: [target] }, entry);
  const meaningToPinyin = ask("meaning", "pinyin"),
    pinyinToMeaning = ask("pinyin", "meaning");
  record(meaningToPinyin, false);
  record(meaningToPinyin, false);
  record(pinyinToMeaning, true);
  record(pinyinToMeaning, true);
  const stats = getStats();
  assert.deepEqual(
    [stats[`${entry.key}:meaning>pinyin`].wrong, stats[`${entry.key}:pinyin>meaning`].correct],
    [2, 2],
  );
  assert.equal(stats[entry.key], undefined);
  assert.ok(directionWeight(entry, "meaning>pinyin", stats) > directionWeight(entry, "pinyin>meaning", stats));
  // Old single-key word stats still weigh in for the directions they covered.
  const legacy = { "vocabulary:1": { correct: 0, wrong: 6, streak: 0, lastSeen: new Date().toISOString() } };
  const word = { key: "vocabulary:1" };
  assert.equal(directionWeight(word, "meaning>hanzi", legacy), weight("vocabulary:1", legacy));
  assert.equal(directionWeight(word, "meaning>pinyin", legacy), weight("vocabulary:1:meaning>pinyin", legacy));
});

test("weights: wrong answers and long idle time raise, streaks lower", () => {
  const now = Date.parse("2026-09-30T00:00:00Z"),
    fresh = "2026-09-30T00:00:00Z",
    stale = "2026-09-01T00:00:00Z";
  const stats = {
    wrong: { correct: 1, wrong: 3, streak: 0, lastSeen: fresh },
    streak: { correct: 5, wrong: 0, streak: 5, lastSeen: fresh },
    idle: { correct: 5, wrong: 0, streak: 5, lastSeen: stale },
  };
  assert.ok(weight("wrong", stats, now) > weight("streak", stats, now));
  assert.ok(weight("idle", stats, now) > weight("streak", stats, now));
});

test("a missed question comes back after RETRY_GAP other questions, not immediately", () => {
  store.clear();
  const settings = { studyTarget: "sentence", quizSource: ["meaning"], quizTarget: ["pinyin"] };
  const pool = eligible(data, "learn", settings);
  const rng = seeded(11);
  let state = { queue: [], signature: "" };
  state = drawFromQueue(state, pool, undefined, rng);
  const missed = { ...state.item, direction: "meaning>pinyin" };
  state = scheduleRetry(state, missed);
  const order = [];
  let lastKey = missed.key;
  for (let i = 0; i < RETRY_GAP + 1; i++) {
    state = drawFromQueue(state, pool, lastKey, rng);
    order.push(state.item.key);
    lastKey = state.item.key;
  }
  assert.ok(!order.slice(0, RETRY_GAP).includes(missed.key), order.join());
  assert.equal(order[RETRY_GAP], missed.key);
  assert.equal(state.item.direction, "meaning>pinyin");
  assert.equal(state.retry.length, 0);
});

test("no immediate repeats and no back-to-back runs of one expression group", () => {
  const settings = { studyTarget: "sentence" };
  const pool = eligible(data, "learn", settings);
  assert.equal(new Set(pool.filter((e) => e.item.hanzi.startsWith("祝你")).map((e) => e.group)).size, 1);
  for (let seed = 1; seed <= 20; seed++) {
    const rng = seeded(seed);
    let state = { queue: [], signature: "" },
      last;
    const groups = [];
    for (let i = 0; i < 60; i++) {
      state = drawFromQueue(state, pool, last?.key, rng);
      assert.notEqual(state.item.key, last?.key);
      groups.push(state.item.group);
      last = state.item;
    }
    for (let i = 1; i < groups.length; i++)
      assert.ok(!(groups[i] === groups[i - 1] && groups[i].endsWith("祝你")), `seed ${seed} @${i}`);
  }
  assert.equal(expressionGroup({ type: "sentence", category: "축하", hanzi: "祝你成功！" }), "sentence|축하|祝你");
});

test("mock exam word questions stay 뜻 ↔ 한자 choice whatever practice is set to", () => {
  const exam = buildExam(data, { learn: 3 }, {
    studyTarget: "word",
    answerMode: "choice",
    quizSource: ["meaning", "hanzi"],
    quizTarget: ["meaning", "hanzi"],
  });
  assert.equal(exam.length, 3);
  for (const q of exam) {
    assert.equal(q.type, "choice");
    assert.ok(["meaning>hanzi", "hanzi>meaning"].includes(q.direction));
  }
});
