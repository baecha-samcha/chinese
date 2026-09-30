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
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
