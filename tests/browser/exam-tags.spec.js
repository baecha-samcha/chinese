import { test, expect } from "@playwright/test";
// Fixtures: 你 is in 2026-midterm, 好 in 2026-midterm and 2026-final, 学校 only
// in the test-only 2026-final. Source (교과서/보충자료) is a separate field.
test("exam scope tags: registry, API validation, import and admin badges, study filter and exam label", async ({ page, request }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const body = (method, route, data) => request.fetch(route, { method, headers: { Origin: "http://127.0.0.1:8788" }, data });

  expect(await (await request.get("/api/exams")).json()).toEqual([
    { id: "2026-midterm", label: "2026 중간고사" },
    { id: "2026-final", label: "2026 기말고사" },
  ]);
  const vocabulary = await (await request.get("/api/vocabulary")).json();
  const hao = vocabulary.find((r) => r.simplified === "好" && r.meaning === "좋다");
  const xuexiao = vocabulary.find((r) => r.simplified === "学校");
  expect(hao.exam_tags).toEqual(["2026-midterm", "2026-final"]);
  expect(xuexiao.exam_tags).toEqual(["2026-final"]);
  // Unknown or malformed exam IDs are rejected; valid tags round-trip and
  // leave source alone.
  expect((await body("PUT", `/api/vocabulary/${xuexiao.id}`, { ...xuexiao, exam_tags: ["2027-final"] })).status()).toBe(422);
  expect((await body("PUT", `/api/vocabulary/${xuexiao.id}`, { ...xuexiao, exam_tags: ["2026 Final"] })).status()).toBe(422);
  expect((await body("PUT", `/api/vocabulary/${xuexiao.id}`, { ...xuexiao, source: 1, exam_tags: ["2026-final", "2026-midterm"] })).ok()).toBeTruthy();
  const saved = await (await request.get(`/api/vocabulary/${xuexiao.id}`)).json();
  expect(saved).toMatchObject({ source: 1, exam_tags: ["2026-final", "2026-midterm"] });
  expect((await body("PUT", `/api/vocabulary/${xuexiao.id}`, xuexiao)).ok()).toBeTruthy();
  expect((await (await request.get("/api/export")).json()).grammar.find((r) => r.title === "吗와 의문사").exam_tags).toEqual(["2026-midterm"]);

  // Admin list: source and exam scope are separate badges.
  await page.goto("/admin/vocabulary");
  await page.getByLabel("관리 데이터 검색").fill("좋다");
  const row = page.locator("tbody tr", { hasText: "hǎo" });
  await expect(row.locator(".badge:not(.exam)")).toHaveText("출처 미지정");
  await expect(row.locator(".badge.exam")).toHaveText(["2026 중간고사", "2026 기말고사"]);

  // Import preview labels exam tags; an unregistered exam fails server validation.
  await page.goto("/admin/import");
  await page.getByLabel("유형").selectOption("vocabulary");
  const csv = '﻿simplified,pinyin,meaning,source,exam_tags\n"林","lín","시험태그 숲","0","2026-midterm, 2026-final"\n"森","sēn","시험태그 나무숲","1","2027-final"\n';
  await page.getByLabel("가져올 파일").setInputFiles({ name: "tags.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const preview = page.locator("tbody tr");
  await expect(preview.nth(0).locator(".badge.exam")).toHaveText(["2026 중간고사", "2026 기말고사"]);
  await expect(preview.nth(0).locator(".badge:not(.exam):not([class*=status])")).toHaveText("교과서");
  await page.getByRole("button", { name: "서버 검증 · 미리보기", exact: true }).click();
  await expect(preview.nth(1)).toContainText("등록되지 않은 시험 범위 2027-final");
  await expect(page.getByRole("button", { name: "확인한 데이터 가져오기", exact: true })).toBeDisabled();

  // Study filter: 시험 범위 is its own select next to 학습 범위 (source).
  await page.goto("/learn");
  const exam = page.getByLabel("시험 범위", { exact: true });
  await expect(exam.locator("option")).toHaveText(["전체", "2026 중간고사", "2026 기말고사"]);
  await expect(page.getByLabel("학습 출처", { exact: true }).locator("option")).toHaveText(["둘 다", "교과서만", "보충자료만"]);
  await exam.selectOption("2026-final");
  await page.getByLabel("학습 대상").selectOption("word");
  const allowed = new Set(["好", "学校", "좋다", "학교", "hǎo", "xuéxiào"]);
  for (let i = 0; i < 6; i++) {
    const prompt = (await page.locator(".question .prompt").innerText()).trim();
    expect(allowed.has(prompt), prompt).toBe(true);
    await page.locator(".option").first().click();
    await page.getByRole("button", { name: "다음 문제 →" }).click();
  }
  await page.reload();
  await expect(page.getByLabel("시험 범위", { exact: true })).toHaveValue("2026-final");
  // Source and exam scope combine: 교과서 ∩ 2026-final has no fixture word.
  await page.getByLabel("학습 출처", { exact: true }).selectOption("0");
  await expect(page.getByText("학습할 데이터가 없습니다.")).toBeVisible();
  await page.getByLabel("학습 출처", { exact: true }).selectOption("all");
  await page.getByLabel("시험 범위", { exact: true }).selectOption("all");

  // The practice exam shows the scope label from its data, not a hardcoded name.
  await page.goto("/exam");
  await expect(page.locator(".exam-lobby .note")).toContainText("시험 범위: 2026 중간고사");
  await page.getByRole("button", { name: "50분 시험 시작" }).click();
  await expect(page.locator(".exam-question")).toHaveCount(29);
  await expect(page.locator(".exam-paper-heading")).toContainText("범위: 2026 중간고사 시험 범위");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ch.exam.v1")).exam)).toEqual({ id: "2026-midterm", label: "2026 중간고사" });
  await page.evaluate(() => localStorage.removeItem("ch.exam.v1"));
  expect(errors).toEqual([]);
});
