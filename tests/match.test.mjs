import test from "node:test";
import assert from "node:assert/strict";
import {
  endMatch,
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
  const a = g.cards.find((a) =>
      g.cards.some((b) => b.kind !== a.kind && b.pair === a.pair),
    ),
    b = g.cards.find((c) => c.pair === a.pair && c.kind !== a.kind);
  selectMatchCard(g, a.id, 1000);
  assert.equal(selectMatchCard(g, b.id, 5000).points, 50);
  assert.equal(g.correct, 1);
  assert.equal(g.smallTimer, 10);
  assert.equal(selectMatchCard(g, a.id, 6000), null);
  assert.equal(g.selected, null);
});
test("deadline blocks inputs even if no render tick has run", () => {
  const g = createMatchGame(vocabulary, 0);
  const a = g.cards.find((a) =>
      g.cards.some((b) => b.kind !== a.kind && b.pair === a.pair),
    ),
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
  assert.equal(g.queues.zh.length, 1);
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

function solve(g, time) {
  const a = g.cards.find(
    (a) =>
      !a.matched &&
      g.cards.some((b) => !b.matched && b.kind !== a.kind && b.pair === a.pair),
  );
  const b = g.cards.find(
    (b) => !b.matched && b.kind !== a.kind && b.pair === a.pair,
  );
  selectMatchCard(g, a.id, time);
  selectMatchCard(g, b.id, time);
  return [a.id, b.id];
}
function invariant(g) {
  for (const kind of ["zh", "ko"]) {
    const cards = g.cards.filter((c) => c.kind === kind);
    assert.equal(new Set(cards.map((c) => c.text.trim())).size, cards.length);
    assert.equal(new Set(cards.map((c) => c.pair)).size, cards.length);
  }
  const active = g.cards.filter((c) => !c.matched);
  assert.ok(
    active.some((a) =>
      active.some((b) => a.kind !== b.kind && a.pair === b.pair),
    ),
  );
}
test("only solved slots refill after 250ms, stale clicks cannot score, selection survives", () => {
  const g = createMatchGame(vocabulary, 0);
  const before = [...g.cards],
    ids = solve(g, 100);
  const other = g.cards.find((c) => !c.matched);
  selectMatchCard(g, other.id, 200);
  tickMatch(g, 349);
  assert.deepEqual(g.cards, before);
  tickMatch(g, 350);
  before.forEach((c, i) =>
    ids.includes(c.id)
      ? assert.notEqual(g.cards[i].id, c.id)
      : assert.equal(g.cards[i], c),
  );
  assert.equal(g.selected, other.id);
  selectMatchCard(g, other.id, 351);
  assert.equal(g.selected, null);
  assert.equal(selectMatchCard(g, ids[0], 352), null);
  assert.equal(g.correct, 1);
  invariant(g);
});
test("independent queues cycle, distinct replacements stay playable over rapid matches", () => {
  let seed = 17;
  const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const g = createMatchGame(vocabulary, 0, rng);
  const seen = { zh: new Set(), ko: new Set() };
  let different = false;
  for (let i = 0; i < 200; i++) {
    g.cards.forEach((c) => seen[c.kind].add(c.pair));
    const ids = solve(g, i * 500);
    const slots = ids.map((id) => g.cards.findIndex((c) => c.id === id));
    tickMatch(g, i * 500 + 250);
    different ||= g.cards[slots[0]].pair !== g.cards[slots[1]].pair;
    invariant(g);
  }
  assert.ok(different);
  assert.equal(seen.zh.size, 15);
  assert.equal(seen.ko.size, 15);
});
test("small pools and overlapping replacements remain playable", () => {
  for (let size = 1; size <= 4; size++) {
    const g = createMatchGame(vocabulary.slice(0, size), 0);
    for (let i = 0; i < size; i++) solve(g, i);
    assert.equal(g.correct, size);
    tickMatch(g, 300);
    assert.equal(g.cards.length, size * 2);
    invariant(g);
  }
});
test("ambiguous labels are deferred across replacements", () => {
  const words = [
    ...vocabulary.slice(0, 6),
    { id: 99, simplified: "別", meaning: "뜻0" },
  ];
  const g = createMatchGame(words, 0);
  for (let i = 0; i < 100; i++) {
    solve(g, i * 300);
    tickMatch(g, i * 300 + 250);
    invariant(g);
    const distinct = [...new Set(g.cards.map((c) => c.pair))].map(
      (id) => g.pool[id],
    );
    assert.equal(new Set(distinct.map((w) => w.meaning)).size, distinct.length);
  }
});
test("deadline and navigation cancel pending replacements", () => {
  for (const stop of [(g) => tickMatch(g, 180000), endMatch]) {
    const g = createMatchGame(vocabulary, 0);
    solve(g, 179900);
    const serial = g.serial;
    stop(g);
    tickMatch(g, 180500);
    assert.equal(g.pending.length, 0);
    assert.equal(g.serial, serial);
    assert.equal(g.correct, 1);
  }
});

function seededRandom(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
test("initial columns share only the minimum possible pairs", () => {
  for (let size = 1; size <= 15; size++) {
    for (let seed = 1; seed <= 20; seed++) {
      const g = createMatchGame(
        vocabulary.slice(0, size),
        0,
        seededRandom(seed),
      );
      invariant(g);
      const matches = g.cards.filter(
        (a) =>
          a.kind === "zh" &&
          g.cards.some((b) => b.kind === "ko" && a.pair === b.pair),
      );
      assert.equal(matches.length, Math.max(1, 2 * Math.min(4, size) - size));
    }
  }
});
test("new cards never form a pair when playable distinct replacements exist, even with aligned queues", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = createMatchGame(vocabulary, 0, seededRandom(seed));
    // Reproduce the queue alignment that used to keep feeding matching pairs.
    g.queues.zh = [...g.pool];
    g.queues.ko = [...g.pool];
    for (let turn = 0; turn < 100; turn++) {
      const ids = solve(g, turn * 300);
      const slots = ids.map((id) => g.cards.findIndex((c) => c.id === id));
      tickMatch(g, turn * 300 + 250);
      invariant(g);
      assert.notEqual(g.cards[slots[0]].pair, g.cards[slots[1]].pair);
    }
  }
});
