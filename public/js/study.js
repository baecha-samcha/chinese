import { shuffle, readLocal, writeLocal, sameComponentMultiset } from "./utils.js";
import { strip, usableComponents, assemblyEligible } from "./validation.js";
import { toneVariants } from "./pinyin.js";
import {
  studyItems,
  typeItems,
  toStudyItem,
  quizDirections,
  itemDirections,
  expressionGroup,
  buildQuizQuestion,
  gradeQuizAnswer,
} from "./quiz.js";
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
const DAY_MS = 86_400_000;
export function weight(key, stats = getStats(), now = Date.now()) {
  const s = stats[key];
  if (!s) return 2;
  // Not reviewed for a while: up to +2, reached after two weeks untouched.
  const idleDays = (now - Date.parse(s.lastSeen)) / DAY_MS;
  return (
    1 +
    Math.min(8, ((Number(s.wrong) || 0) * 2) / (1 + (Number(s.correct) || 0))) +
    2 / (1 + (Number(s.streak) || 0)) +
    (idleDays > 0 ? Math.min(2, idleDays / 7) : 0)
  );
}
// Quiz progress is kept per item *and* direction (vocabulary:5:meaning>pinyin),
// since recognizing a word and producing it are different skills. A direction
// with no history yet inherits the pre-refactor item-level record for the
// meaning/hanzi pair it used to cover, so existing progress still counts.
const legacyDirections = new Set(["meaning>hanzi", "hanzi>meaning"]);
export function directionWeight(entry, direction, stats = getStats()) {
  const key = `${entry.key}:${direction}`;
  if (!stats[key] && legacyDirections.has(direction) && stats[entry.key])
    return weight(entry.key, stats);
  return weight(key, stats);
}
// An entry that can be asked several ways is as urgent as its weakest way.
function entryWeight(item, key, stats) {
  return item?.directions?.length
    ? Math.max(...item.directions.map((d) => directionWeight(item, d, stats)))
    : weight(key(item), stats);
}
export function weightedPick(
  items,
  key = (x) => x.key,
  rng = Math.random,
  stats = getStats(),
) {
  if (!items.length) return null;
  const weights = items.map((x) => entryWeight(x, key, stats));
  let n = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    n -= weights[i];
    if (n <= 0) return items[i];
  }
  return items.at(-1);
}
// A stable identity for a candidate pool: same items regardless of order, so
// a settings/data change that leaves the eligible set unchanged doesn't
// discard an in-progress queue, but one that actually adds/removes items does.
const poolKey = (x) =>
  x.directions ? `${x.key}:${x.directions.join(",")}` : x.key;
export function poolSignature(pool, key = poolKey) {
  return pool
    .map(key)
    .sort()
    .join("|");
}
// weight()'s value for an item with no recorded history yet — the reference
// point copy counts are normalized against, so an all-fresh pool produces a
// cycle whose length equals the pool size (one copy each) rather than 2x it.
const BASELINE_WEIGHT = 2;
// One full "cycle" of a weighted shuffle bag: every eligible item appears at
// least once, and a currently-weak item (see `weight`) gets a few extra
// copies so it comes up more often — capped at 4x so a handful of hard items
// can't crowd out everything else in a single cycle. This is deliberately
// *not* independent weighted sampling (`weightedPick`, still used for
// one-shot exams in buildExam): over a long free-practice session,
// independent per-draw sampling from a large pool lets low-weight items go
// arbitrarily long without ever being picked while a few high-weight items
// keep recurring — which is exactly the "only a few questions keep
// repeating" symptom. A shuffle bag bounds both: nothing is starved, and
// nothing dominates beyond its capped share of one cycle.
export function buildQueue(pool, key = (x) => x.key, stats = getStats(), rng = Math.random) {
  const bag = pool.flatMap((item) =>
    Array(
      Math.min(
        4,
        Math.max(1, Math.round(entryWeight(item, key, stats) / BASELINE_WEIGHT)),
      ),
    ).fill(item),
  );
  return shuffle(bag, rng);
}
// Wrong answers come back after this many other questions — late enough to
// be real recall rather than short-term echo, soon enough to still matter.
export const RETRY_GAP = 3;
// How many recent expression groups the next question should avoid.
const GROUP_WINDOW = 2;
export function scheduleRetry(state, entry, gap = RETRY_GAP) {
  return {
    ...state,
    retry: [
      ...(state.retry || []).filter((r) => r.entry.key !== entry.key),
      { entry, wait: gap + 1 },
    ],
  };
}
// Brings an acceptable item to the front: never the previous question, and
// preferably nothing from a recently seen expression group — that second
// rule is dropped when nothing else is left rather than stalling.
function avoidRepeat(queue, lastKey, rng, recentGroups = []) {
  for (const strict of [true, false]) {
    const bad = (item) =>
      item.key === lastKey ||
      (strict && item.group != null && recentGroups.includes(item.group));
    if (!bad(queue[0])) return queue;
    const alternatives = queue.flatMap((item, i) => (bad(item) ? [] : [i]));
    if (!alternatives.length) continue;
    const j = alternatives[Math.floor(rng() * alternatives.length)];
    queue = [...queue];
    [queue[0], queue[j]] = [queue[j], queue[0]];
    return queue;
  }
  return queue;
}
// Draws the next question from a shuffle-bag `queue`, transparently starting
// a new cycle (a fresh buildQueue) when it runs out or when `pool` no longer
// matches what the queue was built from (settings/data changed). Avoids an
// exact immediate repeat of `lastKey` whenever the pool has any alternative:
// normally by swapping another queued item to the front, or — when the
// queue contains only copies of that matching item — by pulling the *next*
// cycle forward a draw early and folding the deferred items into it, rather
// than surfacing an avoidable repeat just because the old cycle happened to
// end there. Genuinely impossible (and not attempted) only when the pool
// itself has just one item. Entries carrying a `group` (quiz expression
// groups) are additionally kept away from the last GROUP_WINDOW groups the
// same way, relaxing that rule only when nothing else could be served. A due
// retry (scheduleRetry) is served before the queue. Returns a new state for
// the caller to carry between calls without managing the rebuild/signature
// bookkeeping itself.
export function drawFromQueue(state, pool, lastKey, rng = Math.random) {
  const sig = poolSignature(pool);
  if (!pool.length) return { ...state, queue: [], signature: sig, item: null };
  const recentGroups = state.recentGroups || [];
  const remember = (item) =>
    item.group == null
      ? recentGroups
      : [...recentGroups, item.group].slice(-GROUP_WINDOW);
  // A due retry (see scheduleRetry) goes first, re-resolved against the
  // current pool so a settings change can't resurrect a stale entry.
  const retry = [];
  let due = null;
  for (const r of state.retry || []) {
    const current = pool.find((p) => p.key === r.entry.key);
    if (!current) continue;
    const entry =
      r.entry.direction && current.directions?.includes(r.entry.direction)
        ? { ...current, direction: r.entry.direction }
        : current;
    if (!due && r.wait <= 1 && entry.key !== lastKey) due = entry;
    else retry.push({ entry, wait: r.wait - 1 });
  }
  if (due)
    return {
      queue: state.signature === sig ? state.queue : [],
      signature: sig,
      retry,
      recentGroups: remember(due),
      item: due,
    };
  const acceptable = (item, strict) =>
    item.key !== lastKey &&
    (!strict || item.group == null || !recentGroups.includes(item.group));
  let queue = state.signature === sig ? state.queue : [];
  if (!queue.length) {
    queue = buildQueue(pool, undefined, undefined, rng);
  } else if (
    [true, false].some(
      (strict) =>
        !queue.some((item) => acceptable(item, strict)) &&
        pool.some((item) => acceptable(item, strict)),
    )
  ) {
    queue = [...buildQueue(pool, undefined, undefined, rng), ...queue];
  }
  queue = avoidRepeat(queue, lastKey, rng, recentGroups);
  const [item, ...rest] = queue;
  return {
    queue: rest,
    signature: sig,
    retry,
    recentGroups: remember(item),
    item,
  };
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
  data = filterStudySource(data, settings);
  if (area === "learn") {
    const directions = quizDirections(settings);
    return studyItems(data, settings).flatMap((item) => {
      const usable = itemDirections(item, directions);
      return usable.length
        ? [
            {
              key: item.key,
              item,
              ...(item.type === "word" ? { v: item.row } : {}),
              directions: usable,
              group: expressionGroup(item),
            },
          ]
        : [];
    });
  }
  if (area === "pronunciation")
    return data.vocabulary
      .filter(
        (v) =>
          settings.pronunciationMode !== "tone" ||
          toneVariants(
            v.pinyin,
            v.characters?.length || [...v.simplified].length,
          ).length > 0,
      )
      .map((v) => ({ key: `vocabulary:${v.id}`, v }));
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
  data = filterStudySource(data, settings);
  const entry = source || weightedPick(eligible(data, area, settings));
  if (!entry) return null;
  const base = { key: entry.key, entryKey: entry.key, entry, area };
  if (area === "learn") {
    const item = entry.item || toStudyItem(entry.v, "word"),
      directions = entry.direction
        ? [entry.direction]
        : itemDirections(item, quizDirections(settings));
    if (!directions.length) return null;
    // Within an item, weaker directions are asked more often.
    const stats = getStats(),
      direction = weightedPick(
        directions,
        (d) => d,
        Math.random,
        Object.fromEntries(
          directions.map((d) => [
            d,
            stats[`${entry.key}:${d}`] ||
              (legacyDirections.has(d) ? stats[entry.key] : undefined),
          ]),
        ),
      );
    return {
      ...base,
      key: `${entry.key}:${direction}`,
      entry: { ...entry, direction },
      ...(item.type === "word" ? { vocabularyId: item.id } : {}),
      ...buildQuizQuestion(item, direction, typeItems(data, settings), settings),
    };
  }
  if (area === "pronunciation") {
    const v = entry.v,
      mode = settings.pronunciationMode || "pinyin",
      answer =
        mode === "tone"
          ? v.pinyin.normalize("NFC")
          : mode === "pinyin"
            ? v.pinyin
            : v.simplified;
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
        mode === "tone"
          ? toneVariants(
              v.pinyin,
              v.characters?.length || [...v.simplified].length,
            )
          : data.vocabulary
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
  if (q.grader) return gradeQuizAnswer(q, value);
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
