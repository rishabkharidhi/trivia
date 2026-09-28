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

/* ---------- Board mode ---------- */
export const TIERS = {
  full:  [[200, 'easy'], [400, 'easy'], [800, 'medium'], [1600, 'hard'], [2000, 'hard']],
  quick: [[200, 'easy'], [800, 'medium'], [2000, 'hard']]
};
const DIFF_FALLBACK = { easy: ['easy', 'medium', 'hard'], medium: ['medium', 'easy', 'hard'], hard: ['hard', 'medium', 'easy'] };

// 5 categories x N values. Each cell holds a question id; the text is only sent when the tile is picked.
export function buildBoard(bank, size = 'full', rand = Math.random) {
  const tiers = TIERS[size] || TIERS.full;
  const byCat = {};
  for (const q of bank) if (!q.retired) (byCat[q.category] ||= []).push(q);
  const need = { easy: 0, medium: 0, hard: 0 };
  tiers.forEach(([, d]) => need[d]++);
  const cats = Object.keys(byCat).filter(c => byCat[c].length >= tiers.length);
  const exact = cats.filter(c => Object.keys(need).every(d => byCat[c].filter(q => q.difficulty === d).length >= need[d]));
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const shuffled = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let chosen = shuffled(exact).slice(0, 5), approx = false;
  if (chosen.length < 5) { approx = true; chosen = chosen.concat(shuffled(cats.filter(c => !chosen.includes(c))).slice(0, 5 - chosen.length)); }
  if (chosen.length < 5) return null;
  const used = new Set(), grid = tiers.map(() => []);
  chosen.forEach((cat, ci) => tiers.forEach(([value, diff], ri) => {
    let q = null;
    for (const d of DIFF_FALLBACK[diff]) {
      const pool = byCat[cat].filter(x => x.difficulty === d && !used.has(x.id));
      if (pool.length) { q = pick(pool); break; }
    }
    used.add(q.id);
    grid[ri][ci] = { value, qid: q.id, done: false, dd: false, r: ri, c: ci };
  }));
  const bottom = grid.slice(Math.floor(tiers.length / 2)).flat();
  shuffled(bottom).slice(0, size === 'quick' ? 1 : 2).forEach(t => t.dd = true);
  return { cats: chosen, grid, size, approx };
}

export function boardTilesLeft(board) { return board.grid.flat().filter(t => !t.done).length; }
export function boardTopValue(board) { return Math.max(...board.grid.flat().map(t => t.value)); }

// What players see: values and which tiles are gone, never the questions behind them.
export function publicBoard(board) {
  return { cats: board.cats, size: board.size, grid: board.grid.map(row => row.map(t => ({ value: t.value, done: t.done, dd: t.dd && t.done }))) };
}

export function nextTurn(order, current) {
  if (!order.length) return null;
  const i = order.indexOf(current);
  return order[(i + 1) % order.length];
}
