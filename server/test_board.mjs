class FakeResponse { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.webSocket = init.webSocket; } }
globalThis.Response = FakeResponse;
globalThis.WebSocketPair = class { constructor() { const mk = () => ({ sent: [], att: null, send(s) { this.sent.push(JSON.parse(s)); }, serializeAttachment(a) { this.att = a; }, deserializeAttachment() { return this.att; } }); this[0] = mk(); this[1] = mk(); } };
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => Math.random().toString(36).slice(2) } });
const cats = ['Geography', 'History', 'Sports', 'Animals', 'Science & Nature'];
const BANK = [];
cats.forEach(c => ['easy','easy','easy','medium','medium','hard','hard','hard'].forEach((d, i) =>
  BANK.push({ id: `${c}-${i}`, category: c, difficulty: d, type: 'multiple', question: `${c} question ${i}?`, correct: `right-${c}${i}`, incorrect: ['w1','w2','w3'] })));
globalThis.fetch = async () => ({ ok: true, json: async () => ({ questions: BANK }) });
const { Room } = await import('./src/index.js');
const store = new Map(); const sockets = [];
const ctx = { blockConcurrencyWhile: async fn => fn(), acceptWebSocket: ws => sockets.push(ws), getWebSockets: () => sockets,
  storage: { get: async k => store.get(k), put: async (k, v) => store.set(k, JSON.parse(JSON.stringify(v))), setAlarm: async () => {} } };
const room = new Room(ctx, {});
await new Promise(r => setTimeout(r, 0));
const join = async (name, role, pid) => { await room.fetch({ headers: { get: h => h === 'Upgrade' ? 'websocket' : null }, url: `https://x/r/AB/ws?name=${name}&role=${role}&pid=${pid}` }); return sockets[sockets.length - 1]; };
const last = (ws, t) => [...ws.sent].reverse().find(m => m.t === t);
const A = await join('Rishab', 'player', 'A'), B = await join('Snow', 'player', 'B'), C = await join('Alex', 'player', 'C');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const correctIdx = () => room.state.question.correctIdx;
const wrongIdx = () => (correctIdx() + 1) % room.state.question.options.length;

await room.webSocketMessage(A, JSON.stringify({ t: 'start', settings: { mode: 'board', boardSize: 'quick', answerMs: 7000, autoNext: false } }));
let b = last(A, 'board');
console.log('board built:', b.board.cats.length, 'categories x', b.board.grid.length, 'rows | values:', b.board.grid.map(r => r[0].value).join(','));
console.log('first turn:', b.turnName, '| questions hidden from players:', !JSON.stringify(b.board).includes('question'));

// wrong pick attempt by a player whose turn it isn't
await room.webSocketMessage(B, JSON.stringify({ t: 'pick', r: 0, c: 0 }));
console.log('out-of-turn pick ignored:', room.state.phase === 'board');

// Rishab picks a normal tile, answers correctly
const normal = room.state.board.grid.flat().find(t => !t.dd);
await room.webSocketMessage(A, JSON.stringify({ t: 'pick', r: normal.r, c: normal.c }));
let q = last(A, 'question');
console.log('tile served:', q.question.text.slice(0, 28), '| worth', q.value, '| owner', q.ownerName, '| locked to owner:', last(A, 'locked').name);
await room.webSocketMessage(A, JSON.stringify({ t: 'answer', idx: correctIdx() }));
console.log('correct pick:', last(A, 'reveal').winner.name, '+' + last(A, 'reveal').winner.delta, '| scores:', last(A, 'reveal').scores.map(s => s.name + ':' + s.score).join(' '));

// next turn passes to Snow; she misses, Alex steals
await room.webSocketMessage(A, JSON.stringify({ t: 'next' }));
console.log('turn rotated to:', last(A, 'board').turnName);
const t2 = room.state.board.grid.flat().find(t => !t.done && !t.dd);
await room.webSocketMessage(B, JSON.stringify({ t: 'pick', r: t2.r, c: t2.c }));
await room.webSocketMessage(B, JSON.stringify({ t: 'answer', idx: wrongIdx() }));
console.log('picker wrong:', last(A, 'wrong').name, last(A, 'wrong').delta, '| stealing opens:', !!last(A, 'reopen'), '| picker excluded:', !last(A, 'reopen').tried.includes('B') === false);
await sleep(20);
await room.webSocketMessage(C, JSON.stringify({ t: 'buzz', at: Date.now() }));
await room.lockWinner();
console.log('steal locked to:', last(A, 'locked').name);
await room.webSocketMessage(C, JSON.stringify({ t: 'answer', idx: correctIdx() }));
console.log('steal result:', last(A, 'reveal').winner.name, '+' + last(A, 'reveal').winner.delta, '| scores:', last(A, 'reveal').scores.map(s => s.name + ':' + s.score).join(' '));

// Double Down: only the picker plays it, wager is capped
await room.webSocketMessage(A, JSON.stringify({ t: 'next' }));
const turnPid = room.state.turn;
const dd = room.state.board.grid.flat().find(t => t.dd && !t.done);
const ws = { A, B, C }[turnPid];
await room.webSocketMessage(ws, JSON.stringify({ t: 'pick', r: dd.r, c: dd.c }));
const w = last(A, 'wager');
console.log('double down found by:', w.name, '| max wager:', w.max);
await room.webSocketMessage(ws, JSON.stringify({ t: 'wager', amount: 999999 }));
console.log('wager clamped to:', last(A, 'wagered').amount, '| question value:', last(A, 'question').value, '| flagged as DD:', last(A, 'question').dd);
await room.webSocketMessage(ws, JSON.stringify({ t: 'answer', idx: wrongIdx() }));
console.log('DD wrong -> no steal offered:', !last(A, 'reopen') || last(A, 'reveal').winner === null, '| revealed:', !!last(A, 'reveal'));
console.log('scores after DD:', last(A, 'reveal').scores.map(s => s.name + ':' + s.score).join(' '));

// clear the rest of the board and confirm the game ends
let guard = 0;
while (room.state.board.grid.flat().some(t => !t.done) && guard++ < 40) {
  await room.webSocketMessage(A, JSON.stringify({ t: 'next' }));
  const tile = room.state.board.grid.flat().find(t => !t.done);
  const who = { A, B, C }[room.state.turn];
  await room.webSocketMessage(who, JSON.stringify({ t: 'pick', r: tile.r, c: tile.c }));
  if (room.state.wagering) await room.webSocketMessage(who, JSON.stringify({ t: 'wager', amount: 200 }));
  await room.webSocketMessage(who, JSON.stringify({ t: 'answer', idx: correctIdx() }));
}
await room.webSocketMessage(A, JSON.stringify({ t: 'next' }));
console.log('board cleared ->', last(A, 'over') ? 'game over broadcast' : 'still running', '| final:', last(A, 'over')?.scores.map(s => s.name + ':' + s.score).join(' '));
