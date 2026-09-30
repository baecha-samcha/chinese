import { test, expect } from "@playwright/test";
import XLSX from "xlsx";
const origin = "http://127.0.0.1:8788";
const send = (request, method, path, data) => request.fetch(path, { method, headers: { Origin: origin }, data });
async function overwriteImport(page, file) {
  await page.goto("/admin/import");
  await page.getByLabel("데이터 유형").selectOption(file.kind);
  await page.getByLabel("가져올 파일").setInputFiles(file);
  if (file.name.endsWith(".xlsx")) await page.getByLabel("시트 선택").selectOption(file.sheet);
  await expect(page.getByText("없는 열은 기존 값 유지")).toBeVisible();
  await page.getByLabel("전체 중복 정책").selectOption("overwrite");
  await page.getByRole("button", { name: "서버 검증 · 미리보기", exact: true }).click();
  await page.getByRole("button", { name: "확인한 데이터 가져오기", exact: true }).click();
  await expect(page.getByText(/저장 완료: 1개 처리/)).toBeVisible();
}
const csv = (rows) => {
  const headers = Object.keys(rows[0]);
  const q = (v) => `"${String(v).replaceAll('"', '""')}"`;
  return Buffer.from([headers.join(","), ...rows.map((r) => headers.map((h) => q(r[h])).join(","))].join("\n"));
};
const xlsx = (sheet, rows) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), sheet);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};
const find = async (request, kind, match) => (await (await request.get(`/api/${kind}`)).json()).find(match);

test("overwrite import keeps columns the file doesn't have, clears present empty cells, never drops decompositions", async ({ page, request }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sentence = { korean: "보존테스트 문장", chinese: "我们很好。", tokens: ["我们", "很", "好"], explanation: "원래 설명", pinyin: "Wǒmen hěn hǎo.", category: "보존", source: 1 };
  const decomposition = { type: "layout", layout: "left-right", children: [{ type: "character", value: "氵" }, { type: "character", value: "胡" }] };
  const word = { simplified: "湖", traditional: "湖", pinyin: "hú", meaning: "보존테스트 호수", korean_hanja_reading: "호", source: 0, characters: [{ char: "湖", traditional: "湖", decomposition }] };
  expect((await send(request, "POST", "/api/sentences", sentence)).ok()).toBeTruthy();
  expect((await send(request, "POST", "/api/vocabulary", word)).ok()).toBeTruthy();
  const isSentence = (r) => r.korean === sentence.korean;
  const isWord = (r) => r.meaning === word.meaning;
  try {
    // CSV without explanation/pinyin/category/source: all four are kept.
    await overwriteImport(page, { kind: "sentences", name: "keep.csv", mimeType: "text/csv", buffer: csv([{ korean: sentence.korean, chinese: sentence.chinese, tokens: JSON.stringify(["我们", "很", "好"]) }]) });
    let row = await find(request, "sentences", isSentence);
    expect([row.explanation, row.pinyin, row.category, row.source]).toEqual(["원래 설명", "Wǒmen hěn hǎo.", "보존", 1]);
    // XLSX that only changes explanation: pinyin/category/source still kept.
    await overwriteImport(page, { kind: "sentences", name: "keep.xlsx", sheet: "sentences", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlsx("sentences", [{ korean: sentence.korean, chinese: sentence.chinese, tokens: JSON.stringify(["我们", "很", "好"]), explanation: "새 설명" }]) });
    row = await find(request, "sentences", isSentence);
    expect([row.explanation, row.pinyin, row.category, row.source]).toEqual(["새 설명", "Wǒmen hěn hǎo.", "보존", 1]);
    // A present-but-empty pinyin column is an explicit clear; category untouched.
    await overwriteImport(page, { kind: "sentences", name: "clear.csv", mimeType: "text/csv", buffer: csv([{ korean: sentence.korean, chinese: sentence.chinese, tokens: JSON.stringify(["我们", "很", "好"]), pinyin: "" }]) });
    row = await find(request, "sentences", isSentence);
    expect([row.pinyin, row.category, row.explanation]).toEqual(["", "보존", "새 설명"]);
    // Vocabulary without a characters column keeps its decomposition, source and traditional.
    await overwriteImport(page, { kind: "vocabulary", name: "word.csv", mimeType: "text/csv", buffer: csv([{ simplified: "湖", pinyin: "hú", meaning: word.meaning, korean_hanja_reading: "호수 호" }]) });
    let w = await find(request, "vocabulary", isWord);
    expect(w.characters[0].decomposition).toEqual(decomposition);
    expect([w.korean_hanja_reading, w.source, w.traditional]).toEqual(["호수 호", 0, "湖"]);
    // ...and an empty characters cell doesn't wipe it either (XLSX this time).
    await overwriteImport(page, { kind: "vocabulary", name: "word.xlsx", sheet: "vocabulary", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlsx("vocabulary", [{ simplified: "湖", pinyin: "hú", meaning: word.meaning, characters: "", traditional: "" }]) });
    w = await find(request, "vocabulary", isWord);
    expect(w.characters[0].decomposition).toEqual(decomposition);
    expect(w.traditional).toBe("");
    expect(w.source).toBe(0);
  } finally {
    const s = await find(request, "sentences", isSentence);
    if (s) await send(request, "DELETE", `/api/sentences/${s.id}`);
    const v = await find(request, "vocabulary", isWord);
    if (v) await send(request, "DELETE", `/api/vocabulary/${v.id}`);
  }
  expect(errors).toEqual([]);
});
