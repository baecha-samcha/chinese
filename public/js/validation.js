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
// A decomposition tree has two node kinds: "layout" (a pure visual grouping —
// left-right/top-bottom/surround/other — with no character of its own) and
// "character" (a real, selectable component). A "character" node is always a
// leaf of the *assembly* tree: even though it may carry its own nested
// `decomposition` for a further, more detailed breakdown (e.g. 兄 = 口 + 儿
// inside 祝 = 礻 + 兄), that nesting is for a future detailed/recursive drill
// mode, not the default assembly question — leaves() intentionally stops at
// the nearest character node on each branch instead of flattening through it.
export function leaves(node, path = "root", position = "other") {
  if (!node) return [];
  if (node.type === "character") return [{ value: node.value, path, position }];
  return (node.children || []).flatMap((c, i) =>
    leaves(c, `${path}.${i}`, i === 0 ? "first" : i === 1 ? "second" : "other"),
  );
}
// Direct, usable components for a basic assembly question: leaves() output,
// minus anything that can't stand as a real answer choice (blank value, or a
// decomposition that only ever points back at the character itself).
export function usableComponents(decomposition, rootChar) {
  if (!decomposition) return [];
  let nodes;
  try {
    nodes = leaves(decomposition);
  } catch {
    return [];
  }
  const usable = (Array.isArray(nodes) ? nodes : []).filter(
    (n) => n && typeof n.value === "string" && n.value.trim() !== "",
  );
  if (!usable.length) return [];
  if (rootChar && usable.every((n) => n.value === rootChar)) return [];
  return usable;
}
// How many "layout" hops separate a leaf from the decomposition root — see
// leaves()'s path convention (one extra ".N" segment per layout level).
const depthOf = (n) => n.path.split(".").length - 1;
// A character is fair game for an assembly (component recall) question only
// when its decomposition is well-formed, breaks into 2+ real parts, and stays
// at a "meaningful component" grain rather than fragmenting down toward
// individual strokes: at most 3 leaves, at most 2 layout levels deep. Both
// thresholds come from auditing this project's actual decomposition data —
// every legitimate 2-3 part split found there (好=女+子, 明=日+月, 前=䒑+月+刂,
// even 天=一+大) stays within them, while the handful of over-fragmented
// entries (e.g. 德=彳+十+罒+一+心, 5 leaves) fall outside. Malformed, empty,
// self-referential, or over-fragmented decompositions still work fine for
// meaning/pronunciation study — they're just excluded from assembly here.
// `assemblyEnabled` on the character record (true/false) always overrides
// this heuristic, for curating specific characters either way without
// touching — or deleting — the underlying decomposition data itself.
export function assemblyEligible(c) {
  if (!c) return false;
  const nodes = usableComponents(c.decomposition, c.char);
  if (nodes.length < 2) return false;
  if (typeof c.assemblyEnabled === "boolean") return c.assemblyEnabled;
  return nodes.length <= 3 && nodes.every((n) => depthOf(n) <= 2);
}
function checkNode(n, depth = 0) {
  if (!n || typeof n !== "object" || depth > 8)
    throw Error("component 분해 깊이/구조 오류");
  if (n.type === "character") {
    if (!trim(n.value) || [...n.value].length > 4)
      throw Error("component value 오류");
    // Optional recursive breakdown of this component itself (e.g. 兄 = 口 + 儿),
    // reserved for a future detailed-assembly mode; validated the same way.
    if (n.decomposition) checkNode(n.decomposition, depth + 1);
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
    if (kind === "vocabulary" || kind === "sentences") {
      const source = typeof raw.source === "string" ? raw.source.trim() : raw.source;
      if (source == null || source === "") {
        data.source = null;
        warnings.push("출처 미지정: ‘둘 다’ 범위에서만 학습합니다");
      } else if (source === 0 || source === "0") data.source = 0;
      else if (source === 1 || source === "1") data.source = 1;
      else errors.push("source: 0(교과서) 또는 1(보충자료)만 입력하세요");
    }
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
        if (
          c.assemblyEnabled !== undefined &&
          typeof c.assemblyEnabled !== "boolean"
        )
          throw Error("assemblyEnabled: boolean 필요");
        return {
          char: c.char,
          traditional: trim(c.traditional),
          ...(c.decomposition ? { decomposition: c.decomposition } : {}),
          ...(typeof c.assemblyEnabled === "boolean"
            ? { assemblyEnabled: c.assemblyEnabled }
            : {}),
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
