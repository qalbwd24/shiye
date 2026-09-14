// Shuffle once per browsing round. Keep hidden legacy entries out of recollections.
export function memoryDeck(entries, categories = [], random = Math.random) {
  const deck = entries
    .filter(
      (e) =>
        !e.deleted &&
        !e.draft &&
        !(e.hidden === undefined ? e.legacy?.isHidden : e.hidden) &&
        (!categories.length || categories.includes(e.category)),
    )
    .map((e) => e.id);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Recollection eligibility is rechecked against the live library at every render.
export function recollectionEntries(entries, options = {}, now = new Date()) {
  const day = (value) => {
    const d = new Date(value);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  };
  const start = options.start ? day(options.start + 'T12:00:00') : -Infinity;
  const end = options.end ? day(options.end + 'T12:00:00') : Infinity;
  const cutoff = day(now) - 7;
  const seen = new Set();
  return entries.filter((e) => {
    const date = day(e.date);
    if (
      !e.id ||
      seen.has(e.id) ||
      e.deleted ||
      e.draft ||
      (e.hidden === undefined ? e.legacy?.isHidden : e.hidden) ||
      (options.category && e.category !== options.category) ||
      !Number.isFinite(date) ||
      date < start ||
      date > end ||
      (options.excludeRecent && date > cutoff)
    )
      return false;
    seen.add(e.id);
    return true;
  });
}

export function shuffledRecollection(ids, previous = '', random = Math.random) {
  const deck = [...new Set(ids)];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  // Conditional uniform shuffle: if the first item repeats, swap with a random other item.
  if (deck.length > 1 && deck[0] === previous) {
    const j = 1 + Math.floor(random() * (deck.length - 1));
    [deck[0], deck[j]] = [deck[j], deck[0]];
  }
  return deck;
}

export function normalizeRecollectionSession(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  const ids = (value, limit) =>
    Array.isArray(value)
      ? value
          .filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)
          .slice(0, limit)
      : [];
  const deck = [...new Set(ids(raw.deck, 5000))];
  const history = ids(raw.history, 200);
  return {
    deck,
    index: Number.isInteger(raw.index) ? Math.max(-1, Math.min(raw.index, deck.length - 1)) : -1,
    round: Number.isInteger(raw.round) ? Math.max(1, Math.min(raw.round, 1000000)) : 1,
    history,
    cursor: Number.isInteger(raw.cursor)
      ? Math.max(-1, Math.min(raw.cursor, history.length - 1))
      : history.length - 1,
  };
}

export function reconcileRecollection(session, ids, random = Math.random) {
  const eligible = new Set(ids);
  const current = session.history[session.cursor];
  const visited = session.deck.slice(0, session.index + 1).filter((id) => eligible.has(id));
  const remaining = session.deck.slice(session.index + 1).filter((id) => eligible.has(id));
  const known = new Set([...visited, ...remaining]);
  const added = shuffledRecollection(
    ids.filter((id) => !known.has(id)),
    '',
    random,
  );
  session.deck = [...visited, ...remaining, ...added];
  session.index = visited.length - 1;
  const before = session.history.slice(0, session.cursor + 1).filter((id) => eligible.has(id));
  const after = session.history.slice(session.cursor + 1).filter((id) => eligible.has(id));
  session.history = [...before, ...after].slice(-200);
  session.cursor = Math.max(-1, before.length - 1);
  if (current && eligible.has(current))
    session.cursor = Math.min(session.cursor, session.history.length - 1);
  if (!eligible.size) {
    session.history = [];
    session.cursor = -1;
  }
  return session;
}

export function advanceRecollection(session, ids, strategy = 'round', random = Math.random) {
  reconcileRecollection(session, ids, random);
  if (!ids.length) return '';
  if (session.cursor < session.history.length - 1) return session.history[++session.cursor];
  const previous = session.history[session.cursor] || '';
  let id;
  if (strategy === 'random') {
    const pool = ids.length > 1 ? ids.filter((value) => value !== previous) : ids;
    id = pool[Math.floor(random() * pool.length)];
  } else {
    if (session.index >= session.deck.length - 1) {
      session.deck = shuffledRecollection(ids, previous, random);
      session.index = -1;
      session.round++;
    }
    id = session.deck[++session.index];
  }
  session.history.push(id);
  session.history = session.history.slice(-200);
  session.cursor = session.history.length - 1;
  return id;
}

export function restartRecollection(session, ids, random = Math.random) {
  const previous = session.history[session.cursor] || '';
  session.deck = shuffledRecollection(ids, previous, random);
  session.index = -1;
  session.history = [];
  session.cursor = -1;
  session.round++;
  return session;
}
