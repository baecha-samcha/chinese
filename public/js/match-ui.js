import { el, button, title, readLocal } from "./utils.js";
import { filterStudyScope, record } from "./study.js";
import { sourceControl } from "./learning-ui.js";
import {
  createMatchGame,
  selectMatchCard,
  tickMatch,
  endMatch,
} from "./match.js";

export function renderMatch(root, data) {
  const settings = readLocal("ch.settings", {});
  let interval, game;
  const stop = () => {
    clearInterval(interval);
    if (game) endMatch(game);
  };
  function setup() {
    stop();
    root.replaceChildren(
      title(
        "MATCH",
        "짝 맞추기",
        "공개된 중국어와 한국어 카드를 하나씩 골라 3분 동안 짝을 맞추세요.",
      ),
    );
    root.append(sourceControl(settings, setup, data.exams));
    const vocabulary = filterStudyScope(data, settings).vocabulary;
    const available = vocabulary.some(
      (v) => v.simplified?.trim() && v.meaning?.trim(),
    );
    root.append(
      el(
        "p",
        { class: "note" },
        "전반부: 100 / 50점 · 후반부(90초 이하): 130 / 80점. 작은 타이머가 5초 초과일 때 높은 점수를 받습니다. 정답·오답·작은 타이머 만료 시 10초로 초기화됩니다. 오답과 만료는 감점이 없습니다.",
      ),
    );
    if (!available)
      root.append(
        el(
          "p",
          { class: "empty" },
          "선택한 범위에 학습할 단어가 없습니다. 학습 범위를 바꾸거나 관리에서 단어를 등록하세요.",
        ),
      );
    else root.append(button("게임 시작", () => start(vocabulary), "primary"));
  }
  function start(vocabulary) {
    stop();
    game = createMatchGame(vocabulary, performance.now());
    const big = el("strong", { "data-testid": "match-big" });
    const small = el("strong", { "data-testid": "match-small" });
    const score = el("strong", { "data-testid": "match-score" });
    const phase = el("p", { class: "muted" });
    const feedback = el(
      "p",
      { role: "status", class: "match-feedback" },
      "카드 두 개를 선택하세요.",
    );
    const board = el("div", {
      class: "match-board",
      "aria-label": "짝 맞추기 카드",
    });
    root.replaceChildren(
      title("MATCH", "짝 맞추기", "중국어와 한국어 뜻의 짝을 찾으세요."),
      el(
        "div",
        { class: "stats" },
        ...[
          [big, "남은 시간 · 大"],
          [small, "작은 타이머 · 小"],
          [score, "점수"],
        ].map(([value, label]) =>
          el("div", { class: "card stat" }, el("span", {}, label), value),
        ),
      ),
      phase,
      feedback,
      board,
    );
    function drawBoard() {
      const focusedId = board.contains(document.activeElement)
        ? document.activeElement.dataset.cardId
        : null;
      game.cards.forEach((card, index) => {
        const existing = board.children[index];
        const b =
          existing?.dataset.cardId === card.id
            ? existing
            : button(
                card.text,
                () => {
                  const result = selectMatchCard(
                    game,
                    card.id,
                    performance.now(),
                  );
                  if (result) {
                    const saved = record(
                      {
                        key: `match:${result.vocabularyId}`,
                        vocabularyId: result.vocabularyId,
                      },
                      result.correct,
                    );
                    feedback.textContent = `${result.correct ? `정답! +${result.points}점` : "오답 · +0점. 다시 골라보세요."}${saved ? "" : " 학습 기록을 저장하지 못했습니다."}`;
                  }
                  update();
                  if (!game.ended) drawBoard();
                },
                `match-card ${card.kind === "zh" ? "hanzi" : ""} ${card.matched ? "matched" : ""}`,
              );
        b.classList.toggle("matched", card.matched);
        b.disabled = card.matched;
        b.lang = card.kind === "zh" ? "zh-CN" : "ko";
        b.dataset.cardId = card.id;
        b.setAttribute("aria-pressed", String(game.selected === card.id));
        if (card.matched)
          b.setAttribute("aria-label", `${card.text} · 매칭 완료`);
        if (b !== existing) {
          if (existing) existing.replaceWith(b);
          else board.append(b);
        }
      });
      if (focusedId) {
        const target =
          [...board.children].find(
            (b) => b.dataset.cardId === focusedId && !b.disabled,
          ) || board.querySelector("button:not(:disabled)");
        target?.focus({ preventScroll: true });
      }
    }
    function update() {
      const serial = game.serial;
      tickMatch(game, performance.now());
      if (!game.ended && game.serial !== serial) drawBoard();
      if (game.ended) {
        stop();
        root.replaceChildren(
          title("RESULT", "매칭 결과", "3분이 끝났습니다."),
          el(
            "div",
            { class: "stats" },
            ...[
              [game.score, "최종 점수"],
              [game.correct, "정답 수"],
              [game.wrong, "오답 수"],
            ].map(([n, label]) =>
              el(
                "div",
                { class: "card stat" },
                el("span", {}, label),
                el("strong", {}, n),
              ),
            ),
          ),
          button("다시 하기", setup, "primary"),
        );
        return;
      }
      const seconds = Math.ceil(game.bigTimer);
      big.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      small.textContent = `${(Math.ceil(game.smallTimer * 10) / 10).toFixed(1)}초`;
      score.textContent = String(game.score);
      phase.textContent = `${game.bigTimer > 90 ? "전반부 · 100 / 50점" : "후반부 · 130 / 80점"} · 정답 ${game.correct} · 오답 ${game.wrong}`;
    }
    drawBoard();
    update();
    interval = setInterval(update, 50);
  }
  setup();
  return stop;
}
