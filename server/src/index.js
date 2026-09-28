// Snow's Push to Think Trivia: online rooms.
// One Durable Object per room holds the authoritative state and talks WebSockets to every device.
import {
  BUZZ_GRACE_MS, ANSWER_MS, REVEAL_LEAD_MS,
  normalizeBuzz, rankBuzzes, awardPoints, penalty, remainingContenders,
  pickQuestion, shuffleOptions, scoreboard
} from './rules.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname === '/new') return json({ code: newCode() });
    const m = url.pathname.match(/^\/r\/([A-Za-z0-9]{3,8})\/ws$/);
    if (m) {
      const id = env.ROOM.idFromName(m[1].toUpperCase());
      return env.ROOM.get(id).fetch(request);
    }
    return new Response('Not found', { status: 404 });
  }
};

const BLANK = () => ({
  phase: 'lobby',            // lobby | question | locked | reveal | over
  players: {},               // pid -> { name, score, connected }
  controllerId: null,        // the player who presses Start/Next; screens never control
  round: 0,
  settings: { rounds: 10, category: 'all', difficulty: 'any', timer: 20000, autoNext: true },
  question: null,            // { id, text, options, correctIdx, category, difficulty, explain, source }
  shownAt: 0, deadline: 0,
  buzzes: [], tried: [], lockedId: null, buzzSeq: 0,
  usedIds: [], catCounts: {}, lastCategory: null,
  lastReveal: null
});

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.bank = null;
    this.ctx.blockConcurrencyWhile(async () => {
      this.state = (await this.ctx.storage.get('state')) || BLANK();
    });
  }

  async save() { await this.ctx.storage.put('state', this.state); }

  async bankOrFetch() {
    if (this.bank) return this.bank;
    const url = this.env.QUESTIONS_URL || 'https://rishabkharidhi.com/trivia/questions.json';
    const r = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!r.ok) throw new Error(`questions.json returned ${r.status}`);
    const d = await r.json();
    this.bank = (Array.isArray(d) ? d : d.questions || []).filter(q => !q.retired);
    return this.bank;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 400);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const pid = url.searchParams.get('pid') || crypto.randomUUID().slice(0, 8);
    // 'screen' is a view-only display for streaming; everyone else is a player.
    const role = ['screen', 'host'].includes(url.searchParams.get('role')) ? 'screen' : 'player';
    const name = (url.searchParams.get('name') || 'Player').slice(0, 16);
    this.ctx.acceptWebSocket(server);            // hibernation-friendly: no process pinned while idle
    server.serializeAttachment({ pid, role });

    if (role === 'player') {
      const p = this.state.players[pid] || { name, score: 0, connected: true };
      p.name = name; p.connected = true;
      this.state.players[pid] = p;
      const c = this.state.controllerId;
      if (!c || !this.state.players[c]?.connected) this.state.controllerId = pid;   // first player in takes the controls
    }
    await this.save();

    this.send(server, { t: 'welcome', pid, role, controller: this.state.controllerId === pid, now: Date.now(), state: this.publicState() });
    this.broadcast({ t: 'players', players: scoreboard(this.state.players), controllerId: this.state.controllerId }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  publicState() {
    const s = this.state;
    return {
      phase: s.phase, round: s.round, settings: s.settings,
      players: scoreboard(s.players), controllerId: s.controllerId,
      question: s.question ? { text: s.question.text, options: s.question.options, category: s.question.category, difficulty: s.question.difficulty, id: s.question.id } : null,
      shownAt: s.shownAt, deadline: s.deadline, lockedId: s.lockedId, tried: s.tried,
      lastReveal: s.lastReveal
    };
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  broadcast(obj, except) {
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) this.send(ws, obj);
  }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment() || {};
    const pid = att.pid;
    const isController = pid === this.state.controllerId;

    if (m.t === 'ping') return this.send(ws, { t: 'pong', c: m.c, s: Date.now() });   // clock sync
    if (m.t === 'hello') { this.send(ws, { t: 'state', state: this.publicState(), now: Date.now() }); return; }

    if (m.t === 'start' && isController) {
      this.state.settings = { ...this.state.settings, ...(m.settings || {}) };
      Object.values(this.state.players).forEach(p => { p.score = 0; });
      this.state.round = 0; this.state.usedIds = []; this.state.catCounts = {}; this.state.lastCategory = null;
      await this.nextQuestion();
      return;
    }
    if (m.t === 'next' && isController) { await this.nextQuestion(); return; }
    if (m.t === 'end' && isController) { this.state.phase = 'over'; await this.save(); this.broadcast({ t: 'over', scores: scoreboard(this.state.players) }); return; }

    if (m.t === 'buzz') {
      const s = this.state;
      if (s.phase !== 'question' || s.tried.includes(pid) || !s.players[pid]) return;
      if (s.buzzes.some(b => b.id === pid)) return;
      const at = normalizeBuzz({ at: m.at, shownAt: s.shownAt }, Date.now());
      s.buzzes.push({ id: pid, at, seq: ++s.buzzSeq });
      this.broadcast({ t: 'buzzing', id: pid, name: s.players[pid].name });
      if (s.buzzes.length === 1) await this.setTimer('grace', Date.now() + BUZZ_GRACE_MS);
      await this.save();
      return;
    }

    if (m.t === 'answer') {
      const s = this.state;
      if (s.phase !== 'locked' || pid !== s.lockedId) return;
      await this.resolveAnswer(pid, Number(m.idx));
      return;
    }
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment() || {};
    const p = this.state.players[att.pid];
    if (p) p.connected = false;
    if (att.pid === this.state.controllerId) {          // hand the controls to whoever is still here
      const next = Object.keys(this.state.players).find(id => this.state.players[id].connected);
      this.state.controllerId = next || null;
    }
    await this.save();
    this.broadcast({ t: 'players', players: scoreboard(this.state.players), controllerId: this.state.controllerId });
  }

  async setTimer(kind, at) {
    this.state.timer = { kind, at };
    await this.save();
    await this.ctx.storage.setAlarm(at);
  }

  async alarm() {
    const t = this.state.timer;
    if (!t) return;
    this.state.timer = null;
    if (t.kind === 'grace') return this.lockWinner();
    if (t.kind === 'answer') return this.resolveAnswer(this.state.lockedId, -1);   // ran out of time
    if (t.kind === 'question') return this.reveal(null);                            // nobody buzzed
    if (t.kind === 'autonext') return this.nextQuestion();
  }

  async nextQuestion() {
    const s = this.state;
    if (s.settings.rounds && s.round >= s.settings.rounds) {
      s.phase = 'over'; await this.save();
      this.broadcast({ t: 'over', scores: scoreboard(s.players) });
      return;
    }
    let bank;
    try { bank = await this.bankOrFetch(); }
    catch (e) { this.broadcast({ t: 'error', msg: `Could not load questions: ${e.message}` }); return; }
    const q = pickQuestion(bank, new Set(s.usedIds), {
      category: s.settings.category, difficulty: s.settings.difficulty,
      lastCategory: s.lastCategory, categoryCounts: s.catCounts
    });
    if (!q) { this.broadcast({ t: 'error', msg: 'No questions left for those filters.' }); return; }
    const options = shuffleOptions(q);
    s.round++;
    s.usedIds.push(q.id); if (s.usedIds.length > 500) s.usedIds.shift();
    s.catCounts[q.category] = (s.catCounts[q.category] || 0) + 1;
    s.lastCategory = q.category;
    s.question = {
      id: q.id, text: q.type === 'boolean' ? `True or false: ${q.question}` : q.question,
      options, correctIdx: options.indexOf(q.correct), category: q.category, difficulty: q.difficulty,
      explain: q.explain || '', source: q.explainSource || null
    };
    s.phase = 'question'; s.buzzes = []; s.tried = []; s.lockedId = null; s.lastReveal = null;
    s.shownAt = Date.now() + REVEAL_LEAD_MS;      // every screen reveals at the same moment
    s.deadline = s.shownAt + (s.settings.timer || 20000);
    await this.setTimer('question', s.deadline);
    this.broadcast({
      t: 'question', round: s.round, rounds: s.settings.rounds, now: Date.now(),
      question: { text: s.question.text, options, category: q.category, difficulty: q.difficulty },
      shownAt: s.shownAt, deadline: s.deadline
    });
  }

  async lockWinner() {
    const s = this.state;
    if (s.phase !== 'question' || !s.buzzes.length) return;
    const winner = rankBuzzes(s.buzzes)[0];
    s.lockedId = winner.id;
    s.lockedAt = winner.at;
    s.phase = 'locked';
    s.buzzes = [];
    const deadline = Date.now() + ANSWER_MS;
    await this.setTimer('answer', deadline);
    this.broadcast({ t: 'locked', id: winner.id, name: s.players[winner.id]?.name || '?', deadline, now: Date.now() });
  }

  async resolveAnswer(pid, idx) {
    const s = this.state;
    const p = s.players[pid];
    if (!p) return;
    const right = idx === s.question.correctIdx;
    s.tried.push(pid);
    let delta;
    if (right) {
      delta = awardPoints(s.question.difficulty, Math.max(0, (s.lockedAt || Date.now()) - s.shownAt), s.settings.timer);
      p.score += delta;
      return this.reveal({ id: pid, name: p.name, delta, correct: true });
    }
    delta = -penalty(s.question.difficulty);
    p.score += delta;
    const left = remainingContenders(s.players, s.tried);
    this.broadcast({ t: 'wrong', id: pid, name: p.name, delta, scores: scoreboard(s.players), timedOut: idx < 0 });
    if (left.length) {                              // reopen to everyone who hasn't tried
      s.phase = 'question'; s.lockedId = null; s.buzzes = [];
      s.deadline = Date.now() + Math.min(s.settings.timer, 10000);
      await this.setTimer('question', s.deadline);
      this.broadcast({ t: 'reopen', deadline: s.deadline, now: Date.now(), tried: s.tried });
      return;
    }
    return this.reveal(null);
  }

  async reveal(winner) {
    const s = this.state;
    s.phase = 'reveal'; s.lockedId = null; s.buzzes = [];
    s.lastReveal = {
      correctIdx: s.question.correctIdx, correct: s.question.options[s.question.correctIdx],
      explain: s.question.explain, source: s.question.source, winner
    };
    if (s.settings.autoNext) await this.setTimer('autonext', Date.now() + 7000); else await this.save();
    this.broadcast({ t: 'reveal', ...s.lastReveal, scores: scoreboard(s.players), round: s.round, rounds: s.settings.rounds });
  }
}
