import { test, expect } from "@playwright/test";
import XLSX from "xlsx";
test("source survives XLSX import/API/export and scopes persistent practice, search and exams", async ({ page, request }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const vocabulary = [
    { simplified: "林", traditional: "林", pinyin: "lín", meaning: "출처테스트 교과서 숲", source: 0 },
    { simplified: "明", traditional: "明", pinyin: "míng", meaning: "출처테스트 보충자료 밝다", source: 1 },
  ].map(r => ({ ...r, characters: JSON.stringify([{ char: r.simplified, decomposition: { type: "layout", layout: "left-right", children: [...(r.source === 0 ? "木木" : "日月")].map(value => ({ type: "character", value })) } }]) }));
  const sentences = [
    { korean: "출처테스트 교과서 문장", chinese: "你好！", tokens: '["你","好"]', source: 0 },
    { korean: "출처테스트 보충자료 문장", chinese: "我很好。", tokens: '["我","很","好"]', source: 1 },
  ];
  const book = XLSX.utils.book_new();
  for (const [kind, rows] of Object.entries({ vocabulary, sentences })) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), kind);
  const body = async (method, route, data) => request.fetch(route, { method, headers: { Origin: "http://127.0.0.1:8788" }, data });
  try {
    await page.goto("/admin/import");
    await page.getByLabel("가져올 파일").setInputFiles({ name: "source.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) });
    for (const kind of ["vocabulary", "sentences"]) {
      await page.getByLabel("시트 선택").selectOption(kind);
      await expect(page.locator("tbody")).toContainText("교과서");
      await expect(page.locator("tbody")).toContainText("보충자료");
      await page.getByRole("button", { name: "서버 검증 · 미리보기", exact: true }).click();
      await expect(page.getByRole("button", { name: "확인한 데이터 가져오기", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "확인한 데이터 가져오기", exact: true }).click();
      await expect(page.getByText("저장 완료: 2개 처리, 0개 기존 유지")).toBeVisible();
      const rows = await (await request.get(`/api/${kind}`)).json();
      for (const source of [0, 1]) expect(rows.some(r => (r.meaning || r.korean).includes("출처테스트") && r.source === source)).toBeTruthy();
    }
    const backup = await (await request.get("/api/export")).json();
    expect(backup.vocabulary.find(r => r.meaning === vocabulary[0].meaning).source).toBe(0);
    const existing = backup.vocabulary.find(r => r.meaning === vocabulary[0].meaning);
    expect((await body("PUT", `/api/vocabulary/${existing.id}`, { ...existing, source: 2 })).status()).toBe(422);
    expect((await body("PUT", `/api/vocabulary/${existing.id}`, existing)).ok()).toBeTruthy();
    await page.goto("/learn");
    await page.getByLabel("학습 출처", { exact: true }).selectOption("0");
    await expect(page.getByLabel("학습 출처", { exact: true })).toHaveValue("0");
    await page.getByLabel("direction", { exact: true }).selectOption("reverse");
    await expect(page.locator(".prompt")).toContainText("출처테스트 교과서");
    await page.getByLabel("학습 단어 검색").fill("출처테스트");
    await expect(page.locator(".search-results")).toContainText("교과서");
    await expect(page.locator(".search-results")).not.toContainText("보충자료");
    await page.getByLabel("학습 출처", { exact: true }).selectOption("1");
    await expect(page.locator(".prompt")).toContainText("출처테스트 보충자료");
    await page.reload();
    await expect(page.getByLabel("학습 출처", { exact: true })).toHaveValue("1");
    await page.goto("/sentence");
    await expect(page.locator(".prompt")).toHaveText("출처테스트 보충자료 문장");
    await page.goto("/write");
    await expect(page.locator(".prompt")).toContainText("보충자료");
    await page.goto("/pronunciation");
    await expect(page.locator(".prompt")).toHaveText("明");
    await page.goto("/test");
    await expect(page.getByLabel("뜻 학습 문제 수")).toHaveAttribute("max", "1");
    await expect(page.getByLabel("문장 배열 문제 수")).toHaveAttribute("max", "1");
    await page.getByLabel("학습 출처", { exact: true }).selectOption("all");
    expect(Number(await page.getByLabel("뜻 학습 문제 수").getAttribute("max"))).toBeGreaterThan(2);
    await page.getByLabel("학습 출처", { exact: true }).selectOption("0");
    for (const input of await page.locator('input[type="number"]').all()) await input.fill("0");
    await page.getByLabel("문장 배열 문제 수").fill("1");
    await page.getByRole("button", { name: "시험 시작", exact: true }).click();
    await expect(page.locator(".prompt")).toHaveText("출처테스트 교과서 문장");
    await expect(page.getByLabel("학습 출처", { exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {
    for (const kind of ["vocabulary", "sentences"]) {
      const rows = await (await request.get(`/api/${kind}`)).json();
      for (const r of rows.filter(r => (r.meaning || r.korean).includes("출처테스트"))) await body("DELETE", `/api/${kind}/${r.id}`);
    }
  }
});
