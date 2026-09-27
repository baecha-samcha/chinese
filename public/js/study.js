import { shuffle, readLocal, writeLocal, sameComponentMultiset } from "./utils.js";
import { strip, usableComponents, assemblyEligible } from "./validation.js";
export function getStats() {
  const s = readLocal("ch.stats", {});
  return s && typeof s === "object" && !Array.isArray(s) ? s : {};
}
export function record(q, correct) {
  const stats = getStats(),
    old = stats[q.key] || { correct: 0, wrong: 0, streak: 0 };
  stats[q.key] = {
    ...old,
    vocabularyId: q.vocabularyId || null,
    correct: old.correct + (correct ? 1 : 0),
    wrong: old.wrong + (correct ? 0 : 1),
    streak: correct ? old.streak + 1 : 0,
    lastSeen: new Date().toISOString(),
  };
  return writeLocal("ch.stats", stats);
}
export function weight(key, stats = getStats()) {
  const s = stats[key];
  if (!s) return 2;
  return (
    1 +
    Math.min(8, ((Number(s.wrong) || 0) * 2) / (1 + (Number(s.correct) || 0))) +
    2 / (1 + (Number(s.streak) || 0))
  );
}
export function weightedPick(
  items,
  key = (x) => x.key,
  rng = Math.random,
  stats = getStats(),
) {
  if (!items.length) return null;
  const weights = items.map((x) => weight(key(x), stats));
  let n = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    n -= weights[i];
    if (n <= 0) return items[i];
  }
  return items.at(-1);
}
const shapes = [
  ["讠", "氵", "冫", "忄", "扌", "亻", "彳"],
  ["青", "清", "情", "晴", "请"],
  ["日", "目", "白", "田", "由"],
  ["木", "本", "禾", "米"],
  ["女", "子", "好"],
  ["土", "士", "工", "王"],
  ["口", "囗", "回"],
  ["人", "入", "八"],
];
const strokes = {
  讠: 2,
  氵: 3,
  冫: 2,
  忄: 3,
  扌: 3,
  亻: 2,
  彳: 3,
  青: 8,
  日: 4,
  目: 5,
  白: 5,
  田: 5,
  由: 5,
  木: 4,
  本: 5,
  禾: 5,
  米: 6,
  女: 3,
  子: 3,
  土: 3,
  士: 3,
  工: 3,
  王: 4,
  口: 3,
  囗: 3,
  人: 2,
  入: 2,
  八: 2,
};
// Depth of a component within its decomposition tree: how many "layout" hops
// separate it from the root. A direct child of the root (礻 in 祝 = 礻 + 兄)
// sits at depth 1; something nested further down sits deeper. Used only to
// keep distractors at roughly the same visual/abstraction size as the answer
// (avoid mixing whole components like 礻/兄 with stroke-level pieces like
// 丶/一/丿), never to grade anything.
function depthOf(x) {
  if (typeof x?.depth === "number") return x.depth;
  if (typeof x?.path === "string") return x.path.split(".").length - 1;
  return null;
}
export function componentChoices(nodes, pool, rng = Math.random) {
  const correct = new Set(nodes.map((x) => x.value));
  const scores = new Map();
  for (const c of pool) {
    if (correct.has(c.value)) continue;
    let best = 0;
    for (const n of nodes) {
      let score = c.position === n.position ? 3 : 0;
      const a = strokes[n.value],
        b = c.stroke_count || strokes[c.value];
      if (a && b && Math.abs(a - b) <= 2) score += 2;
      if (shapes.some((g) => g.includes(n.value) && g.includes(c.value)))
        score += 4;
      if (
        c.shape_group &&
        pool.some((p) => p.value === n.value && p.shape_group === c.shape_group)
      )
        score += 4;
      const nd = depthOf(n),
        cd = depthOf(c);
      if (nd != null && cd != null) {
        if (nd === cd) score += 3;
        else if (Math.abs(nd - cd) === 1) score += 1;
      }
      best = Math.max(best, score);
    }
    if (best > 0) scores.set(c.value, Math.max(scores.get(c.value) || 0, best));
  }
  // Weighted sampling only from observed components with matching metadata.
  const candidates = [...scores].map(([value, score]) => ({ value, score })),
    wrong = [];
  while (candidates.length && wrong.length < 4) {
    let r = rng() * candidates.reduce((s, c) => s + c.score, 0),
      i = 0;
    while (i < candidates.length - 1 && (r -= candidates[i].score) > 0) i++;
    wrong.push(candidates.splice(i, 1)[0].value);
  }
  return shuffle([...correct, ...wrong], rng);
}
function choice(options, answer) {
  return shuffle([
    ...new Set([
      answer,
      ...shuffle(options.filter((x) => x !== answer)).slice(0, 3),
    ]),
  ]);
}
// Only vocabulary and sentences carry provenance. Grammar/culture are common.
export function filterStudySource(data, settings = {}) {
  const selected = String(settings.studySource ?? "all");
  if (!["0", "1"].includes(selected)) return data;
  const matches = (r) => r.source != null && String(r.source) === selected;
  const vocabulary = data.vocabulary.filter(matches);
  const values = new Set(vocabulary.flatMap((v) =>
    v.characters.flatMap((c) => usableComponents(c.decomposition, c.char).map((n) => n.value)),
  ));
  return {
    ...data,
    vocabulary,
    sentences: (data.sentences || []).filter(matches),
    components: (data.components || []).filter((c) => values.has(c.value)),
  };
}
export function eligible(data, area, settings = {}) {
  if (area === "learn" || area === "pronunciation")
    return data.vocabulary.map((v) => ({ key: `vocabulary:${v.id}`, v }));
  if (area === "write")
    return data.vocabulary.flatMap((v) =>
      v.characters.flatMap((c, i) =>
        assemblyEligible(c) ? [{ key: `write:${v.id}:${i}`, v, c, i }] : [],
      ),
    );
  const kind = {
    sentence: "sentences",
    grammar: "grammar",
    culture: "culture",
  }[area];
  return (data[kind] || [])
    .filter(
      (x) =>
        area !== "culture" ||
        settings.cultureMode !== "choice" ||
        new Set(x.distractors).size > 0,
    )
    .map((x) => ({ key: `${area}:${x.id}`, item: x }));
}
export function makeQuestion(data, area, settings = {}, source) {
  const entry = source || weightedPick(eligible(data, area, settings));
  if (!entry) return null;
  const base = { key: entry.key, area };
  if (area === "learn") {
    const v = entry.v,
      reverse =
        settings.direction === "reverse" ||
        (settings.direction !== "forward" && Math.random() < 0.5),
      answer = reverse ? v.simplified : v.meaning;
    return {
      ...base,
      vocabularyId: v.id,
      type: "choice",
      prompt: reverse ? v.meaning : v.simplified,
      answer,
      options: choice(
        data.vocabulary
          .filter((x) =>
            reverse ? x.meaning !== v.meaning : x.simplified !== v.simplified,
          )
          .map((x) => (reverse ? x.simplified : x.meaning)),
        answer,
      ),
      explanation: `${v.simplified} · ${v.pinyin} · ${v.meaning}`,
      chinese: v.simplified,
    };
  }
  if (area === "pronunciation") {
    const v = entry.v,
      mode = settings.pronunciationMode || "pinyin",
      answer = mode === "pinyin" ? v.pinyin : v.simplified;
    return {
      ...base,
      vocabularyId: v.id,
      type: "choice",
      prompt:
        mode === "listen"
          ? "소리를 듣고 한자를 고르세요."
          : mode === "character"
            ? v.pinyin
            : v.simplified,
      answer,
      options: choice(
        data.vocabulary
          .filter((x) =>
            mode === "character"
              ? x.pinyin !== v.pinyin
              : mode === "pinyin"
                ? x.simplified !== v.simplified
                : x.pinyin !== v.pinyin,
          )
          .map((x) => (mode === "pinyin" ? x.pinyin : x.simplified)),
        answer,
      ),
      listen: mode === "listen",
      chinese: v.simplified,
      explanation: `${v.simplified} · ${v.pinyin} · ${v.meaning}`,
    };
  }
  if (area === "write") {
    const { v, c, i } = entry,
      nodes = usableComponents(c.decomposition, c.char),
      difficulty = settings.difficulty || "normal",
      blank =
        difficulty === "easy" ? Math.floor(Math.random() * nodes.length) : -1;
    return {
      ...base,
      vocabularyId: v.id,
      type: "component",
      prompt: `${v.meaning}${difficulty === "hard" ? "" : ` · ${v.pinyin}`}${v.characters.length > 1 ? ` (${i + 1}번째 글자 / ${v.characters.length}글자)` : ""}`,
      answer: c.char,
      nodes,
      decomposition: c.decomposition,
      blank,
      options: componentChoices(nodes, data.components),
      explanation: `${c.char} = ${nodes.map((n) => n.value).join(" + ")}`,
      chinese: c.char,
    };
  }
  if (area === "sentence") {
    const s = entry.item;
    return {
      ...base,
      type: "order",
      prompt: s.korean,
      answer: s.chinese,
      tokens: s.tokens,
      explanation: s.explanation || s.chinese,
      chinese: s.chinese,
    };
  }
  if (area === "grammar") {
    const g = entry.item;
    const mode = settings.grammarMode || "mixed",
      qs = [
        {
          type: "correct",
          prompt: `${g.title} — 맞는 문장을 고르세요.`,
          answer: g.correct_examples[0],
          options: choice(g.wrong_examples, g.correct_examples[0]),
        },
        {
          type: "wrong",
          prompt: `${g.title} — 틀린 문장을 고르세요.`,
          answer: g.wrong_examples[0],
          options: choice(g.correct_examples, g.wrong_examples[0]),
        },
        ...g.questions,
      ].filter((q) => mode === "mixed" || q.type === mode);
    if (!qs.length) return null;
    const q = shuffle(qs)[0];
    return {
      ...base,
      ...q,
      type: q.type === "order" ? "order" : "choice",
      options: q.options ? shuffle(q.options) : undefined,
      explanation: q.explanation || g.explanation,
    };
  }
  const c = entry.item,
    mode = settings.cultureMode || "choice";
  if (mode === "short")
    return {
      ...base,
      type: "short",
      prompt: `[${c.category}] ${c.question}`,
      answer: c.answer,
      explanation: c.explanation,
    };
  if (mode === "ox") {
    const proposed =
      c.distractors.length && Math.random() < 0.5
        ? shuffle(c.distractors)[0]
        : c.answer;
    return {
      ...base,
      type: "choice",
      prompt: `${c.question}\n제시된 답: ${proposed}`,
      answer: proposed === c.answer ? "O" : "X",
      options: shuffle(["O", "X"]),
      explanation: `정답: ${c.answer}\n${c.explanation}`,
    };
  }
  return {
    ...base,
    type: "choice",
    prompt: `[${c.category}] ${c.question}`,
    answer: c.answer,
    options: choice(c.distractors, c.answer),
    explanation: c.explanation,
  };
}
export function grade(q, value) {
  if (q.type === "component")
    return (
      Array.isArray(value) &&
      sameComponentMultiset(
        q.nodes.map((n) => n.value),
        value,
      )
    );
  if (q.type === "order") return strip(value) === strip(q.answer);
  if (q.type === "short")
    return (
      String(value).trim().normalize("NFC") === q.answer.trim().normalize("NFC")
    );
  return value === q.answer;
}
export function buildExam(data, counts, settings = {}) {
  const result = [];
  for (const [area, count] of Object.entries(counts)) {
    const pool = eligible(data, area, settings).filter(
      (e) => area !== "grammar" || makeQuestion(data, area, settings, e),
    );
    if (count > pool.length)
      throw Error(
        `${area}: 중복 없이 출제 가능한 항목은 ${pool.length}개입니다.`,
      );
    for (let i = 0; i < count; i++) {
      const e = weightedPick(pool),
        q = makeQuestion(data, area, settings, e);
      pool.splice(pool.indexOf(e), 1);
      if (q) result.push(q);
    }
  }
  return shuffle(result);
}
