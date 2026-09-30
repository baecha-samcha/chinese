import {
  el,
  button,
  title,
  shuffle,
  toast,
  readLocal,
  writeLocal,
  diffComponentMultiset,
  codePointLabel,
} from "./utils.js";
import { normalizePinyin } from "./validation.js";
import {
  eligible,
  makeQuestion,
  grade,
  record,
  buildExam,
  getStats,
  drawFromQueue,
  filterStudySource,
} from "./study.js";
import { speechControls, speechSettings, speechAvailable } from "./speech.js";
export const areas = {
  learn: ["뜻 학습", "단어와 뜻을 양방향으로 익혀요.", "01"],
  write: ["한자 조립", "구성요소를 골라 간체자를 완성해요.", "02"],
  pronunciation: ["병음 · 발음", "눈으로 익히고, 귀로 기억해요.", "03"],
  sentence: ["문장 배열", "단어를 눌러 문장 순서를 만들어요.", "04"],
  grammar: ["문법 연습", "시험범위 예문으로 규칙을 확인해요.", "05"],
  culture: ["중국 문화", "명절부터 일상까지, 시험에 나오는 문화.", "06"],
};
export function searchBox(data) {
  const results = el("div", { class: "search-results" }),
    input = el("input", {
      type: "search",
      placeholder: "한자, 병음, 뜻, 한자음으로 검색",
      ariaLabel: "학습 단어 검색",
      onInput: () => {
        const q = input.value.trim().toLowerCase();
        results.replaceChildren();
        if (!q) return;
        const n = normalizePinyin(q);
        for (const v of data.vocabulary
          .filter(
            (v) =>
              [
                v.simplified,
                v.traditional,
                v.pinyin,
                v.meaning,
                v.korean_hanja_reading,
              ].some((x) => x?.toLowerCase().includes(q)) ||
              normalizePinyin(v.pinyin).includes(n),
          )
          .slice(0, 50)) {
          results.append(
            el(
              "div",
              { class: "search-item" },
              el("span", { class: "hanzi", lang: "zh-CN" }, v.simplified),
              el(
                "div",
                {},
                el("strong", {}, v.meaning),
                el("div", { class: "muted" }, v.pinyin),
              ),
              speechControls(v.simplified),
            ),
          );
        }
        if (!results.children.length)
          results.append(el("p", { class: "muted" }, "검색 결과가 없습니다."));
      },
    });
  return el("section", {}, el("div", { class: "toolbar" }, input), results);
}
export function renderHome(root, data) {
  const fullData = data;
  const settings = readLocal("ch.settings", {});
  data = filterStudySource(data, settings);
  const stats = Object.values(getStats()),
    correct = stats.reduce((s, x) => s + x.correct, 0),
    wrong = stats.reduce((s, x) => s + x.wrong, 0);
  root.append(
    el(
      "section",
      { class: "hero" },
      el(
        "div",
        {},
        title(
          "CHINESE STUDY ROOM",
          "오늘의 한 글자,\n내일의 자신감.",
          "단어부터 문장, 문화까지. 시험범위에 맞춰 짧게 반복하고 헷갈리는 부분을 다시 익혀보세요.",
        ),
        el(
          "div",
          { class: "row" },
          el(
            "a",
            { href: "/learn", "data-route": "", class: "button primary" },
            "학습 시작하기 ↗",
          ),
          el(
            "a",
            { href: "/test", "data-route": "", class: "button" },
            "실전처럼 시험 보기",
          ),
        ),
      ),
      el(
        "div",
        { class: "hero-art" },
        el("span", { class: "eyebrow" }, "조금씩, 확실하게"),
        el("div", { class: "hanzi", lang: "zh-CN" }, "学"),
        el("span", { class: "muted" }, "xué · 배우다"),
      ),
    ),
  );
  root.append(sourceControl(settings, () => {
    root.replaceChildren();
    renderHome(root, fullData);
  }));
  root.append(
    el(
      "div",
      { class: "stats" },
      ...[
        [data.vocabulary.length, "학습 단어"],
        [correct + wrong, "누적 풀이"],
        [
          correct + wrong
            ? `${Math.round((correct / (correct + wrong)) * 100)}%`
            : "—",
          "정답률",
        ],
      ].map(([n, label]) =>
        el(
          "div",
          { class: "card stat" },
          el("strong", {}, n),
          el("span", {}, label),
        ),
      ),
    ),
  );
  root.append(
    el(
      "div",
      { class: "row spread" },
      el("h2", {}, "무엇부터 익혀볼까요?"),
      el("span", { class: "muted" }, "오답을 반영한 반복 학습"),
    ),
  );
  root.append(
    el(
      "div",
      { class: "grid" },
      ...Object.entries(areas).map(([path, [name, desc, n]]) =>
        el(
          "a",
          { class: "card link-card", href: `/${path}`, "data-route": "" },
          el(
            "div",
            { class: "card-top" },
            el("span", { class: "eyebrow" }, n),
            el("span", { class: "badge" }, `${eligible(data, path).length}개`),
          ),
          el("h3", {}, name),
          el("div", { class: "muted" }, desc),
        ),
      ),
    ),
  );
  root.append(el("a", { class: "card link-card", href: "/match", "data-route": "" }, el("h3", {}, "짝 맞추기"), el("p", { class: "muted" }, "3분 동안 중국어와 한국어 뜻을 빠르게 연결해요.")));
  root.append(searchBox(data));
  if (!data.vocabulary.length)
    root.append(
      el(
        "div",
        { class: "note" },
        "데이터가 비어 있습니다. 관리 → 파일 가져오기에서 시험범위를 등록하거나 README의 seed를 실행하세요.",
      ),
    );
}
function selectSetting(settings, key, options, refresh) {
  const select = el(
    "select",
    {
      ariaLabel: key,
      onChange: () => {
        settings[key] = select.value;
        writeLocal("ch.settings", settings);
        refresh();
      },
    },
    ...options.map(([v, t]) =>
      el("option", { value: v, selected: settings[key] === v }, t),
    ),
  );
  return select;
}
export function sourceControl(settings, refresh) {
  settings.studySource = ["0", "1"].includes(String(settings.studySource))
    ? String(settings.studySource) : "all";
  const select = selectSetting(settings, "studySource", [
    ["all", "둘 다"], ["0", "교과서만"], ["1", "보충자료만"],
  ], refresh);
  select.setAttribute("aria-label", "학습 출처");
  return el("section", {class: "source-filter"},
    el("label", {class: "toolbar"}, "학습 범위", select),
    el("p", {class: "muted"}, "단어·문장에 적용됩니다. 문법·문화는 공통 범위이며, 출처 미지정 항목은 ‘둘 다’에 포함됩니다."),
  );
}
export function renderLearning(root, data, area) {
  const fullData = data;
  const [name, desc] = areas[area],
    settings = readLocal("ch.settings", {
      difficulty: "normal",
      direction: "mixed",
      pronunciationMode: "pinyin",
      grammarMode: "mixed",
      cultureMode: "choice",
    });
  data = filterStudySource(data, settings);
  let q, lastKey;
  let queueState = { queue: [], signature: "" };
  const host = el("div", { class: "study" }),
    toolbar = el("div", { class: "toolbar" });
  const next = () => {
    let pool = eligible(data, area, settings);
    if (area === "grammar" && settings.grammarMode !== "mixed")
      pool = pool.filter((e) => makeQuestion(data, area, settings, e));
    queueState = drawFromQueue(queueState, pool, lastKey);
    q = queueState.item
      ? makeQuestion(data, area, settings, queueState.item)
      : null;
    host.replaceChildren();
    if (!q) {
      host.append(
        el(
          "div",
          { class: "card empty" },
          el("h2", {}, "학습할 데이터가 없습니다."),
          el(
            "p",
            { class: "muted" },
            "이 유형의 데이터를 import하거나 다른 설정을 선택하세요.",
          ),
          el(
            "a",
            { href: "/admin/import", "data-route": "", class: "button" },
            "파일 가져오기",
          ),
        ),
      );
      return;
    }
    lastKey = q.key;
    renderQuestion(host, q, { onNext: next });
  };
  root.append(title("PRACTICE", name, desc));
  root.append(sourceControl(settings, () => {
    root.replaceChildren();
    renderLearning(root, fullData, area);
  }));
  if (area === "learn")
    toolbar.append(
      selectSetting(
        settings,
        "direction",
        [
          ["mixed", "양방향"],
          ["forward", "중국어 → 한국어"],
          ["reverse", "한국어 → 중국어"],
        ],
        next,
      ),
    );
  if (area === "write")
    toolbar.append(
      selectSetting(
        settings,
        "difficulty",
        [
          ["easy", "Easy · 빈칸 하나"],
          ["normal", "Normal · 뜻 + 병음"],
          ["hard", "Hard · 뜻만"],
        ],
        next,
      ),
    );
  if (area === "pronunciation") {
    toolbar.append(
      selectSetting(
        settings,
        "pronunciationMode",
        [
          ["pinyin", "한자 → 병음"],
          ["tone", "한자 → 성조 (Hard)"],
          ["listen", "듣기 → 한자"],
          ["character", "병음 → 한자"],
        ],
        next,
      ),
    );
    root.append(speechSettings());
    if (!speechAvailable())
      root.append(
        el(
          "p",
          { class: "note" },
          "중국어 TTS 음성이 아직 없거나 준비 중입니다. 듣기 문제에서 재생되지 않으면 병음 모드를 이용하세요.",
        ),
      );
  }
  if (area === "grammar")
    toolbar.append(
      selectSetting(
        settings,
        "grammarMode",
        [
          ["mixed", "모든 유형"],
          ["correct", "맞는 문장"],
          ["wrong", "틀린 문장"],
          ["error", "오류 부분 찾기"],
          ["blank", "빈칸 채우기"],
          ["order", "문장 배열"],
        ],
        next,
      ),
    );
  if (area === "culture")
    toolbar.append(
      selectSetting(
        settings,
        "cultureMode",
        [
          ["choice", "객관식"],
          ["ox", "O / X"],
          ["short", "단답형"],
        ],
        next,
      ),
    );
  root.append(toolbar, host, searchBox(data));
  next();
}
// Turns a wrong assembly answer into "what exactly did I get wrong" instead of
// just showing the correct answer: what was picked, and — since duplicates are
// possible (木+木+日) — precisely which components were extra or missing, via
// multiset diff (never a Set, never position-based).
function componentDiff(q, value) {
  const expected = q.nodes.map((n) => n.value),
    chosen = Array.isArray(value) ? value.filter(Boolean) : [],
    { extra, missing } = diffComponentMultiset(expected, chosen),
    row = (label, items, cls = "") =>
      el(
        "div",
        { class: "diff-row" },
        el("span", { class: "muted" }, label),
        el(
          "div",
          { class: `diff-components ${cls}` },
          items.length ? items.join(" + ") : "—",
        ),
      );
  const rows = [row("내가 고른 구성", chosen)];
  if (extra.length)
    rows.push(row("잘못 고른 요소", extra.map(codePointLabel), "wrong"));
  if (missing.length)
    rows.push(row("빠진 요소", missing.map(codePointLabel), "missing"));
  return rows;
}
export function renderQuestion(host, q, { onNext, onAnswer, index, total }) {
  let answered = false;
  const panel = el("section", { class: "card question" }),
    answerBox = el("div", {}),
    feedback = el("div", { "aria-live": "polite" }),
    controls = [];
  if (total)
    panel.append(
      el(
        "div",
        { class: "row spread" },
        el("span", { class: "eyebrow" }, areas[q.area][0]),
        el("span", { class: "muted" }, `${index + 1} / ${total}`),
      ),
      el("progress", { max: total, value: index }),
    );
  else panel.append(el("div", { class: "eyebrow" }, areas[q.area][0]));
  panel.append(
    el(
      "div",
      {
        class:
          q.area === "learn" || (q.area === "pronunciation" && !q.listen)
            ? "hanzi prompt"
            : "prompt",
      },
      q.prompt,
    ),
  );
  if (q.listen) {
    panel.append(speechControls(q.chinese));
    const fallback = el("div", { class: "muted" });
    if (!speechAvailable())
      fallback.textContent =
        "중국어 음성이 없습니다. 이 문제를 건너뛰거나 기기 음성을 설치하세요.";
    panel.append(fallback);
  }
  const finish = (value) => {
    if (answered) return;
    answered = true;
    skip.disabled = true;
    const correct = grade(q, value);
    if (!record(q, correct))
      toast("저장 공간 문제로 학습 기록을 저장하지 못했습니다.");
    controls.forEach((c) => (c.disabled = true));
    onAnswer?.({ q, value, correct });
    const details = el(
      "div",
      { class: `feedback ${correct ? "" : "error"}` },
      el("strong", {}, correct ? "정답이에요!" : "다시 기억해 두세요."),
      ...(q.type === "component" && !correct ? componentDiff(q, value) : []),
      el("div", {}, `정답: ${q.answer}`),
      q.explanation ? el("div", { class: "muted" }, q.explanation) : null,
    );
    feedback.append(details);
    if (q.chinese) feedback.append(speechControls(q.chinese));
    const next = button(
      total && index === total - 1 ? "결과 보기" : "다음 문제 →",
      onNext,
      "primary",
    );
    feedback.append(next);
    next.focus();
  };
  if (q.type === "choice") {
    const choices = el("div", { class: "options" });
    for (const [i, o] of q.options.entries()) {
      const b = button(
        "",
        () => {
          finish(o);
          for (const c of choices.children) {
            if (c.dataset.answer === q.answer) c.classList.add("correct");
            else if (c === b) c.classList.add("wrong");
          }
        },
        "option",
      );
      b.dataset.answer = o;
      b.append(el("small", {}, i + 1), el("span", {}, o));
      controls.push(b);
      choices.append(b);
    }
    answerBox.append(choices);
    if (q.options.length < 2)
      answerBox.append(
        el(
          "p",
          { class: "note" },
          "보기 후보가 부족합니다. 단어를 더 등록하면 선택지가 늘어납니다.",
        ),
      );
  }
  if (q.type === "short") {
    const input = el("input", {
      placeholder: "정답을 입력하세요",
      ariaLabel: "단답형 정답",
      maxLength: 4000,
    });
    const submit = button(
      "정답 확인",
      () => {
        if (input.value.trim()) finish(input.value);
      },
      "primary",
    );
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit.click();
    });
    controls.push(input, submit);
    answerBox.append(el("div", { class: "toolbar" }, input, submit));
  }
  if (q.type === "order") {
    const chosen = [],
      tokens = shuffle(q.tokens.map((text, id) => ({ text, id }))),
      slots = el("div", { class: "slots", ariaLabel: "선택한 문장" }),
      pool = el("div", { class: "blocks" }),
      submit = button(
        "정답 확인",
        () => finish(chosen.map((id) => q.tokens[id]).join("")),
        "primary",
      );
    submit.disabled = true;
    const redraw = () => {
      slots.replaceChildren(
        ...chosen.map((id) =>
          button(q.tokens[id], () => {
            if (answered) return;
            chosen.splice(chosen.indexOf(id), 1);
            redraw();
          }),
        ),
      );
      if (!chosen.length)
        slots.append(
          el("span", { class: "muted" }, "아래 단어를 순서대로 누르세요"),
        );
      pool.replaceChildren(
        ...tokens.map(({ text, id }) => {
          const b = button(text, () => {
            chosen.push(id);
            redraw();
          });
          b.disabled = chosen.includes(id) || answered;
          return b;
        }),
      );
      submit.disabled = chosen.length !== tokens.length || answered;
    };
    redraw();
    controls.push(submit);
    answerBox.append(slots, pool, submit);
  }
  if (q.type === "component") {
    // Component recall only: this is a flat set of blanks, not a diagram of
    // 礻/兄's actual left-right position — grading (and so the UI) never uses
    // which blank a component lands in, only which components were picked.
    const selected = q.nodes.map((n, i) =>
        q.blank >= 0 && q.blank !== i ? n.value : null,
      ),
      slots = el("div", { class: "slots", ariaLabel: "선택한 구성요소" }),
      pool = el("div", { class: "blocks" });
    const submit = button("조립 확인", () => finish(selected), "primary");
    const draw = () => {
      slots.replaceChildren(
        ...selected.map((v, idx) => {
          const fixed = q.blank >= 0 && q.blank !== idx;
          const b = button(
            v || "?",
            () => {
              if (!answered && !fixed) {
                selected[idx] = null;
                draw();
              }
            },
            "slot component",
          );
          b.disabled = fixed || answered;
          b.setAttribute(
            "aria-label",
            v ? `${idx + 1}번째로 고른 구성요소 ${v}, 누르면 선택 취소` : `빈칸 ${idx + 1}`,
          );
          return b;
        }),
      );
      submit.disabled = selected.some((v) => !v) || answered;
    };
    for (const v of q.options) {
      const b = button(
        v,
        () => {
          const i = selected.indexOf(null);
          if (i >= 0) {
            selected[i] = v;
            draw();
          }
        },
        "component",
      );
      b.setAttribute("aria-label", `구성요소 ${v} 선택`);
      controls.push(b);
      pool.append(b);
    }
    draw();
    controls.push(submit);
    answerBox.append(
      slots,
      el(
        "p",
        { class: "muted" },
        "이 글자를 이루는 구성요소를 모두 선택하세요 · 선택한 칸을 누르면 취소 · 같은 요소는 여러 번 선택 가능",
      ),
      pool,
      submit,
    );
  }
  panel.append(answerBox, feedback);
  const skip = button("건너뛰기", () => {
    onAnswer?.({ q, correct: false, skipped: true, value: "" });
    onNext();
  });
  panel.append(el("div", { class: "toolbar" }, skip));
  panel.append(
    el(
      "small",
      { class: "muted" },
      "객관식: 숫자 키 1–4 · 정답 확인 후 Enter: 다음 문제",
    ),
  );
  host.append(panel);
  // Attached to this panel so navigation never leaves global keyboard handlers behind.
  panel.tabIndex = -1;
  panel.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (!answered && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      answerBox.querySelectorAll(".option")[Number(e.key) - 1]?.click();
    }
  });
  panel.focus({ preventScroll: true });
}
export function renderTest(root, data) {
  root.append(
    title(
      "MOCK EXAM",
      "실전처럼, 한 번에.",
      "영역별 문제 수를 정하고 현재 시험범위를 점검하세요. 같은 항목은 한 시험에서 반복하지 않습니다.",
    ),
  );
  const settings = readLocal("ch.settings", {});
  settings.pronunciationMode = "pinyin";
  settings.grammarMode = "mixed";
  settings.cultureMode = "choice";
  root.append(sourceControl(settings, () => {
    root.replaceChildren();
    renderTest(root, data);
  }));
  const setup = el("div", { class: "card" }),
    counts = {},
    inputs = {},
    max = {};
  const total = el("input", {
      type: "number",
      min: 1,
      max: 100,
      value: 20,
      ariaLabel: "총 문제 수",
    }),
    summary = el("p", { class: "muted" });
  const update = () =>
    (summary.textContent = `선택한 문제: ${Object.values(counts).reduce((a, b) => a + b, 0)}개`);
  for (const [area, [label]] of Object.entries(areas)) {
    max[area] = eligible(data, area, settings).length;
    counts[area] = 0;
    const input = el("input", {
      type: "number",
      min: 0,
      max: Math.min(100, max[area]),
      value: 0,
      ariaLabel: `${label} 문제 수`,
      onInput: () => {
        counts[area] = Number(input.value);
        update();
      },
    });
    inputs[area] = input;
    setup.append(
      el(
        "div",
        { class: "row spread" },
        el("label", {}, label, input),
        el("span", { class: "muted" }, `최대 ${max[area]}개`),
      ),
    );
  }
  const distribute = () => {
    let remaining = Math.max(
      1,
      Math.min(100, Math.floor(Number(total.value) || 20)),
    );
    for (const k of Object.keys(counts)) counts[k] = 0;
    while (remaining > 0) {
      let added = false;
      for (const k of Object.keys(counts)) {
        if (remaining && counts[k] < max[k]) {
          counts[k]++;
          remaining--;
          added = true;
        }
      }
      if (!added) break;
    }
    for (const k of Object.keys(counts)) inputs[k].value = counts[k];
    update();
  };
  setup.prepend(
    el(
      "div",
      { class: "toolbar" },
      el("label", {}, "총 문제 수", total),
      button("선택 범위 자동 배분", distribute),
    ),
  );
  setup.append(
    summary,
    button(
      "시험 시작",
      () => {
        try {
          if (
            Object.values(counts).some((n) => !Number.isInteger(n) || n < 0) ||
            Object.values(counts).reduce((a, b) => a + b, 0) > 100
          )
            throw Error("문제 수는 정수로, 합계 100개 이하로 설정하세요.");
          const questions = buildExam(data, counts, settings);
          if (!questions.length) throw Error("문제 수를 선택하세요.");
          setup.remove();
          root.querySelector(".source-filter select").disabled = true;
          const host = el("div", { class: "study" });
          root.append(host);
          let index = 0;
          const answers = [];
          const next = () => {
            host.replaceChildren();
            if (index === questions.length) {
              const correct = answers.filter((a) => a.correct).length;
              host.append(
                el(
                  "div",
                  { class: "card" },
                  el("div", { class: "eyebrow" }, "EXAM COMPLETE"),
                  el("h1", {}, `${correct} / ${questions.length}`),
                  el(
                    "p",
                    {},
                    `정답률 ${Math.round((correct / questions.length) * 100)}% · 건너뛴 문제 ${answers.filter((a) => a.skipped).length}개`,
                  ),
                  el(
                    "div",
                    { class: "results" },
                    ...answers.map((a) =>
                      el(
                        "div",
                        { class: "result-row" },
                        el(
                          "strong",
                          {},
                          `${a.skipped ? "건너뜀" : a.correct ? "✓ 정답" : "✕ 오답"} · ${areas[a.q.area][0]}`,
                        ),
                        el("div", {}, a.q.prompt),
                        el(
                          "div",
                          {},
                          `내 답: ${Array.isArray(a.value) ? a.value.join(" + ") : a.value || "—"} / 정답: ${a.q.answer}`,
                        ),
                        el("div", { class: "muted" }, a.q.explanation),
                      ),
                    ),
                  ),
                  button(
                    "새 시험 만들기",
                    () => {
                      root.replaceChildren();
                      renderTest(root, data);
                    },
                    "primary",
                  ),
                ),
              );
              return;
            }
            renderQuestion(host, questions[index], {
              index,
              total: questions.length,
              onAnswer: (a) => answers.push(a),
              onNext: () => {
                index++;
                next();
              },
            });
          };
          next();
        } catch (e) {
          toast(e.message);
        }
      },
      "primary",
    ),
  );
  root.append(setup);
  distribute();
}
