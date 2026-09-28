class FakeResponse { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.webSocket = init.webSocket; } }
globalThis.Response = FakeResponse;
globalThis.WebSocketPair = class { constructor() { const mk = () => ({ sent: [], att: null, closed: false, send(s) { this.sent.push(JSON.parse(s)); }, close() { this.closed = true; }, serializeAttachment(a) { this.att = a; }, deserializeAttachment() { return this.att; } }); this[0] = mk(); this[1] = mk(); } };
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => Math.random().toString(36).slice(2) } });
globalThis.fetch = async () => ({ ok: true, json: async () => ({ questions: [
  { id: 'q1', category: 'Geography', difficulty: 'easy', type: 'multiple', question: 'Capital of France?', correct: 'Paris', incorrect: ['a','b','c'] }] }) });
const { Room } = await import('./src/index.js');

const store = new Map(); let alarmAt = null; let sockets = [];
const ctx = { blockConcurrencyWhile: async fn => fn(), acceptWebSocket: ws => sockets.push(ws),
  getWebSockets: () => sockets.filter(w => !w.closed),
  storage: { get: async k => store.get(k), put: async (k, v) => store.set(k, JSON.parse(JSON.stringify(v))),
             deleteAll: async () => { store.clear(); alarmAt = null; }, setAlarm: async at => { alarmAt = at; } } };
const room = new Room(ctx, {});
await new Promise(r => setTimeout(r, 0));
const join = async (name, pid) => { await room.fetch({ headers: { get: h => h === 'Upgrade' ? 'websocket' : null }, url: `https://x/r/AB/ws?name=${name}&role=player&pid=${pid}` }); return sockets[sockets.length - 1]; };

const A = await join('Rishab', 'A');
await room.webSocketMessage(A, JSON.stringify({ t: 'start', settings: { rounds: 2 } }));
console.log('game running, scores kept:', Object.keys(room.state.players).length, '| cleanup scheduled:', !!room.state.cleanupAt);
console.log('alarm is the nearer of question timer and cleanup:', alarmAt === room.state.timer.at);

// everyone leaves -> short grace, then the room is wiped
A.closed = true;
await room.webSocketClose(A);
const grace = room.state.cleanupAt - Date.now();
console.log('after last player leaves, wipe in ~minutes:', Math.round(grace / 60000));
room.state.cleanupAt = Date.now() - 1;            // pretend the grace elapsed
await room.alarm();
console.log('room wiped:', store.size === 0, '| state reset:', room.state.phase === 'lobby' && Object.keys(room.state.players).length === 0);

// a recycled code does not resurrect an old game
const B = await join('Snow', 'B');
await room.webSocketMessage(B, JSON.stringify({ t: 'start', settings: { rounds: 2 } }));
room.state.players.B.score = 900;
await room.save();
room.state.lastSeen = Date.now() - 3 * 60 * 60 * 1000;   // last activity three hours ago
sockets.forEach(w => w.closed = true);
const C = await join('Alex', 'C');
console.log('stale room reused:', Object.keys(room.state.players), '| old score gone:', !room.state.players.B, '| fresh phase:', room.state.phase);

// an active room keeps extending its life
await room.webSocketMessage(C, JSON.stringify({ t: 'ping', c: 1 }));
const hours = (room.state.cleanupAt - Date.now()) / 3600000;
console.log('while someone is connected, expiry pushed out ~hours:', hours.toFixed(1));
