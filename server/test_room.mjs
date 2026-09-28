// Harness: stub the Cloudflare runtime so the Room can be exercised in Node.
class FakeResponse { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.webSocket = init.webSocket; } }
globalThis.Response = FakeResponse;
globalThis.WebSocketPair = class { constructor() { const mk = () => ({ sent: [], att: null, send(s) { this.sent.push(JSON.parse(s)); }, serializeAttachment(a) { this.att = a; }, deserializeAttachment() { return this.att; } }); this[0] = mk(); this[1] = mk(); } };
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => Math.random().toString(36).slice(2) } });

const BANK = [
  { id: 'q1', category: 'Geography', difficulty: 'easy', type: 'multiple', question: 'Capital of France?', correct: 'Paris', incorrect: ['Lyon', 'Nice', 'Metz'], explain: 'Paris is the capital.', explainSource: { title: 'Paris', url: 'https://en.wikipedia.org/wiki/Paris' } },
  { id: 'q2', category: 'Science & Nature', difficulty: 'hard', type: 'multiple', question: 'Hardest mineral?', correct: 'Diamond', incorrect: ['Quartz', 'Topaz', 'Talc'] },
  { id: 'q3', category: 'History', difficulty: 'medium', type: 'boolean', question: 'Rome fell in 476.', correct: 'True', incorrect: ['False'] },
  { id: 'q4', category: 'Sports', difficulty: 'easy', type: 'multiple', question: 'Players per soccer side?', correct: '11', incorrect: ['9', '10', '12'] },
];
globalThis.fetch = async () => ({ ok: true, json: async () => ({ questions: BANK }) });

const { Room } = await import('./src/index.js');
const store = new Map(); let alarmAt = null;
const sockets = [];
const ctx = {
  blockConcurrencyWhile: async fn => fn(),
  acceptWebSocket: ws => sockets.push(ws),
  getWebSockets: () => sockets,
  storage: { get: async k => store.get(k), put: async (k, v) => store.set(k, JSON.parse(JSON.stringify(v))), setAlarm: async at => { alarmAt = at; } }
};
const room = new Room(ctx, { QUESTIONS_URL: 'x' });
await new Promise(r => setTimeout(r, 0));

const join = async (name, role, pid) => {
  const req = { headers: { get: h => h === 'Upgrade' ? 'websocket' : null }, url: `https://x/r/ABCD/ws?name=${name}&role=${role}&pid=${pid}` };
  const res = await room.fetch(req);
  return sockets[sockets.length - 1];
};
const last = (ws, t) => [...ws.sent].reverse().find(m => m.t === t);
const fire = async () => { await room.alarm(); };

const host = await join('Screen', 'screen', 'H');
const a = await join('Rishab', 'player', 'A');
const b = await join('Snow', 'player', 'B');
const c = await join('Alex', 'player', 'C');
console.log('joined:', last(host, 'players')?.players.map(p => p.name).join(','), '| screen controls:', last(host, 'welcome')?.controller, '(expect false)');
console.log('controller is first player:', last(a, 'welcome')?.controller, '| screen role:', last(host, 'welcome')?.role);
// a screen cannot start the game
await room.webSocketMessage(host, JSON.stringify({ t: 'start', settings: { rounds: 3 } }));
console.log('screen start ignored:', room.state.phase === 'lobby', '| phase:', room.state.phase, '| controller:', room.state.controllerId);

await room.webSocketMessage(a, JSON.stringify({ t: 'start', settings: { rounds: 3, timer: 20000, autoNext: false } }));
let q = last(a, 'question');
console.log('Q1:', q.question.text, '| options:', q.question.options.length, '| reveal lead ms:', q.shownAt - q.now, '| round', q.round, 'of', q.rounds);

// Snow presses first by her own clock but her message arrives later than Rishab's
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shown = q.shownAt;
await sleep(1700);
await room.webSocketMessage(a, JSON.stringify({ t: 'buzz', at: shown + 1500 }));
await room.webSocketMessage(b, JSON.stringify({ t: 'buzz', at: shown + 900 }));
await fire();  // grace window closes
const locked = last(a, 'locked');
console.log('locked in:', locked.name, '(expect Snow: earlier press wins despite arriving second)');

// Snow answers wrong -> penalty, question reopens for the others
const correctIdx = room.state.question.correctIdx;
await room.webSocketMessage(b, JSON.stringify({ t: 'answer', idx: (correctIdx + 1) % room.state.question.options.length }));
console.log('wrong:', last(a, 'wrong').name, last(a, 'wrong').delta, '| reopened to:', last(a, 'reopen') ? 'yes' : 'no', '| tried:', last(a, 'reopen').tried.length);
console.log('Snow cannot buzz again:', await (async () => { await room.webSocketMessage(b, JSON.stringify({ t: 'buzz', at: Date.now() })); return room.state.buzzes.length === 0; })());

// Rishab buzzes and answers correctly
await room.webSocketMessage(a, JSON.stringify({ t: 'buzz', at: Date.now() }));
await fire();
await room.webSocketMessage(a, JSON.stringify({ t: 'answer', idx: room.state.question.correctIdx }));
const rev = last(a, 'reveal');
console.log('reveal:', rev.correct, '| winner:', rev.winner.name, '+' + rev.winner.delta, '| explain:', !!rev.explain, '| source:', rev.source?.title);
console.log('scores:', rev.scores.map(s => `${s.name}:${s.score}`).join(' '));

// nobody buzzes -> timeout reveals the answer
await room.webSocketMessage(a, JSON.stringify({ t: 'next' }));
await fire();
console.log('timeout reveal winner:', last(a, 'reveal').winner, '(expect null)');

// everyone misses -> question closes
await room.webSocketMessage(a, JSON.stringify({ t: 'next' }));
for (const [ws, pid] of [[a, 'A'], [b, 'B'], [c, 'C']]) {
  await room.webSocketMessage(ws, JSON.stringify({ t: 'buzz', at: Date.now() }));
  await fire();
  const bad = (room.state.question.correctIdx + 1) % room.state.question.options.length;
  await room.webSocketMessage(ws, JSON.stringify({ t: 'answer', idx: bad }));
}
console.log('after all missed, phase:', room.state.phase, '| round', room.state.round, 'of', room.state.settings.rounds);
await room.webSocketMessage(a, JSON.stringify({ t: 'next' }));
console.log('game over broadcast:', !!last(a, 'over'), '| final:', last(a, 'over')?.scores.map(s => `${s.name}:${s.score}`).join(' '));

// clock sync + reconnect
await room.webSocketMessage(a, JSON.stringify({ t: 'ping', c: 12345 }));
const pong = last(a, 'pong');
console.log('pong echoes client stamp:', pong.c === 12345, '| carries server time:', typeof pong.s === 'number');
await room.webSocketClose(a);
console.log('after disconnect, marked offline:', room.state.players.A.connected === false, '| score kept:', room.state.players.A.score);
const a2 = await join('Rishab', 'player', 'A');
console.log('rejoined with same pid, score restored:', last(a2, 'welcome').state.players.find(p => p.name === 'Rishab').score);

// controller leaves -> controls pass to another connected player
await room.webSocketClose(a);
console.log('controller after A leaves:', room.state.players[room.state.controllerId]?.name, '(expect Snow or Alex)');
