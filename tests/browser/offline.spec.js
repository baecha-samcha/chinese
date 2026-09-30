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
  for (const route of ["/learn", "/match", "/"]) {
    await page.goto(route);
    await expect(page.getByText("마지막으로 저장된 학습 데이터")).toBeVisible();
  }
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
