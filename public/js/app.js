import { el, button, title, toast } from "./utils.js";
import { loadStudy } from "./api.js";
import {
  renderHome,
  renderLearning,
  renderTest,
  areas,
} from "./learning-ui.js";
import { renderMatch } from "./match-ui.js";
const main = document.querySelector("#main");
let dataset = null,
  version = 0;
let cleanup;
async function route() {
  cleanup?.();
  cleanup = null;
  const token = ++version,
    path = location.pathname.replace(/\/$/, "") || "/";
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  document
    .querySelectorAll("header nav a")
    .forEach((a) =>
      a.classList.toggle(
        "active",
        path === a.pathname ||
          (a.pathname === "/admin" && path.startsWith("/admin/")),
      ),
    );
  main.replaceChildren(
    el("p", { class: "muted" }, "학습실을 준비하고 있어요…"),
  );
  try {
    const screen = el("div", {});
    if (path === "/admin" || path.startsWith("/admin/")) {
      const { renderAdmin } = await import("./admin.js");
      await renderAdmin(screen, path, async () => {
        dataset = null;
      });
    } else if (path === "/exam") {
      const { renderExam } = await import("./exam/ui.js");
      if (token !== version) return;
      const examCleanup = await renderExam(screen);
      if (token !== version) { examCleanup?.(); return; }
      cleanup = examCleanup;
    } else {
      dataset = dataset || (await loadStudy());
      if (dataset.cached)
        screen.append(
          el(
            "div",
            { class: "note" },
            "연결이 불안정하여 마지막으로 저장된 학습 데이터를 사용합니다.",
            button("다시 연결", () => {
              dataset = null;
              route();
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
            }),
          ),
        );
      if (token !== version) return;
      // Screens re-render their root with replaceChildren, so give them their
      // own container to keep the offline note above visible.
      const content = el("div", {});
      screen.append(content);
      if (path === "/match") cleanup = renderMatch(content, dataset);
      else if (path === "/") renderHome(content, dataset);
      else if (areas[path.slice(1)])
        renderLearning(content, dataset, path.slice(1));
      else if (path === "/test") renderTest(content, dataset);
      else
        content.append(
          title(
            "404",
            "페이지를 찾을 수 없습니다.",
            "메뉴에서 학습할 영역을 선택하세요.",
          ),
        );
    }
    if (token !== version) return;
    main.replaceChildren(screen);
    document.title = `${path === "/" ? "홈" : areas[path.slice(1)]?.[0] || (path.startsWith("/admin") ? "관리" : path === "/match" ? "짝 맞추기" : path === "/exam" ? "실전시험" : path === "/test" ? "종합시험" : "차곡")} · 차곡 중국어 시험 대비`;
    main.querySelector(".question")?.focus({ preventScroll: true });
  } catch (e) {
    if (token === version)
      main.replaceChildren(
        el(
          "div",
          { class: "card empty" },
          el("h2", {}, "화면을 불러오지 못했습니다."),
          el("p", { class: "muted" }, e.message),
          button("다시 시도", route),
        ),
      );
  }
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-route]");
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  history.pushState({}, "", a.href);
  route();
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
  window.scrollTo(0, 0);
});
window.addEventListener("popstate", route);
window.addEventListener("offline", () =>
  toast("연결이 끊겼습니다. 이미 불러온 학습은 계속할 수 있어요."),
);
route();
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
