export const kinds = ["vocabulary", "sentences", "grammar", "culture"];
export const normalizePinyin = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s'’0-5]/g, "")
    .replace(/u:/g, "u");
export const identity = (kind, r) =>
  JSON.stringify(
    kind === "vocabulary"
      ? [r.simplified, r.pinyin, r.meaning]
      : kind === "sentences"
        ? [r.korean, r.chinese]
        : kind === "grammar"
          ? [r.title]
          : [r.category, r.question, r.answer],
  );
const trim = (v) => (typeof v === "string" ? v.trim() : "");
const parse = (v, fallback) =>
  v == null || v === "" ? fallback : typeof v === "string" ? JSON.parse(v) : v;
export function leaves(node, path = "root", position = "other") {
  if (!node) return [];
  if (node.type === "character") return [{ value: node.value, path, position }];
  return (node.children || []).flatMap((c, i) =>
    leaves(c, `${path}.${i}`, i === 0 ? "first" : i === 1 ? "second" : "other"),
  );
}
function checkNode(n, depth = 0) {
  if (!n || typeof n !== "object" || depth > 8)
    throw Error("component 분해 깊이/구조 오류");
  if (n.type === "character") {
    if (!trim(n.value) || [...n.value].length > 4)
      throw Error("component value 오류");
    return;
  }
  if (
    n.type !== "layout" ||
    !["left-right", "top-bottom", "surround", "other"].includes(n.layout) ||
    !Array.isArray(n.children) ||
    n.children.length < 2 ||
    n.children.length > 8
  )
    throw Error("component layout/children 오류");
  n.children.forEach((c) => checkNode(c, depth + 1));
}
function strings(v, field, min = 0) {
  const a = parse(v, []);
  if (
    !Array.isArray(a) ||
    a.length < min ||
    a.length > 100 ||
    a.some((s) => !trim(s) || s.length > 2000)
  )
    throw Error(`${field}: 문자열 배열 필요`);
  return a.map((s) => s.trim());
}
export function validateRow(kind, raw, existing = []) {
  const errors = [],
    warnings = [];
  let data = {};
  try {
    if (!kinds.includes(kind) || !raw || typeof raw !== "object")
      throw Error("데이터 유형 오류");
    const fields =
      kind === "vocabulary"
        ? [
            "simplified",
            "traditional",
            "pinyin",
            "meaning",
            "korean_hanja_reading",
          ]
        : kind === "sentences"
          ? ["korean", "chinese", "explanation"]
          : kind === "grammar"
            ? ["title", "explanation"]
            : ["category", "question", "answer", "explanation"];
    for (const f of fields) {
      data[f] = trim(raw[f]);
      if (data[f].length > 4000) throw Error(`${f}: 최대 4000자`);
    }
    const required =
      kind === "vocabulary"
        ? ["simplified", "pinyin", "meaning"]
        : kind === "sentences"
          ? ["korean", "chinese"]
          : kind === "grammar"
            ? ["title", "explanation"]
            : ["category", "question", "answer"];
    for (const f of required) if (!data[f]) errors.push(`${f} 없음`);
    if (kind === "vocabulary") {
      if ([...data.simplified].length > 32) errors.push("단어는 최대 32글자");
      data.characters = parse(
        raw.characters,
        [...data.simplified].map((char, i) => ({
          char,
          traditional: [...data.traditional][i] || "",
        })),
      );
      if (
        !Array.isArray(data.characters) ||
        data.characters.length !== [...data.simplified].length
      )
        throw Error("characters: 단어의 글자별 배열 필요");
      data.characters = data.characters.map((c, i) => {
        if (c.char !== [...data.simplified][i])
          throw Error("characters 순서와 simplified 불일치");
        if (c.decomposition) checkNode(c.decomposition);
        return {
          char: c.char,
          traditional: trim(c.traditional),
          ...(c.decomposition ? { decomposition: c.decomposition } : {}),
        };
      });
      if (!data.traditional) warnings.push("번체자 누락");
      if (data.characters.some((c) => !c.decomposition))
        warnings.push("component 분해 없음: 해당 글자는 조립 문제에서 제외");
      if (
        existing.some(
          (r) =>
            r.simplified === data.simplified &&
            identity(kind, r) !== identity(kind, data),
        )
      )
        warnings.push("기존 DB에 비슷한 단어");
      if (
        existing.some(
          (r) =>
            r.pinyin === data.pinyin &&
            r.meaning === data.meaning &&
            r.simplified !== data.simplified,
        )
      )
        warnings.push("같은 병음·뜻의 다른 후보");
    }
    if (kind === "sentences") {
      data.tokens = strings(raw.tokens, "tokens", 2);
      if (strip(data.tokens.join("")) !== strip(data.chinese))
        errors.push("tokens를 합친 문장과 chinese 불일치");
    }
    if (kind === "grammar") {
      data.correct_examples = strings(
        raw.correct_examples,
        "correct_examples",
        1,
      );
      data.wrong_examples = strings(raw.wrong_examples, "wrong_examples", 1);
      data.tags = strings(raw.tags, "tags");
      if (data.correct_examples.some((s) => data.wrong_examples.includes(s)))
        errors.push("정답/오답 예문이 중복");
      data.questions = parse(raw.questions, []);
      if (!Array.isArray(data.questions) || data.questions.length > 100)
        throw Error("questions 배열 오류");
      data.questions = data.questions.map((q) => {
        if (
          !["correct", "wrong", "error", "blank", "order"].includes(q.type) ||
          !trim(q.prompt)
        )
          throw Error("문법 question type/prompt 오류");
        const a = {
          type: q.type,
          prompt: trim(q.prompt),
          explanation: trim(q.explanation),
        };
        if (q.type === "order") {
          a.tokens = strings(q.tokens, "question tokens", 2);
          a.answer = trim(q.answer);
          if (strip(a.tokens.join("")) !== strip(a.answer))
            throw Error("문법 배열 정답 불일치");
        } else {
          a.options = strings(q.options, "options", 2);
          a.answer = trim(q.answer);
          if (
            !a.options.includes(a.answer) ||
            new Set(a.options).size !== a.options.length
          )
            throw Error("문법 options/answer 오류");
        }
        return a;
      });
    }
    if (kind === "culture") {
      data.distractors = strings(raw.distractors, "distractors");
      if (data.distractors.includes(data.answer))
        errors.push("문화 오답 보기에 정답 포함");
    }
  } catch (e) {
    errors.push(e.message || "JSON 형식 오류");
  }
  const duplicates = existing.filter(
    (r) => identity(kind, r) === identity(kind, data),
  );
  if (duplicates.length)
    warnings.push(`동일 항목 ${duplicates.length}개: 중복 정책 확인`);
  return {
    data,
    errors,
    warnings,
    duplicates: duplicates.map((r) => r.id),
    status: errors.length ? "ERROR" : warnings.length ? "WARNING" : "VALID",
  };
}
export const strip = (s) => String(s).replace(/[\s\p{P}]/gu, "");
