export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k in n && k !== "list") n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity))
    if (c != null)
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
export const button = (text, fn, cls = "") =>
  el("button", { type: "button", class: cls, onClick: fn }, text);
export const shuffle = (a, rng = Math.random) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
// Component recall is graded as a multiset: order never matters, but a component
// required twice (e.g. 木+木+日) must be picked twice. Never compare as Sets.
export function diffComponentMultiset(expected, selected) {
  const remaining = [...expected],
    matched = [],
    extra = [];
  for (const v of selected || []) {
    const i = remaining.indexOf(v);
    if (i >= 0) {
      remaining.splice(i, 1);
      matched.push(v);
    } else extra.push(v);
  }
  return {
    matched,
    missing: remaining,
    extra,
    correct: remaining.length === 0 && extra.length === 0,
  };
}
export const sameComponentMultiset = (expected, selected) =>
  diffComponentMultiset(expected, selected).correct;
// Best-effort visual disambiguation for lookalike components (口 vs 囗, 己 vs 已 vs 巳...):
// shown only alongside mismatch feedback, never used for grading.
export function codePointLabel(ch) {
  const cp = typeof ch === "string" && ch.length ? ch.codePointAt(0) : null;
  return cp == null
    ? String(ch)
    : `${ch} (U+${cp.toString(16).toUpperCase().padStart(4, "0")})`;
}
export function toast(text) {
  document.querySelector("#toast").textContent = text;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(
    () => (document.querySelector("#toast").textContent = ""),
    4500,
  );
}
export function download(name, text, type = "application/json") {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: u, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export function readLocal(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export const title = (eyebrow, heading, description) =>
  el(
    "div",
    {},
    el("div", { class: "eyebrow" }, eyebrow),
    el("h1", {}, heading),
    el("p", { class: "muted" }, description),
  );
// Provenance (source) and exam scope (exam_tags) are shown as separate badges.
export const sourceLabel = (source) =>
  source === 0 ? "교과서" : source === 1 ? "보충자료" : "출처 미지정";
export const scopeBadges = (row, exams = []) => [
  ...("source" in row
    ? [el("span", { class: "badge" }, sourceLabel(row.source))]
    : []),
  ...(row.exam_tags || []).map((id) =>
    el(
      "span",
      { class: "badge exam" },
      exams.find((x) => x.id === id)?.label || id,
    ),
  ),
];
