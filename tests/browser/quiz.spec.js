import { test, expect } from "@playwright/test";
const failures = [];
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => failures.push(e.message));
});
test.afterEach(() => {
  expect(failures.splice(0)).toEqual([]);
});
const fieldButton = (page, group, name) =>
  page.getByRole("group", { name: `${group} 필드` }).getByRole("button", { name, exact: true });
// Leaves exactly `source` → `target` selected, starting from any state.
async function onlyDirection(page, source, target) {
  for (const [group, keep] of [["문제", source], ["정답", target]])
    for (const name of ["뜻", "한자", "병음"]) {
      const b = fieldButton(page, group, name);
      if ((await b.getAttribute("aria-pressed")) !== String(name === keep)) await b.click();
      await expect(b).toHaveAttribute("aria-pressed", String(name === keep));
    }
}
test("sentence quiz: 자기소개 category, every direction, typed pinyin with my answer vs correct answer", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/learn");
  await expect(page.locator(".question")).toBeVisible();
  await page.getByLabel("학습 대상").selectOption("sentence");
  await page.getByLabel("카테고리").selectOption("자기소개");
  const intro = {
    "제 소개 좀 할게요.": ["我来自我介绍一下。", "Wǒ lái zìwǒ jièshào yíxià."],
    "제가 소개해 드릴게요.": ["我给你介绍一下。", "Wǒ gěinǐ jièshào yíxià."],
    "만나서 기뻐요.": ["见到你很高兴。", "Jiàndào nǐ hěn gāoxìng."],
    "알게 되어 영광입니다.": ["认识你很荣幸。", "Rènshi nǐ hěn róngxìng."],
    "예전부터 존함을 들었습니다.": ["久仰久仰！", "Jiǔyǎng jiǔyǎng!"],
    "처음 뵙겠습니다.": ["初次见面！", "Chūcì jiànmiàn."],
  };
  const faces = Object.entries(intro).map(([meaning, [hanzi, pinyin]]) => ({ 뜻: meaning, 한자: hanzi, 병음: pinyin }));
  for (const [source, target] of [["뜻", "한자"], ["뜻", "병음"], ["한자", "뜻"], ["한자", "병음"], ["병음", "뜻"], ["병음", "한자"]]) {
    await onlyDirection(page, source, target);
    await expect(page.locator(".question .eyebrow")).toContainText(`${source} → ${target}`);
    const prompt = await page.locator(".question .prompt").innerText();
    const item = faces.find((f) => f[source] === prompt);
    expect(item, `${source} prompt "${prompt}" is a 자기소개 sentence`).toBeTruthy();
    await page.locator(".option", { hasText: item[target] }).first().click();
    await expect(page.locator(".feedback")).toContainText("정답이에요!");
  }
  // Typed pinyin: a wrong answer shows both what I typed and the answer...
  await onlyDirection(page, "뜻", "병음");
  await page.getByLabel("답 방식").selectOption("input");
  // First typed-pinyin session: the input guide modal opens; 확인 closes it.
  await page.getByRole("dialog", { name: "병음 입력 안내" }).getByRole("button", { name: "확인" }).click();
  await page.getByLabel("병음 입력", { exact: true }).fill("wo3 shi4");
  await page.getByRole("button", { name: "정답 확인" }).click();
  await expect(page.locator(".feedback.error")).toContainText("내 답: wo3 shi4");
  const meaning = await page.locator(".question .prompt").innerText();
  await expect(page.locator(".feedback")).toContainText(`정답: ${intro[meaning][1]}`);
  await page.getByRole("button", { name: "다음 문제 →" }).click();
  // ...and numbered tones / spacing differences still count as correct.
  const next = await page.locator(".question .prompt").innerText();
  const numbered = {
    "제 소개 좀 할게요.": "wo3 lai2 zi4wo3 jie4shao4 yi2xia4",
    "제가 소개해 드릴게요.": "wo3 gei3 ni3 jie4shao4 yi2xia4",
    "만나서 기뻐요.": "jian4dao4 ni3 hen3 gao1xing4",
    "알게 되어 영광입니다.": "ren4shi5 ni3 hen3 rong2xing4",
    "예전부터 존함을 들었습니다.": "jiu3yang3 jiu3yang3",
    "처음 뵙겠습니다.": "chu1ci4 jian4mian4",
  }[next];
  await page.getByLabel("병음 입력", { exact: true }).fill(numbered);
  await page.getByLabel("병음 입력", { exact: true }).press("Enter");
  await expect(page.locator(".feedback")).toContainText("정답이에요!");
  await expect(page.locator(".my-answer")).toHaveCount(0);
  // Settings persist and progress is recorded per direction.
  await page.reload();
  await expect(page.getByLabel("학습 대상")).toHaveValue("sentence");
  await expect(page.getByLabel("카테고리")).toHaveValue("자기소개");
  const keys = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ch.stats"))));
  for (const d of ["meaning>hanzi", "meaning>pinyin", "hanzi>meaning", "hanzi>pinyin", "pinyin>meaning", "pinyin>hanzi"])
    expect(keys.some((k) => k.startsWith("sentences:") && k.endsWith(`:${d}`)), d).toBeTruthy();
});
test("word quiz keeps working with a single direction and blocks same-field-only selections", async ({ page }) => {
  await page.goto("/learn");
  await page.getByLabel("학습 대상").selectOption("word");
  await expect(page.getByLabel("카테고리")).toBeDisabled();
  await onlyDirection(page, "한자", "병음");
  for (let i = 0; i < 3; i++) {
    await expect(page.locator(".question .eyebrow")).toContainText("한자 → 병음");
    await page.locator(".question").focus();
    await page.keyboard.press("1");
    await expect(page.locator(".feedback")).toBeVisible();
    await page.keyboard.press("Enter");
  }
  await fieldButton(page, "정답", "한자").click();
  await fieldButton(page, "정답", "병음").click();
  await onlyDirection(page, "한자", "한자");
  await expect(page.getByText("서로 다른 필드를 하나 이상씩 선택하세요")).toBeVisible();
  await expect(page.locator(".question")).toHaveCount(0);
  await fieldButton(page, "정답", "뜻").click();
  await expect(page.locator(".question")).toBeVisible();
});
test("typed-pinyin guide: shown on first typed pinyin session, 확인 hides until next visit, 다시 보지 않기 persists, ? reopens", async ({ page }) => {
  const guide = page.getByRole("dialog", { name: "병음 입력 안내" });
  await page.goto("/learn");
  await page.getByLabel("학습 대상").selectOption("sentence");
  await onlyDirection(page, "뜻", "병음");
  await expect(guide).toHaveCount(0); // choice mode: no guide
  await page.getByLabel("답 방식").selectOption("input");
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("ni3 hao3");
  await expect(guide).toContainText("lv4");
  // A compact modal card over a dimmed page, not a full-screen sheet.
  const box = await guide.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeLessThan(viewport.width * 0.8);
  expect(box.height).toBeLessThan(viewport.height);
  expect(await guide.evaluate((d) => d.open && d.matches(":modal"))).toBe(true);
  expect(await guide.evaluate((d) => getComputedStyle(d, "::backdrop").backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  // It stays until answered (no auto-dismiss); Esc behaves like 확인.
  await page.waitForTimeout(1500);
  await expect(guide).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ch.pinyinInputGuideDismissed"))).toBeNull();
  await page.getByRole("button", { name: "병음 입력 도움말" }).click();
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "확인" }).click();
  await expect(guide).toHaveCount(0);
  // Same visit: stays closed while changing settings.
  await onlyDirection(page, "한자", "병음");
  await expect(guide).toHaveCount(0);
  // Next visit with typed pinyin saved: it opens again by itself.
  await page.reload();
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "확인" }).click();
  // Typed answers without a pinyin target never trigger it, even on a new visit.
  await onlyDirection(page, "뜻", "한자");
  await page.reload();
  await expect(page.getByLabel("한자 입력", { exact: true })).toBeVisible();
  await expect(guide).toHaveCount(0);
  // Choosing a pinyin answer opens it; 다시 보지 않기 stops it for good.
  await onlyDirection(page, "뜻", "병음");
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "다시 보지 않기" }).click();
  await expect(guide).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ch.pinyinInputGuideDismissed"))).toBe("true");
  await page.reload();
  await expect(page.getByLabel("병음 입력", { exact: true })).toBeVisible();
  await expect(guide).toHaveCount(0);
  // The ? help button still opens it on demand.
  await page.getByRole("button", { name: "병음 입력 도움말" }).click();
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "확인" }).click();
  await expect(guide).toHaveCount(0);
  // The guide's example format is what the grader accepts.
  const prompt = await page.locator(".question .prompt").innerText();
  const answer = {
    "제 소개 좀 할게요.": "wo3 lai2 zi4wo3 jie4shao4 yi2xia4",
    "제가 소개해 드릴게요.": "Wo3 gei3ni3 jie4shao4 yi2xia4",
    "만나서 기뻐요.": "jian4dao4 ni3 hen3 gao1xing4",
    "알게 되어 영광입니다.": "ren4shi ni3 hen3 rong2xing4",
    "예전부터 존함을 들었습니다.": "JIU3YANG3 jiu3yang3",
    "처음 뵙겠습니다.": "chu1ci4 jian4mian4",
  }[prompt];
  // Only the 자기소개 sentences carry pinyin in the test DB.
  expect(answer, `prompt ${prompt}`).toBeTruthy();
  await page.getByLabel("병음 입력", { exact: true }).fill(answer);
  await page.getByLabel("병음 입력", { exact: true }).press("Enter");
  await expect(page.locator(".feedback")).toContainText("정답이에요!");
});
