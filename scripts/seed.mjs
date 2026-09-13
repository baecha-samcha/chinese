import { writeFile, mkdir } from "node:fs/promises";
import { normalizePinyin, validateRow } from "../public/js/validation.js";
import { toCSV } from "../public/js/import.js";
const C = (value) => ({ type: "character", value }),
  L = (layout, ...values) => ({
    type: "layout",
    layout,
    children: values.map((v) => (typeof v === "string" ? C(v) : v)),
  });
const decompositions = {
  请: L("left-right", "讠", "青"),
  好: L("left-right", "女", "子"),
  你: L("left-right", "亻", "尔"),
  吗: L("left-right", "口", "马"),
  清: L("left-right", "氵", "青"),
  情: L("left-right", "忄", "青"),
  晴: L("left-right", "日", "青"),
  校: L("left-right", "木", "交"),
  学: L("top-bottom", L("top-bottom", "⺍", "冖"), "子"),
  明: L("left-right", "日", "月"),
  休: L("left-right", "亻", "木"),
  打: L("left-right", "扌", "丁"),
};
const vocab = [
  ["请", "請", "qǐng", "부탁하다", "청"],
  ["好", "好", "hǎo", "좋다", "호"],
  ["你", "你", "nǐ", "너", "니"],
  ["吗", "嗎", "ma", "의문을 나타내는 어기조사", "마"],
  ["清", "清", "qīng", "맑다", "청"],
  ["情", "情", "qíng", "감정", "정"],
  ["晴", "晴", "qíng", "날이 개다", "청"],
  ["学校", "學校", "xuéxiào", "학교", "학교"],
  ["学生", "學生", "xuéshēng", "학생", "학생"],
  ["老师", "老師", "lǎoshī", "선생님", "노사"],
  ["明", "明", "míng", "밝다", "명"],
  ["休", "休", "xiū", "쉬다", "휴"],
  ["打", "打", "dǎ", "치다", "타"],
].map(([simplified, traditional, pinyin, meaning, korean_hanja_reading]) => ({
  simplified,
  traditional,
  pinyin,
  meaning,
  korean_hanja_reading,
  characters: [...simplified].map((char, i) => ({
    char,
    traditional: [...traditional][i],
    ...(decompositions[char] ? { decomposition: decompositions[char] } : {}),
  })),
}));
const sentences = [
  {
    korean: "너는 학생이니?",
    chinese: "你是学生吗？",
    tokens: ["你", "是", "学生", "吗"],
    explanation: "평서문 끝에 吗를 붙여 예/아니요 의문문을 만듭니다.",
  },
  {
    korean: "너는 이름이 뭐니?",
    chinese: "你叫什么名字？",
    tokens: ["你", "叫", "什么", "名字"],
    explanation: "什么로 묻는 단순 의문절에는 吗를 함께 쓰지 않습니다.",
  },
  {
    korean: "나는 중국어를 공부한다.",
    chinese: "我学习中文。",
    tokens: ["我", "学习", "中文"],
    explanation: "주어 + 동사 + 목적어 순서입니다.",
  },
  {
    korean: "나는 선생님이 아니다.",
    chinese: "我不是老师。",
    tokens: ["我", "不", "是", "老师"],
    explanation: "不는 是 앞에 둡니다.",
  },
];
const grammar = [
  {
    title: "吗와 의문사",
    explanation:
      "같은 단순 의문절에서는 什么와 吗를 함께 쓰지 않습니다. 你知道他喜欢什么吗？처럼 내포절이 있는 문장은 별개입니다.",
    correct_examples: ["你叫什么名字？", "你知道他喜欢什么吗？"],
    wrong_examples: ["你叫什么名字吗？"],
    tags: ["의문문", "초급"],
    questions: [
      {
        type: "error",
        prompt: "你叫什么名字吗？에서 불필요한 부분은?",
        options: ["你", "叫", "什么", "吗"],
        answer: "吗",
      },
      {
        type: "blank",
        prompt: "你___什么名字？",
        options: ["叫", "是", "吗", "不"],
        answer: "叫",
      },
      {
        type: "order",
        prompt: "너는 학생이니? — 문장을 배열하세요.",
        tokens: ["你", "是", "学生", "吗"],
        answer: "你是学生吗？",
      },
    ],
  },
  {
    title: "是의 부정",
    explanation: "是 앞에 不를 놓아 부정합니다.",
    correct_examples: ["我不是老师。"],
    wrong_examples: ["我是老师不。", "我是不老师。"],
    tags: ["부정"],
    questions: [
      {
        type: "blank",
        prompt: "我___是老师。",
        options: ["不", "吗", "什么", "谁"],
        answer: "不",
      },
    ],
  },
  {
    title: "기본 어순",
    explanation: "초급 평서문은 주어 + 동사 + 목적어 순서로 구성합니다.",
    correct_examples: ["我学习中文。"],
    wrong_examples: ["我中文学习。"],
    tags: ["어순"],
    questions: [
      {
        type: "order",
        prompt: "나는 중국어를 공부한다.",
        tokens: ["我", "学习", "中文"],
        answer: "我学习中文。",
      },
    ],
  },
];
const culture = [
  {
    category: "명절",
    question: "중국의 음력 새해 명절은?",
    answer: "춘절",
    distractors: ["중추절", "단오절", "청명절"],
    explanation: "춘절(春节)은 음력 새해를 맞이하는 명절입니다.",
  },
  {
    category: "음식",
    question: "중추절에 대표적으로 먹는 음식은?",
    answer: "월병",
    distractors: ["쭝쯔", "탕위안", "자오쯔"],
    explanation: "월병(月饼)은 중추절의 대표 음식입니다.",
  },
  {
    category: "지역",
    question: "중국의 수도는?",
    answer: "베이징",
    distractors: ["상하이", "광저우", "시안"],
    explanation: "베이징(北京)이 수도입니다.",
  },
  {
    category: "숫자/색 상징",
    question: "중국에서 경사와 행운을 상징하는 대표적인 색은?",
    answer: "빨간색",
    distractors: ["흰색", "검은색", "회색"],
    explanation:
      "빨간색은 명절과 결혼식 등 경사스러운 상황에서 널리 사용합니다.",
  },
];
const data = { vocabulary: vocab, sentences, grammar, culture };
for (const [kind, rows] of Object.entries(data))
  for (const row of rows) {
    const v = validateRow(kind, row);
    if (v.status === "ERROR") throw Error(`${kind}: ${v.errors.join(",")}`);
  }
const quote = (v) =>
  "'" +
  String(typeof v === "object" ? JSON.stringify(v) : v).replace(/'/g, "''") +
  "'";
const tables = {
  vocabulary: "vocabulary",
  sentences: "sentences",
  grammar: "grammar_rules",
  culture: "culture_items",
};
const statements = [
  "-- Test data only. Re-running is safe for unchanged seed identities.",
];
for (const [kind, rows] of Object.entries(data))
  for (const r of rows) {
    const row =
      kind === "vocabulary"
        ? { ...r, pinyin_normalized: normalizePinyin(r.pinyin) }
        : r;
    const fields = Object.keys(row);
    const keys =
      kind === "vocabulary"
        ? ["simplified", "pinyin", "meaning"]
        : kind === "sentences"
          ? ["korean", "chinese"]
          : kind === "grammar"
            ? ["title"]
            : ["category", "question", "answer"];
    statements.push(
      `INSERT INTO ${tables[kind]} (${fields.join(",")}) SELECT ${fields.map((k) => quote(row[k])).join(",")} WHERE NOT EXISTS (SELECT 1 FROM ${tables[kind]} WHERE ${keys.map((k) => `${k}=${quote(row[k])}`).join(" AND ")});`,
    );
  }
await mkdir("public/fixtures", { recursive: true });
await writeFile("fixtures/seed.sql", statements.join("\n") + "\n");
await writeFile("fixtures/data.json", JSON.stringify(data, null, 2));
await writeFile(
  "public/fixtures/backup.json",
  JSON.stringify({ version: 1, ...data }, null, 2),
);
for (const [kind, rows] of Object.entries(data))
  await writeFile(`public/fixtures/${kind}.csv`, toCSV(rows));
console.log("Seed SQL and four CSV fixtures generated and validated.");
