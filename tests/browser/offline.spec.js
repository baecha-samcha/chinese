import { test, expect } from "@playwright/test";
test("app shell and study data keep working offline after one visit", async ({ page, context }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("main h1, main h2").first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.goto("/learn");
  await expect(page.locator("main .question, main .card").first()).toBeVisible();
  await context.setOffline(true);
  for (const route of ["/learn", "/write", "/test", "/match", "/"]) {
    await page.goto(route);
    await expect(page.getByText("마지막으로 저장된 학습 데이터")).toBeVisible();
  }
  // The shared quiz (quiz.js) keeps working offline, including sentences.
  await page.goto("/learn");
  await page.getByLabel("학습 대상").selectOption("sentence");
  await page.getByLabel("카테고리").selectOption("자기소개");
  await expect(page.locator(".question .prompt")).not.toBeEmpty();
  await page.locator(".option").first().click();
  await expect(page.locator(".feedback")).toBeVisible();
  // Typed pinyin (with the Chromebook-friendly numbered tones) and the
  // dismissed guide both keep working offline.
  await page.getByLabel("답 방식").selectOption("input");
  for (const [group, keep] of [["문제", "뜻"], ["정답", "병음"]])
    for (const name of ["뜻", "한자", "병음"]) {
      const b = page.getByRole("group", { name: `${group} 필드` }).getByRole("button", { name, exact: true });
      if ((await b.getAttribute("aria-pressed")) !== String(name === keep)) await b.click();
    }
  const guide = page.getByRole("dialog", { name: "병음 입력 안내" });
  await guide.getByRole("button", { name: "다시 보지 않기" }).click();
  await page.reload();
  await expect(page.getByLabel("병음 입력", { exact: true })).toBeVisible();
  await expect(guide).toHaveCount(0);
  await page.getByLabel("병음 입력", { exact: true }).fill("wo3 shi4");
  await page.getByLabel("병음 입력", { exact: true }).press("Enter");
  await expect(page.locator(".feedback .my-answer")).toHaveText("내 답: wo3 shi4");
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
