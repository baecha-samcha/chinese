import { shuffle } from "./utils.js";

export function matchPoints(bigTimer, smallTimer, correct) {
  if (!correct || bigTimer <= 0) return 0;
  return (bigTimer > 90 ? 50 : 80) + (smallTimer > 5 ? 50 : 0);
}

// The clock is injected for tests; production uses monotonic performance.now().
export function createMatchGame(
  vocabulary,
  now = performance.now(),
  rng = Math.random,
) {
  const seen = new Set();
  const pool = vocabulary.filter((v) => {
    if (!v.simplified?.trim() || !v.meaning?.trim()) return false;
    const key = JSON.stringify([v.simplified.trim(), v.meaning.trim()]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const game = {
    pool,
    rng,
    bag: [],
    cards: [],
    selected: null,
    deadline: now + 180000,
    smallDeadline: now + 10000,
    bigTimer: 180,
    smallTimer: 10,
    score: 0,
    correct: 0,
    wrong: 0,
    ended: pool.length === 0,
    round: 0,
  };
  if (!game.ended) nextMatchSet(game);
  return game;
}

function nextMatchSet(game) {
  if (!game.bag.length) game.bag = shuffle(game.pool, game.rng);
  const chinese = new Set(),
    korean = new Set(),
    chosen = [];
  // Defer ambiguous labels to the next board, retaining the unplayed bag.
  game.bag = game.bag.filter((v) => {
    if (
      chosen.length === 4 ||
      chinese.has(v.simplified.trim()) ||
      korean.has(v.meaning.trim())
    )
      return true;
    chosen.push(v);
    chinese.add(v.simplified.trim());
    korean.add(v.meaning.trim());
    return false;
  });
  game.round++;
  const cards = chosen.flatMap((v, i) => [
    {
      id: `${game.round}:${i}:zh`,
      pair: i,
      kind: "zh",
      text: v.simplified,
      vocabularyId: v.id,
      matched: false,
    },
    {
      id: `${game.round}:${i}:ko`,
      pair: i,
      kind: "ko",
      text: v.meaning,
      vocabularyId: v.id,
      matched: false,
    },
  ]);
  const left = shuffle(
    cards.filter((card) => card.kind === "zh"),
    game.rng,
  );
  const right = shuffle(
    cards.filter((card) => card.kind === "ko"),
    game.rng,
  );
  game.cards = left.flatMap((card, i) => [card, right[i]]);
}

export function tickMatch(game, now) {
  if (game.ended) return;
  game.bigTimer = Math.max(0, (game.deadline - now) / 1000);
  if (game.bigTimer === 0) {
    game.ended = true;
    game.selected = null;
    game.smallTimer = Math.max(0, (game.smallDeadline - now) / 1000);
    return;
  }
  if (now >= game.smallDeadline) {
    // Preserve 10-second cycles even when a background tab skips render ticks.
    game.smallDeadline +=
      (Math.floor((now - game.smallDeadline) / 10000) + 1) * 10000;
  }
  game.smallTimer = (game.smallDeadline - now) / 1000;
}

export function selectMatchCard(game, id, now) {
  tickMatch(game, now); // Check the actual deadline even before the next render tick.
  if (game.ended) return null;
  const card = game.cards.find((c) => c.id === id);
  if (!card || card.matched) return null;
  if (game.selected === id) {
    game.selected = null;
    return null;
  }
  if (game.selected === null) {
    game.selected = id;
    return null;
  }
  const first = game.cards.find((c) => c.id === game.selected);
  const correct = first.kind !== card.kind && first.pair === card.pair;
  const points = matchPoints(game.bigTimer, game.smallTimer, correct);
  game.score += points;
  game[correct ? "correct" : "wrong"]++;
  game.selected = null;
  game.smallDeadline = now + 10000;
  game.smallTimer = 10;
  if (correct) {
    first.matched = card.matched = true;
    if (game.cards.every((c) => c.matched)) nextMatchSet(game);
  }
  return { correct, points, vocabularyId: first.vocabularyId };
}
