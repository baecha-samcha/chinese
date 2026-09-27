import { test, expect } from "@playwright/test";

test("match plays, refills, resets timers, ends and restarts on mobile", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/vocabulary", (route) =>
    route.fulfill({
      json: [
        {
          id: 901,
          simplified: "学生",
          meaning: "학생",
          characters: [],
          source: 0,
        },
        {
          id: 902,
          simplified: "今天",
          meaning: "오늘",
          characters: [],
          source: 1,
        },
      ],
    }),
  );
  await page.goto("/match");
  await page.clock.install({ time: new Date("2026-09-21T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-21T01:00:00Z"));
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page.locator(".match-card")).toHaveCount(4);
  const selected = page.getByRole("button", { name: "学生", exact: true });
  await selected.click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await selected.click();
  await expect(selected).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("match-score")).toHaveText("0");
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const cards = await page.locator(".match-card").evaluateAll((nodes) =>
      nodes.map((node) => ({
        lang: node.lang,
        x: node.getBoundingClientRect().x,
        y: node.getBoundingClientRect().y,
      })),
    );
    expect(cards.map((card) => card.lang)).toEqual([
      "zh-CN",
      "ko",
      "zh-CN",
      "ko",
    ]);
    expect(cards[0].x).toBe(cards[2].x);
    expect(cards[1].x).toBeGreaterThan(cards[0].x);
    expect(cards[0].y).toBe(cards[1].y);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole("button", { name: "学生", exact: true }).click();
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "오답" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "学生", exact: true }).click();
  await page.getByRole("button", { name: "학생", exact: true }).click();
  await expect(page.getByTestId("match-score")).toHaveText("100");
  await expect(page.locator(".match-card:disabled")).toHaveCount(2);
  await page.clock.runFor(10000);
  await expect(page.getByTestId("match-small")).toHaveText("10.0초");
  await expect(page.getByTestId("match-score")).toHaveText("100");
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.locator(".match-card:disabled")).toHaveCount(2);
  await page.clock.runFor(250);
  await expect(page.locator(".match-card:disabled")).toHaveCount(0);
  await expect(page.getByTestId("match-score")).toHaveText("200");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.clock.runFor(170000);
  await expect(page.getByRole("heading", { name: "매칭 결과" })).toBeVisible();
  await expect(
    page.locator(".stat").filter({ hasText: "최종 점수" }),
  ).toContainText("200");
  await expect(
    page.locator(".stat").filter({ hasText: "정답 수" }),
  ).toContainText("2");
  await expect(
    page.locator(".stat").filter({ hasText: "오답 수" }),
  ).toContainText("1");
  await expect(page.locator(".match-card")).toHaveCount(0);
  await page.getByRole("button", { name: "다시 하기" }).click();
  await page.getByLabel("학습 출처").selectOption("0");
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page.locator(".match-card")).toHaveCount(2);
  await page.getByRole("link", { name: "뜻", exact: true }).click();
  await page.clock.runFor(180000);
  await expect(page.getByRole("heading", { name: "매칭 결과" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("four rows preserve untouched nodes while solved slots fade and refill", async ({
  page,
}) => {
  const words = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1,
    simplified: `字${i}`,
    meaning: `뜻${i}`,
    characters: [],
  }));
  await page.route("**/api/vocabulary", (route) =>
    route.fulfill({ json: words }),
  );
  await page.goto("/match");
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole("button", { name: "게임 시작" }).click();
  await expect(page.locator(".match-card")).toHaveCount(8);
  const before = await page.locator(".match-card").evaluateAll((nodes) => {
    window.originalMatchNodes = nodes;
    return nodes.map((n) => ({ id: n.dataset.cardId, text: n.textContent }));
  });
  expect(
    words.filter(
      (w) =>
        before.some((c) => c.text === w.simplified) &&
        before.some((c) => c.text === w.meaning),
    ),
  ).toHaveLength(1);
  const word = words.find(
    (w) =>
      before.some((c) => c.text === w.simplified) &&
      before.some((c) => c.text === w.meaning),
  );
  await page
    .getByRole("button", { name: word.simplified, exact: true })
    .click();
  await page.getByRole("button", { name: word.meaning, exact: true }).click();
  await expect(page.locator(".matched")).toHaveCount(2);
  expect(
    await page
      .locator(".matched")
      .first()
      .evaluate((n) => getComputedStyle(n).animationDuration),
  ).toBe("0.25s");
  await page.clock.runFor(300);
  const after = await page.locator(".match-card").evaluateAll((nodes) =>
    nodes.map((n, i) => ({
      id: n.dataset.cardId,
      text: n.textContent,
      same: n === window.originalMatchNodes[i],
    })),
  );
  const inserted = after
    .filter((card, i) => card.id !== before[i].id)
    .map((card) => card.text);
  expect(
    words.some(
      (w) => inserted.includes(w.simplified) && inserted.includes(w.meaning),
    ),
  ).toBe(false);
  before.forEach((card, i) => {
    if ([word.simplified, word.meaning].includes(card.text))
      expect(after[i].id).not.toBe(card.id);
    else expect(after[i]).toEqual({ ...card, same: true });
  });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const positions = await page.locator(".match-card").evaluateAll((nodes) =>
      nodes.map((n) => ({
        x: n.getBoundingClientRect().x,
        y: n.getBoundingClientRect().y,
      })),
    );
    expect(new Set(positions.map((p) => p.x)).size).toBe(2);
    expect(new Set(positions.map((p) => p.y)).size).toBe(4);
    await page.screenshot({ path: `outputs/match-continuous-${width}.png` });
  }
  const stats = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ch.stats")),
  );
  expect(stats[`match:${word.id}`].correct).toBe(1);
  // Leave while a replacement is pending.
  const labels = await page.locator(".match-card").allTextContents();
  const next = words.find(
    (w) => labels.includes(w.simplified) && labels.includes(w.meaning),
  );
  await page
    .getByRole("button", { name: next.simplified, exact: true })
    .click();
  await page.getByRole("button", { name: next.meaning, exact: true }).click();
  await page.getByRole("link", { name: "뜻", exact: true }).click();
  await page.clock.runFor(500);
  await expect(page.locator(".match-card")).toHaveCount(0);
});
