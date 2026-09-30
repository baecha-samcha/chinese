import { test, expect } from "@playwright/test";
import XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import { validateRow } from "../../public/js/validation.js";
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
  // Selected components must read visibly larger than the option pool so
  // lookalikes (口/囗, 土/士...) are easy to double-check before submitting.
  const slotFontSize = parseFloat(
    await page
      .locator(".slot")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
  );
  const poolFontSize = parseFloat(
    await page
      .locator(".blocks button")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
  );
  expect(slotFontSize).toBeGreaterThan(poolFontSize);
  await page.locator(".blocks button").first().click();
  await expect(page.getByRole("button", { name: "조립 확인" })).toBeEnabled();
  await page.getByRole("button", { name: "조립 확인" }).click();
  await expect(page.locator(".feedback")).toBeVisible();
  // Component recall is graded as a multiset, so a wrong pick here always
  // means an actual missing/extra component — verify the diff explains it.
  if (await page.locator(".feedback.error").count()) {
    await expect(page.getByText("내가 고른 구성")).toBeVisible();
    await expect(page.getByText(/정답:/)).toBeVisible();
  }
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
  await page.getByRole("button", { name: "선택 범위 자동 배분" }).click();
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
  request,
}) => {
  const source = XLSX.read(await readFile("public/fixtures/sample.xlsx"), {
    type: "buffer",
  });
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
    const actual = await (await request.get(`/api/${kind}`)).json();
    const expected = XLSX.utils.sheet_to_json(source.Sheets[kind], {
      defval: "",
      raw: false,
    });
    for (const row of expected) {
      const normalized = validateRow(kind, row).data;
      expect(actual).toEqual(
        expect.arrayContaining([expect.objectContaining(normalized)]),
      );
    }
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

test("XLSX header and row errors clear previews and recover on sheet changes", async ({
  page,
}) => {
  const book = XLSX.utils.book_new();
  const headers = [" simplified ", "pinyin", " meaning "];
  const record = ["河", "hé", "강"];
  for (const [name, rows] of [
    ["vocabulary", [headers, record]],
    [
      "duplicate",
      [
        [...headers, "meaning"],
        [...record, "다른 뜻"],
      ],
    ],
    [
      "unnamed",
      [
        [...headers, ""],
        [...record, "숨은 값"],
      ],
    ],
    [
      "missing",
      [
        ["simplified", "pinyin"],
        ["河", "hé"],
      ],
    ],
    ["limit", [headers, ...Array(500).fill(record)]],
    ["overflow", [headers, ...Array(501).fill(record)]],
    ["empty", []],
  ])
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  await page.goto("/admin/import");
  const verify = page.getByRole("button", { name: "서버 검증 · 미리보기" });
  const commit = page.getByRole("button", { name: "확인한 데이터 가져오기" });
  await expect(verify).toBeDisabled();
  await page.getByLabel("가져올 파일").setInputFiles({
    name: "edges.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
  });
  const selector = page.getByLabel("시트 선택");
  const status = page
    .locator('[aria-live="polite"]')
    .filter({ hasText: /시트:|검증 완료|저장 완료/ });
  for (const [name, error] of [
    ["duplicate", "C1, D1: 중복 헤더"],
    ["unnamed", "D1: 데이터가 있는 열"],
    ["missing", "필수 열 누락: meaning"],
    ["overflow", "최대 500개"],
    ["empty", "빈 시트"],
  ]) {
    await verify.click();
    await expect(commit).toBeEnabled();
    await selector.selectOption(name);
    await expect(status).toContainText(error);
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await expect(verify).toBeDisabled();
    await expect(commit).toBeDisabled();
    await selector.selectOption("vocabulary");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(verify).toBeEnabled();
    await expect(commit).toBeDisabled();
  }
  await selector.selectOption("limit");
  await expect(page.locator("tbody tr")).toHaveCount(500);
  await verify.click();
  await expect(commit).toBeEnabled();
  await page.getByLabel("가져올 파일").setInputFiles({
    name: "broken.xlsx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0x50, 0x4b, 3, 4, 0]),
  });
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(verify).toBeDisabled();
  await expect(commit).toBeDisabled();
  await expect(
    page.locator('section.card > p[aria-live="polite"]'),
  ).not.toBeEmpty();
  await page
    .getByLabel("가져올 파일")
    .setInputFiles("public/fixtures/sample.xlsx");
  await expect(page.locator("tbody tr")).toHaveCount(13);
  await expect(verify).toBeEnabled();
});

test("pronunciation tone mode offers four same-spelling tone choices", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pronunciation");
  await page.getByLabel("pronunciationMode", { exact: true }).selectOption("tone");
  const buttons = page.locator(".question .options button");
  await expect(buttons).toHaveCount(4);
  await expect(page.locator(".question .hanzi.prompt")).toBeVisible();
  const options = await buttons.locator("span").allTextContents();
  const unmark = (s) =>
    s.normalize("NFD").replace(/[\u0304\u0301\u030c\u0300]/g, "");
  expect(new Set(options).size).toBe(4);
  expect(new Set(options.map(unmark)).size).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await buttons.first().click();
  await expect(page.locator(".question [aria-live=polite]")).not.toBeEmpty();
});
