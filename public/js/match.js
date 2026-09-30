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
    queues: { zh: [], ko: [] },
    pending: [],
    serial: 0,
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
  };
  if (!game.ended) initializeBoard(game);
  return game;
}

function compatible(a, b) {
  return (
    a === b ||
    (a.simplified.trim() !== b.simplified.trim() &&
      a.meaning.trim() !== b.meaning.trim())
  );
}

function makeCard(game, word, kind) {
  return {
    id: String(++game.serial),
    pair: game.pool.indexOf(word),
    kind,
    text: kind === "zh" ? word.simplified : word.meaning,
    vocabularyId: word.id,
    matched: false,
  };
}

function initializeBoard(game) {
  const chosen = [];
  // Seven unambiguous words allow four cards per column with one shared pair.
  for (const word of shuffle(game.pool, game.rng)) {
    if (chosen.every((other) => compatible(word, other))) chosen.push(word);
    if (chosen.length === 7) break;
  }
  const left = chosen.slice(0, 4);
  const right = [left[0], ...chosen.slice(4)];
  // Small pools necessarily share more words across the two columns.
  for (const word of shuffle(left.slice(1), game.rng)) {
    if (right.length === left.length) break;
    right.push(word);
  }
  const columns = { zh: shuffle(left, game.rng), ko: shuffle(right, game.rng) };
  game.cards = columns.zh.flatMap((word, i) => [
    makeCard(game, word, "zh"),
    makeCard(game, columns.ko[i], "ko"),
  ]);
  for (const kind of ["zh", "ko"])
    game.queues[kind] = shuffle(
      game.pool.filter((word) => !columns[kind].includes(word)),
      game.rng,
    );
}

// Cancel pending work both at the deadline and when leaving the screen.
export function endMatch(game) {
  game.ended = true;
  game.selected = null;
  game.pending = [];
}

function replenish(game, pending) {
  const remaining = game.cards.filter((card) => !pending.ids.includes(card.id));
  const candidates = (kind) => {
    if (!game.queues[kind].length)
      game.queues[kind] = shuffle(game.pool, game.rng);
    const queue = game.queues[kind];
    // Blocked, unplayed entries remain queued. Reuse is permitted only as fallback.
    return [...queue, ...game.pool.filter((word) => !queue.includes(word))]
      .filter((word) =>
        remaining.every(
          (card) =>
            (card.kind !== kind || card.pair !== game.pool.indexOf(word)) &&
            compatible(word, game.pool[card.pair]),
        ),
      )
      .map((word) => ({
        word,
        pair: game.pool.indexOf(word),
        cost:
          (queue.includes(word) ? 0 : game.pool.length * 2) +
          (game.pool.indexOf(word) === pending.pair ? game.pool.length : 0) +
          Math.max(0, queue.indexOf(word)),
      }));
  };
  const left = candidates("zh"),
    right = candidates("ko");
  const active = remaining.filter((card) => !card.matched);
  const zh = new Set(
    active.filter((card) => card.kind === "zh").map((card) => card.pair),
  );
  const ko = new Set(
    active.filter((card) => card.kind === "ko").map((card) => card.pair),
  );
  const alreadyPlayable = [...zh].some((id) => ko.has(id));
  let best;
  for (const a of left)
    for (const b of right) {
      if (!compatible(a.word, b.word)) continue;
      if (
        !alreadyPlayable &&
        a.pair !== b.pair &&
        !ko.has(a.pair) &&
        !zh.has(b.pair)
      )
        continue;
      // Prefer linking new cards to cards already on the board. Queue priority
      // alone can repeatedly select a fresh self-contained pair when it is the
      // only match, leaving the other six cards stranded indefinitely.
      const samePair = a.pair === b.pair;
      if (
        !best ||
        Number(samePair) < Number(best.samePair) ||
        (samePair === best.samePair && a.cost + b.cost < best.cost)
      )
        best = { zh: a.word, ko: b.word, cost: a.cost + b.cost, samePair };
    }
  // The removed pair is always a legal fallback, even if every other pair is pending.
  for (const id of pending.ids) {
    const slot = game.cards.findIndex((card) => card.id === id);
    const kind = game.cards[slot].kind;
    const word = best[kind];
    game.cards[slot] = makeCard(game, word, kind);
    game.queues[kind] = game.queues[kind].filter((entry) => entry !== word);
  }
}

export function tickMatch(game, now) {
  if (game.ended) return;
  game.bigTimer = Math.max(0, (game.deadline - now) / 1000);
  if (game.bigTimer === 0) {
    endMatch(game);
    game.smallTimer = Math.max(0, (game.smallDeadline - now) / 1000);
    return;
  }
  if (now >= game.smallDeadline) {
    // Preserve 10-second cycles even when a background tab skips render ticks.
    game.smallDeadline +=
      (Math.floor((now - game.smallDeadline) / 10000) + 1) * 10000;
  }
  game.smallTimer = (game.smallDeadline - now) / 1000;
  while (game.pending.length && game.pending[0].due <= now) {
    replenish(game, game.pending.shift());
  }
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
  if (first.kind === card.kind) {
    // Same column: move the selection instead of grading it as wrong.
    game.selected = id;
    return null;
  }
  const correct = first.pair === card.pair;
  const points = matchPoints(game.bigTimer, game.smallTimer, correct);
  game.score += points;
  game[correct ? "correct" : "wrong"]++;
  game.selected = null;
  game.smallDeadline = now + 10000;
  game.smallTimer = 10;
  if (correct) {
    first.matched = card.matched = true;
    game.pending.push({
      ids: [first.id, card.id],
      pair: first.pair,
      due: now + 250,
    });
  }
  return { correct, points, vocabularyId: first.vocabularyId };
}
