class FakeResponse { constructor(b, i = {}) { this.body = b; this.status = i.status || 200; this.webSocket = i.webSocket; } }
globalThis.Response = FakeResponse;
globalThis.WebSocketPair = class { constructor() { const mk = () => ({ sent: [], att: null, send(s) { this.sent.push(JSON.parse(s)); }, close() { this.closed = true; }, serializeAttachment(a) { this.att = a; }, deserializeAttachment() { return this.att; } }); this[0] = mk(); this[1] = mk(); } };
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => Math.random().toString(36).slice(2) } });
const BANK = [];
['Geography','History','Sports','Animals','Science & Nature'].forEach(c =>
  ['easy','easy','easy','easy','medium','medium','medium','medium','hard','hard','hard','hard'].forEach((d, i) =>
    BANK.push({ id: `${c}-${i}`, category: c, difficulty: d, type: 'multiple', question: `${c} q${i}?`, correct: `right-${c}${i}`, incorrect: ['w1','w2','w3'] })));
globalThis.fetch = async () => ({ ok: true, json: async () => ({ questions: BANK }) });
const { Room } = await import('./src/index.js');
const store = new Map(); const sockets = [];
const ctx = { blockConcurrencyWhile: async fn => fn(), acceptWebSocket: ws => sockets.push(ws), getWebSockets: () => sockets,
  storage: { get: async k => store.get(k), put: async (k, v) => store.set(k, JSON.parse(JSON.stringify(v))), deleteAll: async () => store.clear(), setAlarm: async () => {} } };
const room = new Room(ctx, {});
await new Promise(r => setTimeout(r, 0));
const join = async (n, pid) => { await room.fetch({ headers: { get: h => h === 'Upgrade' ? 'websocket' : null }, url: `https://x/r/AB/ws?name=${n}&role=player&pid=${pid}` }); return sockets[sockets.length - 1]; };
const last = (ws, t) => [...ws.sent].reverse().find(m => m.t === t);
const A = await join('Rishab', 'A'), B = await join('Snow', 'B'), C = await join('Alex', 'C');
const wsOf = { A, B, C };
const correct = () => room.state.question.correctIdx;
const wrong = () => (correct() + 1) % room.state.question.options.length;

await room.webSocketMessage(A, JSON.stringify({ t: 'start', settings: { mode: 'survival', lives: 2, answerMs: 7000, autoNext: false } }));
let sv = last(A, 'survival');
console.log('round 1:', sv.category, sv.difficulty, '| first turn:', sv.turnName, '| lives:', sv.scores.map(s => `${s.name}:${s.lives}`).join(' '));
const q1 = last(A, 'question');
console.log('question locked to the player whose turn it is:', last(A, 'locked').name, '| mode tag:', q1.mode);

// everyone answers their own question in the same category
const cats = new Set([q1.question.category]);
await room.webSocketMessage(wsOf[room.state.turn], JSON.stringify({ t: 'answer', idx: correct() }));
console.log('correct answer scores:', last(A, 'reveal').scores.map(s => `${s.name}:${s.score}`).join(' '));
await room.webSocketMessage(A, JSON.stringify({ t: 'next' }));
cats.add(last(A, 'question').question.category);
await room.webSocketMessage(wsOf[room.state.turn], JSON.stringify({ t: 'answer', idx: wrong() }));
let rev = last(A, 'reveal');
console.log('wrong answer costs a life:', rev.scores.map(s => `${s.name}:${s.lives}`).join(' '), '| lifeLost flag:', rev.lifeLost);
await room.webSocketMessage(A, JSON.stringify({ t: 'next' }));
cats.add(last(A, 'question').question.category);
await room.webSocketMessage(wsOf[room.state.turn], JSON.stringify({ t: 'answer', idx: wrong() }));
console.log('all three questions in one category:', cats.size === 1, [...cats]);

// round 2 should be a different category and eventually harder
await room.webSocketMessage(A, JSON.stringify({ t: 'next' }));
const sv2 = last(A, 'survival');
console.log('round 2:', sv2.category, sv2.difficulty, '| different category:', sv2.category !== sv.category);

// keep missing until someone is eliminated
let guard = 0;
while (!last(A, 'reveal')?.eliminated && guard++ < 20) {
  const who = room.state.turn;
  if (room.state.phase !== 'locked') await room.webSocketMessage(A, JSON.stringify({ t: 'next' }));
  if (room.state.phase !== 'locked') break;
  await room.webSocketMessage(wsOf[who], JSON.stringify({ t: 'answer', idx: wrong() }));
}
const el = last(A, 'reveal').eliminated;
console.log('elimination fires:', el ? el.name + ' is out' : 'none', '| out flag set:', last(A, 'reveal').scores.find(s => s.id === el?.id)?.out);

// run it down to a winner
guard = 0;
while (!last(A, 'over') && guard++ < 60) {
  if (room.state.phase !== 'locked') await room.webSocketMessage(A, JSON.stringify({ t: 'next' }));
  if (room.state.phase !== 'locked') break;
  await room.webSocketMessage(wsOf[room.state.turn], JSON.stringify({ t: 'answer', idx: wrong() }));
}
const over = last(A, 'over');
console.log('game over:', !!over, '| standings:', over?.scores.map(s => `${s.name}${s.out ? ' (out)' : ' SURVIVOR'}`).join(', '));
