// Pure game rules for online Buzz-In. No Cloudflare APIs here, so this file is unit-testable.
export const POINTS = { easy: 100, medium: 200, hard: 300 };
export const SPEED_BONUS = 50;        // max extra points for a fast correct answer
export const BUZZ_GRACE_MS = 120;     // collect near-simultaneous buzzes before ranking
export const ANSWER_MS = 7000;        // a locked-in player's time to answer
export const REVEAL_LEAD_MS = 700;    // schedule the question slightly ahead so all screens light up together

export function normalizeBuzz(buzz, now) {
  // Clients send room-time already (local clock + measured offset). Clamp nonsense values:
  // a press can't be in the future, and can't predate the question being shown.
  const at = Number(buzz.at);
  if (!Number.isFinite(at)) return now;
  return Math.min(Math.max(at, buzz.shownAt ?? at), now);
}

// Earliest press wins; ties break on who reached the server first.
export function rankBuzzes(buzzes) {
  return [...buzzes].sort((a, b) => a.at - b.at || a.seq - b.seq);
}

export function speedBonus(msSinceShown, windowMs) {
  if (!windowMs || msSinceShown < 0) return 0;
  const frac = Math.max(0, 1 - msSinceShown / windowMs);
  return Math.round(SPEED_BONUS * frac);
}

export function awardPoints(difficulty, msSinceShown, windowMs) {
  return (POINTS[difficulty] || 100) + speedBonus(msSinceShown, windowMs);
}

// A wrong buzz costs the question's base value and opens it to everyone who hasn't tried.
export function penalty(difficulty) {
  return POINTS[difficulty] || 100;
}

export function remainingContenders(players, tried) {
  return Object.keys(players).filter(id => players[id].connected && !tried.includes(id));
}

export function pickQuestion(bank, usedIds, filters = {}, rand = Math.random) {
  const pool = bank.filter(q =>
    !q.retired && !usedIds.has(q.id) &&
    (!filters.category || filters.category === 'all' || q.category === filters.category) &&
    (!filters.difficulty || filters.difficulty === 'any' || q.difficulty === filters.difficulty));
  if (!pool.length) return null;
  // Spread categories: prefer ones used least this game, never the same twice running.
  const byCat = {};
  for (const q of pool) (byCat[q.category] ||= []).push(q);
  let cats = Object.keys(byCat);
  if (cats.length > 1 && filters.lastCategory) {
    const others = cats.filter(c => c !== filters.lastCategory);
    if (others.length) cats = others;
  }
  const counts = filters.categoryCounts || {};
  const min = Math.min(...cats.map(c => counts[c] || 0));
  cats = cats.filter(c => (counts[c] || 0) === min);
  const cat = cats[Math.floor(rand() * cats.length)];
  const list = byCat[cat];
  return list[Math.floor(rand() * list.length)];
}

export function shuffleOptions(q, rand = Math.random) {
  if (q.type === 'boolean') return ['True', 'False'];
  const opts = [q.correct, ...q.incorrect];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}

export function scoreboard(players) {
  return Object.entries(players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score, connected: p.connected }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
