import test from "node:test";
import assert from "node:assert/strict";
import {
  matchPoints,
  createMatchGame,
  tickMatch,
  selectMatchCard,
} from "../public/js/match.js";
const vocabulary = Array.from({ length: 15 }, (_, id) => ({
  id: id + 1,
  simplified: `字${id}`,
  meaning: `뜻${id}`,
}));
for (const [big, small, expected] of [
  [91, 5.1, 100],
  [91, 5, 50],
  [90, 5.1, 130],
  [90, 5, 80],
  [0, 10, 0],
]) {
  test(`score ${big}/${small} = ${expected}`, () =>
    assert.equal(matchPoints(big, small, true), expected));
}
test("wrong answers never score", () =>
  assert.equal(matchPoints(90, 10, false), 0));
test("small expiration resets without a penalty, including a delayed tick", () => {
  const g = createMatchGame(vocabulary, 0);
  selectMatchCard(g, g.cards[0].id, 0);
  tickMatch(g, 10000);
  assert.equal(g.smallTimer, 10);
  assert.equal(g.score, 0);
  assert.equal(g.wrong, 0);
  assert.equal(g.selected, g.cards[0].id);
  tickMatch(g, 45200);
  assert.equal(g.bigTimer, 134.8);
  assert.equal(g.smallTimer, 4.8);
});
test("same-kind and mismatched cards count once and reset the timer", () => {
  for (const kind of ["zh", "ko"]) {
    const g = createMatchGame(vocabulary, 0);
    const a = g.cards.find((c) => c.kind === "zh");
    const b = g.cards.find((c) => c.kind === kind && c.pair !== a.pair);
    selectMatchCard(g, a.id, 1000);
    assert.equal(g.wrong, 0);
    assert.equal(selectMatchCard(g, b.id, 5000).points, 0);
    assert.equal(g.wrong, 1);
    assert.equal(g.smallTimer, 10);
    assert.equal(g.selected, null);
  }
});
test("correct cards are disabled and score from the current timestamps", () => {
  const g = createMatchGame(vocabulary, 0);
  const a = g.cards[0],
    b = g.cards.find((c) => c.pair === a.pair && c.kind !== a.kind);
  selectMatchCard(g, a.id, 1000);
  assert.equal(selectMatchCard(g, b.id, 5000).points, 50);
  assert.equal(g.correct, 1);
  assert.equal(g.smallTimer, 10);
  assert.equal(selectMatchCard(g, a.id, 6000), null);
  assert.equal(g.selected, null);
});
test("full boards refill, exhaust the bag before repeating, and keep the game running", () => {
  const g = createMatchGame(vocabulary, 0);
  const ids = [];
  for (let round = 0; round < 4; round++) {
    const cards = [...g.cards];
    for (const a of cards.filter((c) => c.kind === "zh")) {
      ids.push(a.vocabularyId);
      selectMatchCard(g, a.id, 1000);
      selectMatchCard(
        g,
        cards.find((c) => c.pair === a.pair && c.kind === "ko").id,
        1000,
      );
    }
  }
  assert.equal(new Set(ids).size, 15);
  assert.equal(ids.length, 15);
  assert.equal(g.round, 5);
  assert.equal(g.ended, false);
});
test("deadline blocks inputs even if no render tick has run", () => {
  const g = createMatchGame(vocabulary, 0);
  const a = g.cards[0],
    b = g.cards.find((c) => c.pair === a.pair && c.kind !== a.kind);
  selectMatchCard(g, a.id, 179999);
  assert.equal(selectMatchCard(g, b.id, 180000), null);
  assert.equal(g.ended, true);
  assert.equal(g.bigTimer, 0);
  assert.equal(g.correct, 0);
  assert.equal(g.score, 0);
  assert.equal(selectMatchCard(g, a.id, 180001), null);
});
test("empty datasets and repeated labels are safe", () => {
  assert.equal(createMatchGame([], 0).ended, true);
  const g = createMatchGame(
    [
      { id: 1, simplified: "好", meaning: "좋다" },
      { id: 2, simplified: "好", meaning: "좋다" },
      { id: 3, simplified: "好", meaning: "좋아하다" },
      { id: 4, simplified: "", meaning: "빈칸" },
    ],
    0,
  );
  assert.equal(g.pool.length, 2);
  assert.equal(g.cards.length, 2);
  assert.equal(g.bag.length, 1);
});

test("selecting the same card again cancels without scoring or resetting the timer", () => {
  const g = createMatchGame(vocabulary, 0);
  const card = g.cards[0];
  selectMatchCard(g, card.id, 1000);
  assert.equal(selectMatchCard(g, card.id, 2000), null);
  assert.equal(g.selected, null);
  assert.equal(g.wrong, 0);
  assert.equal(g.correct, 0);
  assert.equal(g.score, 0);
  assert.equal(g.smallDeadline, 10000);
  selectMatchCard(g, card.id, 3000);
  assert.equal(g.selected, card.id);
});
test("boards contain at most four pairs with Chinese left and Korean right", () => {
  const g = createMatchGame(vocabulary, 0);
  assert.equal(g.cards.length, 8);
  assert.deepEqual(
    g.cards.map((card) => card.kind),
    ["zh", "ko", "zh", "ko", "zh", "ko", "zh", "ko"],
  );
});
