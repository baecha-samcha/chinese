import { test, expect } from "@playwright/test";
// Every study area shares one layout system: page header → QuizToolbar →
// QuizCard (prompt → answer area → feedback area → action bar) → 단어 찾기.
const areas = ["/learn", "/write", "/pronunciation", "/sentence", "/grammar", "/culture"];
const viewports = {
  desktop: { width: 1440, height: 900 },
  chromebook: { width: 1280, height: 650 },
  mobile: { width: 390, height: 844 },
};
const failures = [];
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => failures.push(e.message));
});
test.afterEach(() => {
  expect(failures.splice(0)).toEqual([]);
});

// Answers the current question however its type requires.
async function answer(page) {
  const card = page.locator(".question");
  const type = await card.getAttribute("data-type");
  if (type === "choice") return card.locator(".option").first().click();
  if (type === "short") {
    await card.locator(".answer-input").fill("x");
    return card.getByRole("button", { name: "정답 확인", exact: true }).click();
  }
  // order / component: fill every slot from the pool, then submit.
  const submit = card.locator(".actions-primary button");
  while (await submit.isDisabled())
    await card.locator(".blocks button:not([disabled])").first().click();
  return submit.click();
}

test("every study area uses the same toolbar and quiz card skeleton before and after answering", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize(viewports.desktop);
  for (const route of areas) {
    await page.goto(route);
    await expect(page.locator(".study-page")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    const toolbar = page.locator(".study-page > .quiz-toolbar");
    await expect(toolbar).toHaveCount(1);
    await expect(toolbar.getByLabel("학습 출처", { exact: true })).toBeVisible();
    // Scope rules are one click away, not a paragraph on every screen.
    await expect(toolbar.getByText("범위 적용 기준")).toBeVisible();
    await expect(toolbar.getByText(/단어·문장에 적용/)).toBeHidden();
    const card = page.locator(".question");
    await expect(card).toBeVisible();
    expect(
      await card.evaluate((n) => [...n.children].map((c) => c.className)),
      route,
    ).toEqual(["question-head", "question-prompt", "answer-area", "feedback-area", "action-bar"]);
    await expect(card.locator(".feedback-area .feedback-hint")).not.toBeEmpty();
    const skip = card.locator(".actions-secondary").getByRole("button", { name: "건너뛰기" });
    await expect(skip).toBeVisible();
    // The search utility sits after the card, apart from the study flow.
    await expect(page.locator(".study-page > .utility").getByRole("searchbox")).toBeVisible();

    await answer(page);
    await expect(card.locator(".feedback-area .feedback")).toBeVisible();
    await expect(card.locator(".feedback-title")).toContainText(/[✓✕]/);
    await expect(skip).toBeHidden();
    const next = card.locator(".actions-primary").getByRole("button", { name: "다음 문제 →" });
    await expect(next).toBeFocused();
    // 다음 문제 is always the right-most control at the bottom of the card.
    const [nextBox, cardBox] = [await next.boundingBox(), await card.boundingBox()];
    expect(cardBox.x + cardBox.width - (nextBox.x + nextBox.width), route).toBeLessThan(40);
    expect(cardBox.y + cardBox.height - (nextBox.y + nextBox.height), route).toBeLessThan(40);
    await next.click();
    await expect(card.locator(".feedback")).toHaveCount(0);
  }
});

test("choice options say which one was right without relying on color", async ({ page }) => {
  await page.goto("/culture");
  await page.getByLabel("문제 유형", { exact: true }).selectOption("choice");
  const options = page.locator(".question .option");
  await options.first().click();
  await expect(page.locator(".option.correct .option-mark")).toHaveText("✓ 정답");
  if (await page.locator(".feedback.error").count())
    await expect(page.locator(".option.wrong .option-mark")).toHaveText("✕ 내 답");
});

test("option grids follow the option count so no cell is left empty", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const columns = (loc) =>
    loc.evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(" ").length);
  await page.goto("/culture");
  await page.getByLabel("문제 유형", { exact: true }).selectOption("ox");
  await expect(page.locator(".options")).toHaveAttribute("data-count", "2");
  expect(await columns(page.locator(".options"))).toBe(2);
  // Whatever counts the data yields: 3 → one column, 2/4 → two columns.
  await page.goto("/grammar");
  for (let i = 0; i < 8; i++) {
    const options = page.locator(".question .options");
    if (await options.count()) {
      const count = Number(await options.getAttribute("data-count"));
      expect(await columns(options), `${count} options`).toBe(count % 2 ? 1 : 2);
    }
    await page.getByRole("button", { name: "건너뛰기" }).click();
  }
});

test("home leads with the study modes and a one-line progress summary", async ({ page }) => {
  await page.setViewportSize(viewports.chromebook);
  await page.goto("/");
  await expect(page.locator(".stat-line")).toHaveText(/\d+개 학습\s*·?\s*\d+회 풀이\s*·?\s*정답률/);
  for (const href of ["/learn", "/write", "/pronunciation", "/sentence", "/grammar", "/culture", "/exam", "/test", "/match"])
    await expect(page.locator(`main a[href="${href}"]`).first()).toBeVisible();
  // On a small laptop screen the first row of modes is visible without scrolling.
  const first = await page.locator(".mode-grid .link-card").first().boundingBox();
  expect(first.y + first.height).toBeLessThan(viewports.chromebook.height);
});

test("pronunciation shows TTS as a compact status, not a warning banner", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      value: { getVoices: () => [], cancel: () => {}, speak: () => {} },
    });
  });
  await page.goto("/pronunciation");
  await expect(page.locator(".quiz-toolbar .status-chip")).toHaveText("음성 사용 불가");
  await expect(page.locator(".study-page > .note")).toHaveCount(0);
  await page.getByLabel("문제 유형", { exact: true }).selectOption("listen");
  await expect(page.locator(".question-prompt .status-chip")).toHaveText("음성 사용 불가");
});

test("hanzi assembly keeps its instructions as a one-line hint", async ({ page }) => {
  await page.goto("/write");
  await expect(page.locator(".answer-area > p")).toHaveCount(0);
  await expect(page.locator(".feedback-hint")).toContainText("구성요소를 모두 고르세요");
});

for (const [name, size] of Object.entries(viewports))
  test(`no horizontal overflow and a single-row menu on ${name}`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize(size);
    for (const route of ["/", ...areas, "/test", "/match"]) {
      await page.goto(route);
      await expect(page.locator("main h1")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        route,
      ).toBe(true);
      const nav = await page.locator("body > header nav").boundingBox();
      expect(nav.height, route).toBeLessThan(60);
      if (route !== "/" && route !== "/test" && route !== "/match") {
        const box = await page.locator(".question .action-bar button:visible").first().boundingBox();
        expect(box.height, `${route} buttons stay touch-sized`).toBeGreaterThanOrEqual(40);
      }
    }
  });
