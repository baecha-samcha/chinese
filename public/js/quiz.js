// Shared quiz engine for words and sentences. Both are normalized to a
// StudyItem with the same three faces (meaning / hanzi / pinyin), and a
// question is just "show sourceField, ask for targetField" — the item type
// only decides where the rows come from, never how the quiz works.
import { shuffle } from "./utils.js";
import { strip } from "./validation.js";
import { pinyinAnswerKey, toneVariants } from "./pinyin.js";

export const FIELDS = ["meaning", "hanzi", "pinyin"];
export const FIELD_LABELS = { meaning: "뜻", hanzi: "한자", pinyin: "병음" };
export const STUDY_TARGETS = { word: "단어", sentence: "문장" };

export function toStudyItem(row, type) {
  return type === "sentence"
    ? {
        type,
        id: row.id,
        key: `sentences:${row.id}`,
        meaning: row.korean || "",
        hanzi: row.chinese || "",
        pinyin: row.pinyin || "",
        category: row.category || "",
        source: row.source ?? null,
        row,
      }
    : {
        type: "word",
        id: row.id,
        key: `vocabulary:${row.id}`,
        meaning: row.meaning || "",
        hanzi: row.simplified || "",
        pinyin: row.pinyin || "",
        category: row.category || "",
        source: row.source ?? null,
        row,
      };
}

export const studyTarget = (settings = {}) =>
  settings.studyTarget === "sentence" ? "sentence" : "word";

// All items of the selected type, before the category filter — the category
// narrows what gets asked, but distractors may come from the whole type.
export function typeItems(data, settings = {}) {
  const type = studyTarget(settings);
  return (type === "sentence" ? data.sentences : data.vocabulary || []).map(
    (row) => toStudyItem(row, type),
  );
}

export function studyItems(data, settings = {}) {
  const category = settings.quizCategory || "all";
  return typeItems(data, settings).filter(
    (item) => category === "all" || item.category === category,
  );
}

export function categories(data, settings = {}) {
  return [
    ...new Set(typeItems(data, settings).map((i) => i.category).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "ko"));
}

const pick = (list, fallback) => {
  const valid = Array.isArray(list) ? list.filter((f) => FIELDS.includes(f)) : [];
  return valid.length || Array.isArray(list) ? valid : fallback;
};
// Question/answer fields, falling back to the pre-refactor `direction`
// setting (forward = 한자 → 뜻, reverse = 뜻 → 한자, mixed = both).
export function quizFields(settings = {}) {
  const legacy =
    settings.direction === "forward"
      ? [["hanzi"], ["meaning"]]
      : settings.direction === "reverse"
        ? [["meaning"], ["hanzi"]]
        : [
            ["meaning", "hanzi"],
            ["meaning", "hanzi"],
          ];
  return {
    source: pick(settings.quizSource, legacy[0]),
    target: pick(settings.quizTarget, legacy[1]),
  };
}

export const directionId = (source, target) => `${source}>${target}`;
export const parseDirection = (id) => id.split(">");
export const directionLabel = (id) =>
  parseDirection(id)
    .map((f) => FIELD_LABELS[f])
    .join(" → ");

// Every selected source × target pair, minus same-field pairs.
export function quizDirections(settings = {}) {
  const { source, target } = quizFields(settings);
  return source.flatMap((s) =>
    target.filter((t) => t !== s).map((t) => directionId(s, t)),
  );
}

// Directions this item can actually be asked in (e.g. a sentence whose pinyin
// hasn't been entered yet is skipped for anything involving pinyin).
export function itemDirections(item, directions) {
  return directions.filter((id) =>
    parseDirection(id).every((f) => String(item[f] || "").trim()),
  );
}

// Items that open with the same two characters (祝你…, 我是…) are one
// "expression group", so a session doesn't serve a run of near-identical
// prompts back to back.
export function expressionGroup(item) {
  const head = [...item.hanzi].filter((c) => /\p{Script=Han}/u.test(c));
  return `${item.type}|${item.category}|${head.slice(0, 2).join("")}`;
}

// Equality as the grader sees it, so a distractor that would also be graded
// correct (晴 qíng vs 情 qíng) never appears next to the answer.
export function answerKey(field, value) {
  if (field === "pinyin") return pinyinAnswerKey(value);
  if (field === "hanzi") return strip(String(value).normalize("NFC"));
  return String(value).trim().normalize("NFC");
}

// A distractor must be wrong for *this prompt*: besides never repeating the
// answer, it can't come from another item that shows the same prompt (같은 뜻
// "몇 살이니?" → 你几岁了？/你多大了？, same pinyin qíng → 晴/情), since
// that item's answer would be just as correct.
function options(item, source, field, pool, rng) {
  const answer = item[field],
    prompt = answerKey(source, item[source]),
    // Answers of every item showing this same prompt count as correct too,
    // wherever else that value appears (认识 "알다" vs 认识 "알게 되다").
    seen = new Set([
      answerKey(field, answer),
      ...pool
        .filter((o) => o[source] && o[field] && answerKey(source, o[source]) === prompt)
        .map((o) => answerKey(field, o[field])),
    ]),
    others = [];
  for (const other of shuffle(pool, rng)) {
    const value = other[field],
      key = value && answerKey(field, value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    others.push(value);
    if (others.length === 3) break;
  }
  // Too few other items (tiny category or dataset): tone variants of the
  // answer still make a fair pinyin distractor.
  if (field === "pinyin" && others.length < 3)
    for (const variant of toneVariants(answer, undefined, 3)) {
      if (others.length === 3) break;
      if (!seen.has(answerKey(field, variant))) {
        seen.add(answerKey(field, variant));
        others.push(variant);
      }
    }
  return shuffle([answer, ...others], rng);
}

// Builds one question. Typed input is offered for hanzi/pinyin answers; a
// Korean meaning can't be graded fairly as free text, so it stays choice.
export function buildQuizQuestion(item, direction, pool, settings = {}, rng = Math.random) {
  const [source, target] = parseDirection(direction),
    typed = settings.answerMode === "input" && target !== "meaning",
    question = {
      direction,
      label: directionLabel(direction),
      promptField: source,
      answerField: target,
      prompt: item[source],
      promptLang: source === "meaning" ? "ko" : "zh-CN",
      promptClass:
        source === "hanzi" && item.type === "word" ? "hanzi prompt" : "prompt",
      answer: item[target],
      explanation: `${item.hanzi} · ${item.pinyin || "병음 미입력"} · ${item.meaning}`,
      chinese: item.hanzi,
    };
  if (typed)
    return {
      ...question,
      type: "short",
      grader: target,
      inputLabel: `${FIELD_LABELS[target]} 입력`,
      placeholder:
        target === "pinyin"
          ? "병음 입력 · 성조 기호 또는 숫자 (ni3 hao3)"
          : "한자 입력",
    };
  return {
    ...question,
    type: "choice",
    options: options(item, source, target, pool, rng),
  };
}

export function gradeQuizAnswer(q, value) {
  return answerKey(q.grader, value ?? "") === answerKey(q.grader, q.answer);
}
