// Shared building blocks for every study screen, so 뜻/한자 조립/발음/문장/
// 문법/문화 (and the home, 종합시험, 짝 맞추기 screens) use one layout system:
//
//   pageHeader      eyebrow + h1 + one-line description
//   quizToolbar     one panel of labeled settings (학습 범위 … 답 방식)
//   field           a labeled control inside the toolbar
//   helpToggle      "ⓘ …" collapsible help instead of always-on paragraphs
//   statusChip      a small status pill (e.g. 음성 사용 불가)
//   utilitySection  secondary tools below the study flow (단어 찾기)
//
// The quiz card itself (prompt → answer area → feedback area → action bar)
// lives in renderQuestion in learning-ui.js and uses the classes styled in
// style.css under "Quiz card".
import { el } from "./utils.js";

export function pageHeader(eyebrow, heading, description, { compact } = {}) {
  return el(
    "div",
    { class: compact ? "page-header compact" : "page-header" },
    el("div", { class: "eyebrow" }, eyebrow),
    el("h1", {}, heading),
    description ? el("p", { class: "muted" }, description) : null,
  );
}

let fieldId = 0;
// The visible label is a real <label for> when the control is labelable, so
// clicking it focuses the control; `extra` (e.g. a "?" help button) sits next
// to the control but outside the label.
export function field(label, control, extra = null) {
  const labelable = ["SELECT", "INPUT", "TEXTAREA"].includes(control.tagName);
  if (labelable && !control.id) control.id = `field-${++fieldId}`;
  return el(
    "div",
    { class: "field" },
    el(
      labelable ? "label" : "span",
      { class: "field-label", ...(labelable ? { htmlFor: control.id } : {}) },
      label,
    ),
    el("div", { class: "field-control" }, control, extra),
  );
}

export const toolbarRow = (...items) =>
  el("div", { class: "toolbar-row" }, ...items);

export const quizToolbar = (...rows) =>
  el("section", { class: "quiz-toolbar", ariaLabel: "학습 설정" }, ...rows);

export const helpToggle = (summary, ...content) =>
  el(
    "details",
    { class: "help-toggle" },
    el("summary", {}, el("span", { "aria-hidden": "true" }, "ⓘ "), summary),
    el("div", { class: "help-body" }, ...content),
  );

export const statusChip = (text, tone = "", hint = "") =>
  el(
    "span",
    { class: `status-chip ${tone}`.trim(), ...(hint ? { title: hint } : {}) },
    text,
  );

export const utilitySection = (heading, ...content) =>
  el(
    "section",
    { class: "utility", ariaLabel: heading },
    el("h2", { class: "utility-title" }, heading),
    ...content,
  );
