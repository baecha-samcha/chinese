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
