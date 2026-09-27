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
    const cards = await page
      .locator(".match-card")
      .evaluateAll((nodes) =>
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
