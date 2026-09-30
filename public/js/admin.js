import { el, button, title, toast, download, scopeBadges } from "./utils.js";
import { api } from "./api.js";
import { renderImport, toCSV } from "./import.js";
import { normalizePinyin } from "./validation.js";
const labels = {
  vocabulary: "단어",
  grammar: "문법",
  sentences: "문장",
  culture: "문화",
};
export async function renderAdmin(root, path, onChanged) {
  const session = await api("admin/session");
  if (!session.authenticated) {
    root.append(
      title(
        "ADMIN",
        "관리자 인증 필요",
        "Cloudflare Access로 로그인하세요. 로컬에서는 README의 .dev.vars 설정을 확인하세요.",
      ),
    );
    return;
  }
  root.append(
    title(
      "CONTENT STUDIO",
      "시험범위 관리",
      "파일로 한 번에 등록하고, 필요한 항목만 수정하세요.",
    ),
  );
  root.append(
    el(
      "nav",
      { class: "subnav", ariaLabel: "관리 메뉴" },
      ...[
        ["", "개요"],
        ["import", "파일 가져오기"],
        ...Object.entries(labels),
      ].map(([k, t]) =>
        el(
          "a",
          {
            href: `/admin${k ? "/" + k : ""}`,
            "data-route": "",
            class: path === `/admin${k ? "/" + k : ""}` ? "active" : "",
          },
          t,
        ),
      ),
    ),
  );
  const kind = path.split("/")[2];
  if (kind === "import") {
    renderImport(root, onChanged);
    return;
  }
  if (!kind) {
    const box = el(
      "div",
      { class: "card" },
      el("h2", {}, "파일부터 시작하세요"),
      el(
        "p",
        { class: "muted" },
        "XLSX / CSV 파일을 올리고 미리보기에서 오류와 중복을 확인하세요. JSON 백업도 다시 가져올 수 있습니다.",
      ),
      el(
        "a",
        { href: "/admin/import", "data-route": "", class: "button primary" },
        "파일 가져오기 →",
      ),
    );
    box.append(
      el(
        "div",
        { class: "toolbar" },
        button("전체 JSON 백업", async () => {
          try {
            download(
              `ch-backup-${new Date().toISOString().slice(0, 10)}.json`,
              JSON.stringify(await api("export"), null, 2),
            );
          } catch (e) {
            toast(e.message);
          }
        }),
      ),
    );
    root.append(box);
    return;
  }
  if (!labels[kind]) {
    root.append(el("p", {}, "관리 페이지를 찾을 수 없습니다."));
    return;
  }
  let rows = await api(kind);
  const exams = await api("exams").catch(() => []);
  const list = el("div", {}),
    editor = el("div", {}),
    search = el("input", {
      type: "search",
      placeholder: "검색: 한자 · 병음 · 뜻 · 한자음",
      ariaLabel: "관리 데이터 검색",
      onInput: draw,
    });
  function edit(row) {
    const data = row
      ? Object.fromEntries(
          Object.entries(row).filter(
            ([k]) =>
              !["id", "created_at", "updated_at", "pinyin_normalized"].includes(
                k,
              ),
          ),
        )
      : kind === "vocabulary"
        ? {
            simplified: "",
            traditional: "",
            pinyin: "",
            meaning: "",
            korean_hanja_reading: "",
            characters: [],
            source: null,
            exam_tags: [],
          }
        : kind === "sentences"
          ? {
              korean: "",
              chinese: "",
              tokens: [],
              explanation: "",
              pinyin: "",
              category: "",
              source: null,
              exam_tags: [],
            }
          : kind === "grammar"
            ? {
                title: "",
                explanation: "",
                correct_examples: [],
                wrong_examples: [],
                tags: [],
                questions: [],
                exam_tags: [],
              }
            : {
                category: "기타",
                question: "",
                answer: "",
                distractors: [],
                explanation: "",
                exam_tags: [],
              };
    const textarea = el("textarea", {
        value: JSON.stringify(data, null, 2),
        ariaLabel: "항목 JSON 편집",
      }),
      error = el("p", { class: "danger", role: "alert" });
    const save = button(
      "저장",
      async () => {
        save.disabled = true;
        try {
          await api(`${kind}${row ? "/" + row.id : ""}`, {
            method: row ? "PUT" : "POST",
            body: JSON.parse(textarea.value),
          });
          rows = await api(kind);
          editor.replaceChildren();
          draw();
          onChanged();
          toast("저장했습니다.");
        } catch (e) {
          error.textContent = e.message;
        } finally {
          save.disabled = false;
        }
      },
      "primary",
    );
    editor.replaceChildren(
      el(
        "section",
        { class: "card" },
        el("h2", {}, row ? "항목 수정" : "항목 추가"),
        el(
          "p",
          { class: "muted" },
          '배열과 재귀 분해를 보존하는 JSON 편집기입니다. 단어·문장의 source는 0=교과서, 1=보충자료, null=출처 미지정입니다. exam_tags는 이 항목이 포함되는 시험 범위 ID 목록입니다(예: ["2026-midterm"]). 대량 등록은 파일 가져오기를 이용하세요.',
        ),
        textarea,
        error,
        el(
          "div",
          { class: "toolbar" },
          save,
          button("취소", () => editor.replaceChildren()),
        ),
      ),
    );
    textarea.focus();
  }
  function draw() {
    const q = search.value.toLowerCase().trim(),
      norm = normalizePinyin(q),
      filtered = rows.filter(
        (r) =>
          !q ||
          Object.entries(r)
            .filter(([k]) => !["id", "created_at", "updated_at"].includes(k))
            .some(([, v]) =>
              String(typeof v === "object" ? JSON.stringify(v) : v)
                .toLowerCase()
                .includes(q),
            ) ||
          (r.pinyin && normalizePinyin(r.pinyin).includes(norm)),
      );
    list.replaceChildren(
      el(
        "p",
        { class: "muted" },
        `${filtered.length}개 / 전체 ${rows.length}개`,
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
          ...["ID", "내용", "설명", "관리"].map((x) => el("th", {}, x)),
        ),
      ),
    );
    const tbody = el("tbody", {});
    for (const r of filtered) {
      const actions = el(
        "td",
        {},
        button("수정", () => edit(r)),
        button(
          "삭제",
          () => {
            actions.replaceChildren(
              el("span", {}, "이 항목을 삭제할까요?"),
              button(
                "삭제 확정",
                async () => {
                  try {
                    await api(`${kind}/${r.id}`, { method: "DELETE" });
                    rows = rows.filter((x) => x.id !== r.id);
                    draw();
                    onChanged();
                    toast("삭제했습니다.");
                  } catch (e) {
                    toast(e.message);
                  }
                },
                "danger",
              ),
              button("취소", draw),
            );
          },
          "danger",
        ),
      );
      tbody.append(
        el(
          "tr",
          {},
          el("td", {}, r.id),
          el(
            "td",
            {},
            el(
              "span",
              { class: kind === "vocabulary" ? "hanzi" : "" },
              r.simplified || r.korean || r.title || r.question,
            ),
            el(
              "div",
              { class: "muted" },
              r.pinyin || r.chinese || r.category || "",
            ),
            el("div", { class: "row" }, ...scopeBadges(r, exams)),
          ),
          el("td", {}, r.meaning || r.explanation || r.answer || ""),
          actions,
        ),
      );
    }
    table.append(tbody);
    list.append(el("div", { class: "table-wrap" }, table));
  }
  root.append(
    el(
      "div",
      { class: "toolbar" },
      search,
      button("항목 추가", () => edit()),
      button("JSON 내보내기", () =>
        download(`${kind}.json`, JSON.stringify(rows, null, 2)),
      ),
      button("CSV 내보내기", () =>
        download(`${kind}.csv`, toCSV(rows), "text/csv;charset=utf-8"),
      ),
    ),
    editor,
    list,
  );
  draw();
}
