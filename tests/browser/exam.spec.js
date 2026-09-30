import { test, expect } from "@playwright/test";
const failures = [];
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => failures.push(e.message));
});
test.afterEach(() => {
  expect(failures.splice(0)).toEqual([]);
});
const session = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("ch.exam.v1")));
const clockSeconds = async (page) => {
  const [m, s] = (await page.locator("[data-exam-clock]").textContent())
    .split(":")
    .map(Number);
  return m * 60 + s;
};
async function start(page) {
  await page.goto("/exam");
  await page.getByRole("button", { name: "50분 시험 시작" }).click();
  await expect(page.locator(".exam-question")).toHaveCount(29);
}

for (const [name, viewport] of [
  ["mobile", { width: 390, height: 844 }],
  ["desktop", { width: 1280, height: 900 }],
]) {
  test(`exam on ${name}: answer, reload restore, no leak, submit, grade`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.locator('nav a[href="/exam"]').click();
    await expect(page).toHaveURL(/\/exam$/);
    await page.getByRole("button", { name: "50분 시험 시작" }).click();
    await expect(page.locator(".exam-question")).toHaveCount(29);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const exam = await session(page);
    expect(exam.questions.reduce((s, q) => s + q.points, 0)).toBe(100);
    expect(new Set(exam.questions.slice(10, 13).map((q) => q.groupVariant)).size).toBe(1);

    // Before submission: no feedback, answers or explanations in the DOM.
    await expect(page.locator(".exam-feedback")).toHaveCount(0);
    const html = await page.locator("main").innerHTML();
    expect(html).not.toContain("정답:");
    for (const q of exam.questions) expect(html).not.toContain(q.explanation);

    // Q01 correct, Q02 wrong, SA02 half, WR01 correction plus manual parts.
    const q = Object.fromEntries(exam.questions.map((x) => [x.slot, x]));
    await page.locator(`input[name=Q01][value="${q.Q01.answer}"]`).check();
    const wrong = q.Q02.choices.find((c) => c !== q.Q02.answer);
    await page.locator(`input[name=Q02][value="${wrong}"]`).check();
    await page.locator("#SA02-a").fill(q.SA02.fields[0].answers[0]);
    await page.locator("#SA02-b").fill("無");
    await page.locator("#WR01-correction").fill(q.WR01.expectedCorrection);
    await page.locator("#WR01-reason").fill("부정 표현 설명");
    await expect(page.locator("[data-exam-progress]")).toHaveText(
      "답안 작성 3 / 29",
    );
    const before = await clockSeconds(page);
    expect(before).toBeGreaterThan(49 * 60);

    await page.reload();
    await expect(page.locator(".exam-question")).toHaveCount(29);
    expect((await session(page)).questions).toEqual(exam.questions);
    await expect(page.locator("input[name=Q01]:checked")).toHaveValue(q.Q01.answer);
    await expect(page.locator("input[name=Q02]:checked")).toHaveValue(wrong);
    await expect(page.locator("#SA02-b")).toHaveValue("無");
    await expect(page.locator("#WR01-reason")).toHaveValue("부정 표현 설명");
    await expect(page.locator("[data-exam-progress]")).toHaveText(
      "답안 작성 3 / 29",
    );
    const after = await clockSeconds(page);
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(before - 60);
    await expect(page.locator(".exam-feedback")).toHaveCount(0);

    await page.getByRole("button", { name: "시험 제출" }).click();
    await expect(page.getByText("26개 문항에 작성하지 않은 답이 있습니다.")).toBeVisible();
    await page.getByRole("button", { name: "제출하기" }).click();
    await expect(page.locator(".exam-results h2")).toHaveText(
      "채점된 점수 8 / 100",
    );
    await expect(page.locator(".exam-results")).toContainText(
      "수동 채점 대기",
    );
    await expect(page.locator(".exam-feedback")).toHaveCount(29);
    await expect(page.locator("#exam-Q01 .exam-feedback strong")).toHaveText("3 / 3점");
    await expect(page.locator("#exam-Q02 .exam-feedback strong")).toHaveText("0 / 3점");
    await expect(page.locator("#exam-SA02 .exam-feedback strong")).toHaveText("2 / 4점");
    // Manual parts stay pending, not marked wrong.
    await expect(page.locator("#exam-WR01 .exam-feedback strong")).toHaveText(
      "3 / 7점 · 수동 채점 대기",
    );
    await expect(page.locator("#exam-WR01 .exam-explanation")).toContainText(
      q.WR01.expectedCorrection,
    );
    await expect(page.locator("#WR01-reason")).toBeDisabled();
    await page
      .getByLabel("WR01 수정 이유 (한국어) 자기 채점")
      .selectOption("2");
    await expect(page.locator(".exam-results h2")).toHaveText(
      "채점된 점수 10 / 100",
    );
    await page.reload();
    await expect(page.locator(".exam-results h2")).toHaveText(
      "채점된 점수 10 / 100",
    );
    await expect(page.locator("[data-exam-clock]")).toHaveText("제출 완료");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    // A new exam archives the submitted one; learning routes still work.
    await page.getByRole("button", { name: "새 시험 만들기" }).click();
    await page.getByRole("button", { name: "50분 시험 시작" }).click();
    await expect(page.locator(".exam-question")).toHaveCount(29);
    const history = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ch.exam.history.v1")),
    );
    expect(history.map((h) => h.id)).toEqual([exam.id]);
    await page.locator('nav a[href="/sentence"]').click();
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".exam-question")).toHaveCount(0);
  });
}

test("time running out auto-submits the saved answers", async ({ page }) => {
  await start(page);
  const exam = await session(page);
  const q = exam.questions[0];
  await page.locator(`input[name=Q01][value="${q.answer}"]`).check();
  // Shorten the saved deadline, then reload as a returning student would.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("ch.exam.v1"));
    s.deadline = Date.now() + 10000;
    localStorage.setItem("ch.exam.v1", JSON.stringify(s));
  });
  await page.reload();
  // A slow dev server can take a few seconds to reopen the page.
  expect(await clockSeconds(page)).toBeLessThanOrEqual(10);
  await expect(page.locator("[data-exam-clock]")).toHaveText("제출 완료", {
    timeout: 20000,
  });
  await expect(page.locator(".exam-results h2")).toHaveText(
    "채점된 점수 3 / 100",
  );
  const saved = await session(page);
  expect(saved.status).toBe("submitted");
  expect(saved.responses.Q01).toBe(q.answer);
  await expect(page.locator("input[name=Q01]").first()).toBeDisabled();
});

test("an expired exam is submitted on reopen without accepting late answers", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("ch.exam.v1"));
    s.deadline = Date.now() - 1000;
    localStorage.setItem("ch.exam.v1", JSON.stringify(s));
  });
  await page.reload();
  await expect(page.locator("[data-exam-clock]")).toHaveText("제출 완료");
  await expect(page.locator(".exam-results h2")).toHaveText(
    "채점된 점수 0 / 100",
  );
  expect((await session(page)).status).toBe("submitted");
});
