import { el, button, toast, download } from "./utils.js";
import { api } from "./api.js";
import { validateRow, kinds } from "./validation.js";
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw Error("CSV 따옴표 형식 오류");
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      closed = false;
    } else {
      if (closed && c !== " ") throw Error("CSV 닫는 따옴표 뒤에 잘못된 문자");
      if (!closed) cell += c;
    }
  }
  if (quoted) throw Error("CSV 따옴표가 닫히지 않았습니다.");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((s) => s.trim());
  if (headers.some((s) => !s) || new Set(headers).size !== headers.length)
    throw Error("CSV 헤더가 비어 있거나 중복됩니다.");
  return rows.map((r, i) => {
    if (r.length !== headers.length)
      throw Error(`${i + 2}행: 열 수가 헤더와 다릅니다.`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j]]));
  });
}
export function toCSV(rows) {
  if (!rows.length) return "\uFEFF";
  const headers = [...new Set(rows.flatMap(Object.keys))];
  const escape = (v) => {
    let s =
      typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
    if (/^[\s]*[=+@-]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      headers.map(escape).join(","),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
    ].join("\r\n")
  );
}
export function parseXLSXSheet(XLSX, sheet, name, kind) {
  const fail = (message) => {
    throw Error(`${name} 시트: ${message}`);
  };
  if (!sheet?.["!ref"]) fail("빈 시트입니다.");
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const values = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
  });
  const headers = (values.shift() || []).map((v) => String(v).trim());
  const positions = new Map();
  for (let i = 0; i < headers.length; i++) {
    const position = XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c + i });
    const header = headers[i];
    if (!header) {
      if (values.some((row) => String(row[i] ?? "").trim()))
        fail(`${position}: 데이터가 있는 열의 헤더가 비어 있습니다.`);
    } else {
      if (positions.has(header))
        fail(`${positions.get(header)}, ${position}: 중복 헤더 "${header}"`);
      positions.set(header, position);
    }
  }
  const required = {
    vocabulary: ["simplified", "pinyin", "meaning"],
    sentences: ["korean", "chinese"],
    grammar: ["title", "explanation"],
    culture: ["category", "question", "answer"],
  }[kind];
  const missing = required.filter((h) => !positions.has(h));
  if (missing.length)
    fail(
      `${range.s.r + 1}행 헤더 (${XLSX.utils.encode_col(range.s.c)}–${XLSX.utils.encode_col(range.e.c)}열): 필수 열 누락: ${missing.join(", ")}`,
    );
  const rows = values.filter((row) => row.some((v) => String(v).trim()));
  if (!rows.length) fail("빈 시트입니다.");
  if (rows.length > 500)
    fail("한 번에 최대 500개 행을 가져올 수 있습니다. 파일을 나누어 주세요.");
  return rows.map((row) =>
    Object.fromEntries(
      headers.flatMap((h, i) => (h ? [[h, row[i] ?? ""]] : [])),
    ),
  );
}
let xlsxPromise;
async function loadXLSX() {
  if (globalThis.XLSX) return globalThis.XLSX;
  if (!xlsxPromise)
    xlsxPromise = new Promise((resolve, reject) => {
      const s = el("script", { src: "/vendor/xlsx.full.min.js" });
      s.onload = () => resolve(globalThis.XLSX);
      s.onerror = () => {
        xlsxPromise = null;
        reject(
          Error("XLSX 파서를 불러오지 못했습니다. npm install을 확인하세요."),
        );
      };
      document.head.append(s);
    });
  return xlsxPromise;
}
const labels = {
  vocabulary: "단어",
  sentences: "문장",
  grammar: "문법",
  culture: "문화",
};
export function renderImport(root, onImported) {
  let raw = [],
    preview = null,
    kind = "vocabulary",
    policies = [],
    filename = "",
    generation = 0;
  const container = el("section", { class: "card" }),
    results = el("div", {}),
    status = el("p", { "aria-live": "polite" });
  const type = el(
    "select",
    {
      ariaLabel: "데이터 유형",
      onChange: () => {
        kind = type.value;
        invalidate();
        showLocal();
      },
    },
    ...kinds.map((k) => el("option", { value: k }, labels[k])),
  );
  const file = el("input", {
    type: "file",
    accept: ".csv,.xlsx,.json",
    ariaLabel: "가져올 파일",
    onChange: async () => {
      const f = file.files[0];
      if (!f) return;
      invalidate();
      const gen = generation;
      raw = [];
      results.replaceChildren();
      sheetHolder.replaceChildren();
      try {
        if (f.size > 5_000_000) throw Error("파일은 최대 5 MB입니다.");
        filename = f.name;
        let records;
        if (/\.csv$/i.test(f.name)) records = parseCSV(await f.text());
        else if (/\.json$/i.test(f.name)) {
          const parsed = JSON.parse(await f.text());
          if (Array.isArray(parsed)) records = parsed;
          else {
            const found = kinds.find((k) => Array.isArray(parsed[k]));
            if (!found) throw Error("백업 형식 오류");
            records = parsed[kind] || parsed[found];
            kind = parsed[kind] ? kind : found;
            type.value = kind;
            backup = parsed;
            showSheets(
              Object.keys(parsed).filter((k) => kinds.includes(k)),
              (k) => {
                kind = k;
                type.value = k;
                selectRecords(() => parsed[k]);
              },
            );
          }
        } else if (/\.xlsx$/i.test(f.name)) {
          const XLSX = await loadXLSX(),
            workbook = XLSX.read(await f.arrayBuffer(), { type: "array" });
          if (gen !== generation) return;
          const sheets = workbook.SheetNames;
          const selectSheet = (k) => {
            if (kinds.includes(k)) {
              kind = k;
              type.value = k;
            }
            selectRecords(() =>
              parseXLSXSheet(XLSX, workbook.Sheets[k], k, kind),
            );
          };
          showSheets(sheets, selectSheet);
          selectSheet(sheets[0]);
          return;
        } else throw Error("CSV, XLSX, JSON만 지원합니다.");
        if (gen !== generation) return;
        raw = records;
        showLocal();
      } catch (e) {
        if (gen === generation) showError(e);
      }
    },
  });
  function showError(error) {
    invalidate();
    raw = [];
    policies = [];
    results.replaceChildren();
    verify.disabled = true;
    status.textContent = error.message;
  }
  function selectRecords(read) {
    invalidate();
    try {
      raw = read();
      showLocal();
    } catch (error) {
      showError(error);
    }
  }
  let backup;
  const sheetHolder = el("div", {});
  function showSheets(names, fn) {
    const s = el(
      "select",
      { ariaLabel: "시트 선택", onChange: () => fn(s.value) },
      ...names.map((n) => el("option", { value: n }, n)),
    );
    sheetHolder.replaceChildren(el("label", {}, "시트 / 백업 데이터", s));
  }
  const policy = el(
    "select",
    {
      ariaLabel: "전체 중복 정책",
      onChange: () => {
        policies = raw.map(() => policy.value);
        showRows(preview?.rows || raw.map((r) => validateRow(kind, r)));
      },
    },
    ...[
      ["keep", "기존 유지"],
      ["overwrite", "덮어쓰기"],
      ["both", "둘 다 유지"],
    ].map(([v, t]) => el("option", { value: v }, t)),
  );
  const filter = el("input", {
    type: "checkbox",
    onChange: () =>
      showRows(preview?.rows || raw.map((r) => validateRow(kind, r))),
  });
  const verify = button(
    "서버 검증 · 미리보기",
    async () => {
      const gen = generation;
      verify.disabled = true;
      try {
        const result = await api("import/preview", {
          method: "POST",
          body: { kind, rows: raw },
        });
        if (gen !== generation) return;
        preview = result;
        showRows(result.rows);
        commit.disabled = result.rows.some((r) => r.status === "ERROR");
        status.textContent =
          "검증 완료. 경고와 중복 정책을 확인한 뒤 가져오기를 누르세요.";
      } catch (e) {
        if (gen === generation) status.textContent = e.message;
      } finally {
        if (gen === generation) verify.disabled = !raw.length;
      }
    },
    "primary",
  );
  const commit = button(
    "확인한 데이터 가져오기",
    async () => {
      if (!preview) return;
      commit.disabled = true;
      verify.disabled = true;
      container.inert = true;
      try {
        const result = await api("import", {
          method: "POST",
          body: {
            kind,
            rows: raw,
            fingerprint: preview.fingerprint,
            policy: policy.value,
            policies: raw.map((_, i) => policies[i] || policy.value),
          },
        });
        status.textContent = `저장 완료: ${result.written}개 처리, ${result.skipped}개 기존 유지`;
        raw = [];
        preview = null;
        results.replaceChildren();
        await onImported();
      } catch (e) {
        status.textContent = e.message;
        preview = null;
      } finally {
        verify.disabled = !raw.length;
        container.inert = false;
      }
    },
    "primary",
  );
  commit.disabled = true;
  verify.disabled = true;
  function invalidate() {
    generation++;
    verify.disabled = true;
    preview = null;
    commit.disabled = true;
    status.textContent = "변경한 내용은 서버에서 다시 검증해야 합니다.";
  }
  function showLocal() {
    preview = null;
    commit.disabled = true;
    if (!Array.isArray(raw) || raw.length > 500) {
      raw = [];
      throw Error(
        "한 번에 최대 500개 행을 가져올 수 있습니다. 파일을 나누어 주세요.",
      );
    }
    policies = raw.map(() => policy.value);
    showRows(raw.map((r) => validateRow(kind, r)));
  }
  function showRows(rows) {
    verify.disabled = !raw.length;
    results.replaceChildren();
    results.append(
      el("h3", {}, `${filename} · 총 ${rows.length}개 항목`),
      el(
        "div",
        { class: "toolbar" },
        ...["VALID", "WARNING", "ERROR"].map((s) =>
          el(
            "span",
            { class: `badge status-${s}` },
            `${{ VALID: "정상", WARNING: "확인 필요", ERROR: "오류" }[s]} ${rows.filter((r) => r.status === s).length}`,
          ),
        ),
      ),
    );
    const table = el(
        "table",
        {},
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ...["행 / 상태", "데이터", "검증 내용", "중복 정책 / 수정"].map(
              (t) => el("th", {}, t),
            ),
          ),
        ),
      ),
      body = el("tbody", {});
    rows.forEach((r, i) => {
      if (filter.checked && r.status === "VALID") return;
      const data = r.data || {},
        pol = el(
          "select",
          {
            ariaLabel: `${i + 1}행 중복 정책`,
            onChange: () => (policies[i] = pol.value),
          },
          ...[
            ["keep", "기존 유지"],
            ["overwrite", "덮어쓰기"],
            ["both", "둘 다 유지"],
          ].map(([v, t]) =>
            el(
              "option",
              { value: v, selected: (policies[i] || policy.value) === v },
              t,
            ),
          ),
        );
      const edit = button("이 행 수정", () => {
        const editor = el("textarea", {
            value: JSON.stringify(raw[i], null, 2),
            ariaLabel: `${i + 1}행 JSON 수정`,
          }),
          error = el("p", { class: "danger" }),
          save = button("행 수정 적용", () => {
            try {
              const value = JSON.parse(editor.value);
              if (!value || typeof value !== "object" || Array.isArray(value))
                throw Error("행은 JSON 객체여야 합니다.");
              raw[i] = value;
              invalidate();
              showRows(raw.map((r) => validateRow(kind, r)));
            } catch (e) {
              error.textContent = e.message;
            }
          });
        cell.replaceChildren(
          editor,
          error,
          save,
          button("취소", () => showRows(rows)),
        );
      });
      const cell = el(
        "td",
        {},
        pol,
        edit,
        button("행 제외", () => {
          raw.splice(i, 1);
          policies.splice(i, 1);
          invalidate();
          showRows(raw.map((r) => validateRow(kind, r)));
        }),
      );
      body.append(
        el(
          "tr",
          { class: r.status },
          el("td", {}, `${i + 1} · ${r.status}`),
          el(
            "td",
            {},
            el(
              "strong",
              {},
              data.simplified ||
                data.korean ||
                data.title ||
                data.question ||
                "(필수 값 없음)",
            ),
            el("div", { class: "muted" }, data.pinyin || data.answer || ""),
            el("div", {}, data.meaning || ""),
            ["vocabulary", "sentences"].includes(kind)
              ? el("span", { class: "badge" }, data.source === 0 ? "교과서" : data.source === 1 ? "보충자료" : "출처 미지정")
              : null,
          ),
          el("td", {}, [...r.errors, ...r.warnings].join(" / ") || "정상"),
          cell,
        ),
      );
    });
    table.append(body);
    results.append(el("div", { class: "table-wrap" }, table));
  }
  container.append(
    el("h2", {}, "시험범위 파일 가져오기"),
    el(
      "p",
      { class: "muted" },
      "파일 선택 → 행 수정 → 서버 검증 → 확인 후 저장. XLSX는 브라우저에서만 파싱합니다.",
    ),
    el("div", { class: "toolbar" }, el("label", {}, "유형", type), file),
    sheetHolder,
    el(
      "div",
      { class: "note" },
      "CSV 첫 행은 필드명입니다. characters / tokens / 예문 배열은 JSON 형식으로 입력하세요. 단어·문장의 source 열: 0=교과서, 1=보충자료, 빈칸=출처 미지정(둘 다에서만 학습). XLSX는 vocabulary, sentences, grammar, culture 시트를 각각 선택해 가져옵니다. 최대 500행 · 파일 5 MB · JSON 요청 2 MB.",
    ),
    el(
      "div",
      { class: "toolbar" },
      el(
        "a",
        { class: "button", href: "/fixtures/sample.xlsx", download: "" },
        "XLSX 예제",
      ),
      el(
        "a",
        { class: "button", href: "/fixtures/vocabulary.csv", download: "" },
        "CSV 예제",
      ),
    ),
    el(
      "div",
      { class: "toolbar" },
      el("label", {}, "전체 중복 정책", policy),
      el("label", {}, filter, "문제 있는 행만 보기"),
    ),
    results,
    status,
    el("div", { class: "toolbar" }, verify, commit),
  );
  root.append(container);
}
