import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:8788";
const row = {
  simplified: "河",
  traditional: "河",
  pinyin: "hé",
  meaning: "강",
  korean_hanja_reading: "하",
  characters: [
    {
      char: "河",
      traditional: "河",
      decomposition: {
        type: "layout",
        layout: "left-right",
        children: [
          { type: "character", value: "氵" },
          { type: "character", value: "可" },
        ],
      },
    },
  ],
};
const post = (request, path, data) =>
  request.post(path, { headers: { Origin: origin }, data });
const failures = [];
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => failures.push(e.message));
});
test.afterEach(() => {
  expect(failures.splice(0)).toEqual([]);
});
test("routes, mobile layout and escaped search content", async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/",
    "/learn",
    "/write",
    "/pronunciation",
    "/sentence",
    "/grammar",
    "/culture",
    "/test",
    "/admin",
    "/admin/import",
    "/admin/vocabulary",
    "/admin/grammar",
    "/admin/sentences",
    "/admin/culture",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.goto("/learn");
  for (const q of ["好", "hao", "hǎo", "좋다", "호"]) {
    await page.getByRole("searchbox").fill(q);
    await expect(page.locator(".search-results")).toContainText("好");
  }
});
test("CSV preview edits invalid row and bulk imports, then visible in study", async ({
  page,
}) => {
  await page.goto("/admin/import");
  const csv =
    'simplified,traditional,pinyin,meaning,korean_hanja_reading,characters\n河,河,hé,,하,"' +
    JSON.stringify(row.characters).replaceAll('"', '""') +
    '"';
  await page.getByLabel("가져올 파일").setInputFiles({
    name: "sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.locator("tbody")).toContainText("ERROR");
  await page.getByRole("button", { name: "이 행 수정", exact: true }).click();
  await page.getByLabel("1행 JSON 수정").fill(JSON.stringify(row));
  await page.getByRole("button", { name: "행 수정 적용" }).click();
  await expect(
    page.getByRole("button", { name: "확인한 데이터 가져오기" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "서버 검증 · 미리보기" }).click();
  await expect(
    page.getByRole("button", { name: "확인한 데이터 가져오기" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "확인한 데이터 가져오기" }).click();
  await expect(page.getByText(/저장 완료:/)).toBeVisible();
  await page.getByRole("link", { name: "뜻", exact: true }).click();
  await page.getByRole("searchbox").fill("河");
  await expect(page.locator(".search-results")).toContainText("강");
});
test("bulk policies, server validation, stale preview, malicious text and CRUD", async ({
  request,
  page,
}) => {
  const invalid = await post(request, "/api/vocabulary", {});
  expect(invalid.status()).toBe(422);
  const noOrigin = await request.post("/api/vocabulary", { data: row });
  expect(noOrigin.status()).toBe(403);
  const preview = await (
    await post(request, "/api/import/preview", {
      kind: "vocabulary",
      rows: [row],
    })
  ).json();
  const missing = await post(request, "/api/import", {
    kind: "vocabulary",
    rows: [row],
    policy: "both",
  });
  expect(missing.status()).toBe(409);
  const keep = await (
    await post(request, "/api/import", {
      kind: "vocabulary",
      rows: [row],
      fingerprint: preview.fingerprint,
      policy: "keep",
    })
  ).json();
  expect(keep.skipped).toBe(1);
  const both = await (
    await post(request, "/api/import", {
      kind: "vocabulary",
      rows: [row],
      fingerprint: preview.fingerprint,
      policy: "both",
    })
  ).json();
  expect(both.written).toBe(1);
  const stale = await post(request, "/api/import", {
    kind: "vocabulary",
    rows: [row],
    fingerprint: preview.fingerprint,
    policy: "both",
  });
  expect(stale.status()).toBe(409);
  const updated = { ...row, traditional: "河河" };
  const p = await (
    await post(request, "/api/import/preview", {
      kind: "vocabulary",
      rows: [updated],
    })
  ).json();
  expect(
    (
      await post(request, "/api/import", {
        kind: "vocabulary",
        rows: [updated],
        fingerprint: p.fingerprint,
        policy: "overwrite",
      })
    ).ok(),
  ).toBeTruthy();
  const records = await (await request.get("/api/vocabulary?q=河")).json();
  expect(records.some((r) => r.traditional === "河河")).toBeTruthy();
  const malicious = {
    ...row,
    simplified: "水",
    characters: [{ char: "水" }],
    meaning: "<img src=x onerror=alert(1)>",
  };
  const created = await (
    await post(request, "/api/vocabulary", malicious)
  ).json();
  await page.goto("/admin/vocabulary");
  await page.getByRole("searchbox").fill("<img");
  await expect(page.locator("tbody")).toContainText(malicious.meaning);
  await expect(page.locator("tbody img")).toHaveCount(0);
  const res = await request.delete(`/api/vocabulary/${created.id}`, {
    headers: { Origin: origin },
  });
  expect(res.ok()).toBeTruthy();
  expect((await request.get(`/api/vocabulary/${created.id}`)).status()).toBe(
    404,
  );
});
test("100 rows use one import and file internal duplicate policies", async ({
  request,
}) => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    ...row,
    meaning: `bulk-${i}`,
  }));
  const p = await (
    await post(request, "/api/import/preview", { kind: "vocabulary", rows })
  ).json();
  const result = await (
    await post(request, "/api/import", {
      kind: "vocabulary",
      rows,
      fingerprint: p.fingerprint,
      policy: "keep",
    })
  ).json();
  expect(result.written).toBe(100);
  const duplicate = { ...row, meaning: "internal-duplicate" };
  const batch = [duplicate, duplicate, duplicate],
    pv = await (
      await post(request, "/api/import/preview", {
        kind: "vocabulary",
        rows: batch,
      })
    ).json();
  const r = await (
    await post(request, "/api/import", {
      kind: "vocabulary",
      rows: batch,
      fingerprint: pv.fingerprint,
      policy: "keep",
      policies: ["both", "keep", "overwrite"],
    })
  ).json();
  expect(r).toEqual({ written: 1, skipped: 1 });
});
test("learning, component selection, sentence cancellation, grammar and culture modes", async ({
  page,
}) => {
  await page.goto("/learn");
  await expect(page.locator(".question")).toBeVisible();
  await page.locator(".question").focus();
  await page.keyboard.press("1");
  await expect(page.locator(".feedback")).toBeVisible();
  await expect(page.getByRole("button", { name: "건너뛰기" })).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(page.locator(".feedback")).toHaveCount(0);
  await page.goto("/write");
  await page.getByLabel("difficulty").selectOption("easy");
  const slot = page.locator(".slot:not([disabled])");
  await expect(slot).toHaveCount(1);
  await page.locator(".blocks button").first().click();
  await expect(page.getByRole("button", { name: "조립 확인" })).toBeEnabled();
  await page.getByRole("button", { name: "조립 확인" }).click();
  await expect(page.locator(".feedback")).toBeVisible();
  await page.goto("/sentence");
  await page.locator(".blocks button").first().click();
  await expect(page.locator(".slots button")).toHaveCount(1);
  await page.locator(".slots button").click();
  await expect(page.locator(".slots button")).toHaveCount(0);
  while (await page.locator(".blocks button:not([disabled])").count())
    await page.locator(".blocks button:not([disabled])").first().click();
  await page.getByRole("button", { name: "정답 확인", exact: true }).click();
  await expect(page.locator(".feedback")).toBeVisible();
  await page.goto("/grammar");
  for (const mode of ["correct", "wrong", "error", "blank", "order"]) {
    await page.getByLabel("grammarMode").selectOption(mode);
    await expect(page.locator(".question")).toBeVisible();
  }
  await page.goto("/culture");
  await page.getByLabel("cultureMode").selectOption("ox");
  await expect(page.locator(".option")).toHaveCount(2);
  await page.getByLabel("cultureMode").selectOption("short");
  await page.getByLabel("단답형 정답").fill("춘절");
  await page.getByRole("button", { name: "정답 확인", exact: true }).click();
  await expect(page.locator(".feedback")).toBeVisible();
});
test("TTS receives Chinese, rates and fallback are supported", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        getVoices: () => [{ lang: "zh-CN", name: "Test" }],
        cancel: () => {},
        speak: (u) =>
          window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate }),
      },
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        constructor(text) {
          this.text = text;
        }
      },
    });
  });
  await page.goto("/pronunciation");
  await page.getByLabel("pronunciationMode").selectOption("listen");
  await page.getByRole("button", { name: "🔊 보통", exact: true }).click();
  await page.getByRole("button", { name: "🐢 느리게", exact: true }).click();
  const spoken = await page.evaluate(() => window.__spoken);
  expect(spoken).toHaveLength(2);
  expect(spoken[0].text).toMatch(/\p{Script=Han}/u);
  expect(spoken[0].lang).toBe("zh-CN");
  expect(spoken[1].rate).toBeLessThan(spoken[0].rate);
  await page.evaluate(() => (speechSynthesis.getVoices = () => []));
  await page.getByRole("button", { name: "🔊 보통", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("중국어 음성");
});
test("mixed exam completes and records statistics once per answer", async ({
  page,
}) => {
  await page.goto("/test");
  await page.getByLabel("총 문제 수", { exact: true }).fill("6");
  await page.getByRole("button", { name: "전체 범위 자동 배분" }).click();
  await page.getByRole("button", { name: "시험 시작", exact: true }).click();
  for (let i = 0; i < 6; i++) {
    await expect(page.locator(".question")).toBeVisible();
    await page.getByRole("button", { name: "건너뛰기" }).click();
  }
  await expect(page.getByText("EXAM COMPLETE")).toBeVisible();
  await expect(page.getByText("정답률 0% · 건너뛴 문제 6개")).toBeVisible();
});
test("already loaded learning survives network interruption", async ({
  page,
  context,
}) => {
  await page.goto("/learn");
  await expect(page.locator(".question")).toBeVisible();
  await context.setOffline(true);
  await page.locator(".option").first().click();
  await expect(page.locator(".feedback")).toBeVisible();
  await page.getByRole("button", { name: "다음 문제 →" }).click();
  await expect(page.locator(".option").first()).toBeEnabled();
  await page.getByRole("link", { name: "문장", exact: true }).click();
  await expect(page.locator(".blocks")).toBeVisible();
  await context.setOffline(false);
});
test("backup exports JSON and CSV", async ({ page, request }) => {
  const r = await request.get("/api/export");
  expect(r.ok()).toBeTruthy();
  const backup = await r.json();
  expect(backup.vocabulary.length).toBeGreaterThan(13);
  await page.goto("/admin/vocabulary");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV 내보내기" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("vocabulary.csv");
});

test("XLSX parses all four sheets in browser, previews and saves each in bulk", async ({
  page,
}) => {
  await page.goto("/admin/import");
  await page
    .getByLabel("가져올 파일")
    .setInputFiles("public/fixtures/sample.xlsx");
  await expect(page.locator("tbody tr")).toHaveCount(13);
  const selector = page.getByLabel("시트 선택");
  for (const [kind, count] of [
    ["vocabulary", 13],
    ["sentences", 4],
    ["grammar", 3],
    ["culture", 4],
  ]) {
    if (kind !== "vocabulary") await selector.selectOption(kind);
    await expect(page.locator("tbody tr")).toHaveCount(count);
    await page.getByLabel("전체 중복 정책").selectOption("overwrite");
    await page.getByRole("button", { name: "서버 검증 · 미리보기" }).click();
    await expect(
      page.getByRole("button", { name: "확인한 데이터 가져오기" }),
    ).toBeEnabled();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/import") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "확인한 데이터 가져오기" }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByText(/저장 완료:/)).toBeVisible();
  }
});
test("production mode rejects unauthenticated writes, admin HTML and forged JWT", async ({
  request,
}) => {
  const base = "http://127.0.0.1:8789";
  for (const [method, path] of [
    ["post", "/api/vocabulary"],
    ["put", "/api/vocabulary/1"],
    ["delete", "/api/vocabulary/1"],
    ["post", "/api/import"],
    ["post", "/api/import/preview"],
  ]) {
    const r = await request[method](base + path, {
      headers: { Origin: base },
      data: row,
    });
    expect(r.status()).toBe(401);
  }
  expect((await request.get(base + "/admin")).status()).toBe(401);
  expect((await request.get(base + "/admin/import")).status()).toBe(401);
  expect((await request.get(base + "/api/export")).status()).toBe(401);
  const r = await request.post(base + "/api/vocabulary", {
    headers: {
      Origin: base,
      "Cf-Access-Jwt-Assertion": "forged.jwt.token",
      Cookie: "CF_Authorization=forged.jwt.token",
    },
    data: row,
  });
  expect(r.status()).toBe(401);
});
