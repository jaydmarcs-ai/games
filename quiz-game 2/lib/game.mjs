// Game rules for "Guess the Quiz". Pure functions on a plain JSON state object,
// so the same code runs in the Netlify Function and in the local tests.
import QUIZ from '../questions/quiz.json' with { type: 'json' };

export const MAX_TEAMS = 8;
export const TEAM_SIZE = 4;          // members per team (one phone per team)
export const DEFAULT_SECONDS = 20;   // per question; a round or question can set its own "seconds"
export const DEFAULT_PICK_SECONDS = 15;
export const BASE_POINTS = 10;
export const MAX_BONUS = 5;          // speed bonus: up to +5, shrinking as the clock runs down
export const GRACE_MS = 400;         // allowance for network lag on a late answer
const NAME_MAX = 24;
const MEMBER_MAX = 20;

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// ---------- Question bank ----------
export const ROUNDS = QUIZ.rounds;

function checkQuestion(q, where) {
  const ok =
    q && typeof q.text === 'string' && Array.isArray(q.options) &&
    q.options.length >= 2 && q.options.length <= 4 &&
    q.options.every((o) => typeof o === 'string') &&
    Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length;
  if (!ok) throw new Error(`${where} is invalid: needs "text", 2-4 "options", and a "correct" index.`);
}

if (!Array.isArray(ROUNDS) || !ROUNDS.length) throw new Error('quiz.json needs a "rounds" list.');
ROUNDS.forEach((r, ri) => {
  const w = `Round ${ri + 1}`;
  if (!['standard', 'pick', 'image'].includes(r.kind)) throw new Error(`${w}: "kind" must be standard, pick or image.`);
  if (r.kind === 'standard') {
    if (!r.questions?.length) throw new Error(`${w} has no questions.`);
    r.questions.forEach((q, i) => checkQuestion(q, `${w}, question ${i + 1}`));
  } else if (r.kind === 'pick') {
    if (!r.categories?.length) throw new Error(`${w} has no categories.`);
    r.categories.forEach((c) => {
      if (!c.id || !c.name || !c.questions?.length) throw new Error(`${w}: each category needs id, name and questions.`);
      c.questions.forEach((q, i) => checkQuestion(q, `${w}, ${c.name} question ${i + 1}`));
    });
  } else {
    if (!r.items?.length) throw new Error(`${w} has no items.`);
    const names = new Set([...r.items.map((i) => i.answer), ...(r.pool || []).map((p) => p.name)]);
    if (names.size < (r.optionCount || 4)) throw new Error(`${w}: needs at least ${r.optionCount || 4} different names across items and pool.`);
    r.items.forEach((it, i) => { if (!it.image || !it.answer) throw new Error(`${w}, item ${i + 1} needs "image" and "answer".`); });
  }
});

export const roundTotal = (r) =>
  r.kind === 'pick' ? r.categories.reduce((n, c) => n + c.questions.length, 0)
    : r.kind === 'image' ? r.items.length : r.questions.length;
export const TOTAL_QUESTIONS = ROUNDS.reduce((n, r) => n + roundTotal(r), 0);

function shuffle(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

// Image rounds: the wrong options come from the same group where possible
// (sportswear brands next to sportswear brands), then from anything else.
function imageQuestion(r, item) {
  const lc = (s) => s.toLowerCase();
  const all = new Map();
  for (const it of r.items) all.set(it.answer, it.group || '');
  for (const p of r.pool || []) if (!all.has(p.name)) all.set(p.name, p.group || '');
  const others = [...all.entries()].filter(([n]) => lc(n) !== lc(item.answer));
  const g = item.group || '';
  const same = shuffle(others.filter(([, x]) => g && x === g).map(([n]) => n));
  const rest = shuffle(others.filter(([, x]) => !(g && x === g)).map(([n]) => n));
  const options = shuffle([item.answer, ...[...same, ...rest].slice(0, (r.optionCount || 4) - 1)]);
  return { text: r.prompt || 'What is this?', options, correct: options.indexOf(item.answer), image: item.image, seconds: item.seconds };
}

// ---------- State ----------
export function newGame(teams = {}) {
  return {
    v: 0,               // bumped on every change; phones use it to skip unchanged updates
    phase: 'lobby',     // lobby | question | reveal | pick | between | final
    round: -1,          // index into ROUNDS
    qNum: 0,            // questions played so far in this round (zero-based position of the current one)
    order: [],          // question order for standard and image rounds
    used: {},           // pick rounds: how many questions each category has used
    pickCursor: 0,      // pick rounds: whose turn it is to choose
    pick: null,         // { chooser, seconds, endsAt }
    between: null,      // { next, breakEndsAt }
    cur: null,          // the current question, including the correct answer (never sent to screens)
    teams,              // id -> team
    startedAt: 0,
    endsAt: 0,
    seconds: DEFAULT_SECONDS,
    reveal: null,
    final: null,
  };
}

const teamList = (g) => Object.values(g.teams);
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const findByName = (g, name) => teamList(g).find((t) => t.name.toLowerCase() === name.toLowerCase());
const teamOfDevice = (g, d) => teamList(g).find((t) => t.deviceId === d);

function cleanMembers(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const name = String(m || '').replace(/\s+/g, ' ').trim().slice(0, MEMBER_MAX);
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, TEAM_SIZE);
}

function newTeamId(g) {
  let id;
  do { id = 't' + Math.random().toString(16).slice(2, 8); } while (g.teams[id]);
  return id;
}

// Highest score first. Equal scores: lower total answer time on correct answers wins.
function ranked(g) {
  const list = teamList(g).sort(
    (a, b) => b.score - a.score || a.totalMs - b.totalMs || a.name.localeCompare(b.name));
  let rank = 0;
  return list.map((t, i) => {
    const p = list[i - 1];
    if (!p || p.score !== t.score || p.totalMs !== t.totalMs) rank = i + 1;
    return { t, rank };
  });
}

// ---------- What each screen is allowed to see ----------
export function view(g, now, who = {}) {
  const r = g.round >= 0 ? ROUNDS[g.round] : null;
  const showQ = g.cur && (g.phase === 'question' || g.phase === 'reveal');
  const list = ranked(g);
  const out = {
    v: g.v,
    now,
    phase: g.phase,
    maxTeams: MAX_TEAMS,
    teamSize: TEAM_SIZE,
    totalQuestions: TOTAL_QUESTIONS,
    round: r ? { n: g.round + 1, of: ROUNDS.length, title: r.title, kind: r.kind, qNum: g.qNum + 1, qTotal: roundTotal(r) } : null,
    seconds: g.seconds,
    endsAt: g.endsAt,
    // The correct answer is never sent until the round is closed.
    question: showQ
      ? { text: g.cur.text, options: g.cur.options, image: g.cur.image, category: g.cur.category, chosenBy: g.cur.chosenBy }
      : null,
    reveal: g.phase === 'reveal' ? g.reveal : null,
    final: g.phase === 'final' ? g.final : null,
    pick: null,
    between: null,
    teams: list.map(({ t, rank }) => ({
      id: t.id, name: t.name, score: t.score, rank, members: t.members,
      roundGain: t.score - (t.base || 0),
      answered: !!t.answer, by: t.answer ? t.members[t.answer.member] : null,
    })),
    me: null,
  };

  if (g.phase === 'pick') {
    const chooser = g.teams[g.pick.chooser];
    out.pick = {
      chooserId: g.pick.chooser,
      chooserName: chooser ? chooser.name : '',
      seconds: g.pick.seconds,
      endsAt: g.pick.endsAt,
      categories: r.categories.map((c) => ({ id: c.id, name: c.name, left: c.questions.length - (g.used[c.id] || 0) })),
    };
  }
  if (g.phase === 'between') {
    const nxt = ROUNDS[g.between.next];
    out.between = {
      done: { n: g.round + 1, title: r.title },
      next: { n: g.between.next + 1, title: nxt.title, blurb: nxt.blurb || '', kind: nxt.kind },
      breakEndsAt: g.between.breakEndsAt,
      // Image names only (not answers), so phones can download them during the break.
      preload: nxt.kind === 'image' ? nxt.items.map((i) => i.image) : [],
    };
  }

  const t = g.teams[who.teamId];
  if (t && t.deviceId === who.deviceId) {
    out.me = {
      id: t.id, name: t.name, score: t.score, rank: list.find((x) => x.t === t).rank,
      members: t.members, turns: t.turns,
      isChooser: g.phase === 'pick' && g.pick.chooser === t.id,
      answer: t.answer ? { choice: t.answer.choice, member: t.answer.member } : null,
      result: g.phase === 'reveal'
        ? g.reveal.results[t.id] || { choice: null, member: null, correct: false, gain: 0 } : null,
    };
  }
  return out;
}

// ---------- Game flow ----------
// There is no background timer on Netlify, so a question (or category pick) that has run
// out of time is closed by whichever request arrives next (the screens poll every second).
export function tick(g, now) {
  if (g.phase === 'question' && now >= g.endsAt + GRACE_MS) { endQuestion(g); return true; }
  if (g.phase === 'pick' && now >= g.pick.endsAt + GRACE_MS) { autoPick(g, now); return true; }
  return false;
}

function startRound(g, idx, now) {
  const r = ROUNDS[idx];
  g.round = idx;
  g.qNum = 0;
  g.cur = null;
  g.reveal = null;
  g.pick = null;
  g.between = null;
  for (const t of teamList(g)) { t.base = t.score; t.answer = null; }
  if (r.kind === 'pick') {
    g.used = Object.fromEntries(r.categories.map((c) => [c.id, 0]));
    startPick(g, now);
    return;
  }
  const idxs = Array.from({ length: roundTotal(r) }, (_, i) => i);
  g.order = r.kind === 'image' || r.shuffle ? shuffle(idxs) : idxs;
  startQuestion(g, now);
}

function startPick(g, now) {
  const r = ROUNDS[g.round];
  const teams = teamList(g);
  if (!teams.length) throw new HttpError(409, 'There are no teams left in the game.');
  const chooser = teams[g.pickCursor % teams.length];
  g.pickCursor += 1;
  const seconds = Number(r.pickSeconds) > 0 ? Number(r.pickSeconds) : DEFAULT_PICK_SECONDS;
  g.phase = 'pick';
  g.cur = null;
  g.reveal = null;
  g.pick = { chooser: chooser.id, seconds, endsAt: now + seconds * 1000 };
}

const availableCategories = (g) =>
  ROUNDS[g.round].categories.filter((c) => (g.used[c.id] || 0) < c.questions.length);

function pickCategory(g, catId, now, how) {
  const cat = ROUNDS[g.round].categories.find((c) => c.id === catId);
  if (!cat) throw new HttpError(400, 'Unknown category.');
  if ((g.used[cat.id] || 0) >= cat.questions.length) throw new HttpError(409, `No ${cat.name} questions are left. Pick another category.`);
  const q = cat.questions[g.used[cat.id]];
  g.used[cat.id] += 1;
  const chooser = g.teams[g.pick.chooser];
  startQuestion(g, now, { q, category: cat.name, chosenBy: how === 'auto' || !chooser ? null : chooser.name });
}

function autoPick(g, now) {
  const avail = availableCategories(g);
  pickCategory(g, avail[Math.floor(Math.random() * avail.length)].id, now, 'auto');
}

function startQuestion(g, now, given) {
  const r = ROUNDS[g.round];
  let q;
  if (r.kind === 'pick') q = { ...given.q, category: given.category, chosenBy: given.chosenBy };
  else if (r.kind === 'image') q = imageQuestion(r, r.items[g.order[g.qNum]]);
  else q = { ...r.questions[g.order[g.qNum]] };
  const secs = Number(q.seconds) > 0 ? Number(q.seconds) : Number(r.seconds) > 0 ? Number(r.seconds) : DEFAULT_SECONDS;
  g.cur = {
    text: q.text, options: q.options, correct: q.correct,
    image: q.image || null, category: q.category || null, chosenBy: q.chosenBy || null,
  };
  g.seconds = Math.min(secs, 60);
  g.phase = 'question';
  g.pick = null;
  g.reveal = null;
  g.startedAt = now;
  g.endsAt = now + g.seconds * 1000;
  for (const t of teamList(g)) t.answer = null;
}

function endQuestion(g) {
  if (g.phase !== 'question') return;
  const r = ROUNDS[g.round];
  const span = g.seconds * 1000;
  const counts = g.cur.options.map(() => 0);
  const results = {};
  for (const t of teamList(g)) {
    let gain = 0, choice = null, member = null, correct = false;
    if (t.answer) {
      choice = t.answer.choice;
      member = t.members[t.answer.member] ?? null;
      counts[choice] += 1;
      if (choice === g.cur.correct) {
        correct = true;
        const left = Math.max(0, g.endsAt - t.answer.at);
        gain = BASE_POINTS + Math.round((MAX_BONUS * left) / span);
        t.score += gain;
        t.correct += 1;
        t.totalMs += t.answer.at - g.startedAt;
      }
    }
    results[t.id] = { choice, member, correct, gain };
  }
  const lastInRound = g.qNum + 1 >= roundTotal(r);
  g.reveal = { correct: g.cur.correct, counts, results, lastInRound, lastInGame: lastInRound && g.round === ROUNDS.length - 1 };
  g.phase = 'reveal';
}

function endRound(g, now) {
  if (g.round >= ROUNDS.length - 1) { finish(g); return; }
  const mins = Number(ROUNDS[g.round].breakAfterMinutes) || 0;
  g.phase = 'between';
  g.cur = null;
  g.reveal = null;
  g.between = { next: g.round + 1, breakEndsAt: mins ? now + mins * 60000 : 0 };
}

function finish(g) {
  const r = ranked(g);
  const top = r.filter((x) => x.rank === 1);
  let winners = top.map((x) => x.t.id);
  let tiebreak = null;
  if (!top.length || top[0].t.score === 0) winners = [];
  else if (top.length > 1) tiebreak = 'shared';
  else if (r.length > 1 && r[1].t.score === top[0].t.score) tiebreak = 'speed';
  g.final = { winners, tiebreak };
  g.phase = 'final';
  g.cur = null;
  g.pick = null;
  g.between = null;
}

// ---------- Player actions ----------
export function join(g, body) {
  const name = cleanName(body.name);
  const device = String(body.deviceId || '').slice(0, 64);
  const members = cleanMembers(body.members);
  if (!name) throw new HttpError(400, 'Enter a team name.');
  if (!device) throw new HttpError(400, 'Missing device id. Reload the page and try again.');

  let t = findByName(g, name);
  const mine = teamOfDevice(g, device);
  const switching = mine && mine !== t;
  if (switching && g.phase !== 'lobby') {
    throw new HttpError(409, `This phone is already running team "${mine.name}".`);
  }

  if (t) {
    if (t.deviceId !== device && !body.takeover) {
      throw new HttpError(409,
        `A team called "${t.name}" already exists. If this phone is replacing that team's phone, confirm below.`,
        'exists');
    }
    t.deviceId = device;
    if (g.phase === 'lobby' && members.length) t.members = members;
  } else {
    if (g.phase !== 'lobby') {
      throw new HttpError(403, 'The game has started, so new teams can\'t join. To get back into your team, type its exact name.');
    }
    if (!members.length) throw new HttpError(400, 'Add at least one team member.');
    const freed = switching ? 1 : 0;
    if (teamList(g).length - freed >= MAX_TEAMS) throw new HttpError(403, `All ${MAX_TEAMS} team spots are taken.`);
  }

  if (switching) delete g.teams[mine.id];
  if (!t) {
    t = { id: newTeamId(g), name, deviceId: device, members, turns: members.map(() => 0),
          score: 0, base: 0, correct: 0, totalMs: 0, answer: null };
    g.teams[t.id] = t;
  }
  while (t.turns.length < t.members.length) t.turns.push(0);
  t.turns.length = t.members.length;
  return { ok: true, teamId: t.id, name: t.name };
}

export function leave(g, deviceId) {
  const t = teamOfDevice(g, String(deviceId || ''));
  if (t && g.phase === 'lobby') delete g.teams[t.id];
  return { ok: true };
}

export function answer(g, body, now) {
  const t = g.teams[body.teamId];
  if (!t || t.deviceId !== body.deviceId) throw new HttpError(403, "This phone isn't running a team.");
  if (g.phase !== 'question') throw new HttpError(409, 'No question is open.');
  if (now > g.endsAt + GRACE_MS) throw new HttpError(409, 'Time is up.');
  const choice = Number(body.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= g.cur.options.length) {
    throw new HttpError(400, 'Invalid choice.');
  }
  if (t.answer) return { ok: true, choice: t.answer.choice, already: true }; // first tap locks in

  // Who answers: the member the phone picked, or whoever has answered least so far.
  let member = Number(body.member);
  if (!Number.isInteger(member) || member < 0 || member >= t.members.length) {
    member = t.turns.indexOf(Math.min(...t.turns));
  }
  t.answer = { choice, member, at: Math.min(now, g.endsAt) };
  t.turns[member] += 1;
  if (teamList(g).every((x) => x.answer)) endQuestion(g); // everyone is in: no need to wait
  return { ok: true, choice, member };
}

// The team whose turn it is chooses the category (round 2).
export function pickByTeam(g, body, now) {
  const t = g.teams[body.teamId];
  if (!t || t.deviceId !== body.deviceId) throw new HttpError(403, "This phone isn't running a team.");
  if (g.phase !== 'pick') throw new HttpError(409, 'No category is being chosen right now.');
  if (g.pick.chooser !== t.id) throw new HttpError(403, "It isn't your team's turn to choose.");
  if (now > g.pick.endsAt + GRACE_MS) throw new HttpError(409, 'Time is up.');
  pickCategory(g, String(body.category), now, 'team');
  return { ok: true };
}

// ---------- Admin actions ----------
export function admin(g, action, body, now) {
  switch (action) {
    case 'check':
      return { ok: true };
    case 'start':
      if (g.phase !== 'lobby') throw new HttpError(409, 'The game is already running.');
      if (!teamList(g).length) throw new HttpError(409, 'At least one team has to join first.');
      startRound(g, 0, now);
      return { ok: true };
    case 'close':
      if (g.phase !== 'question') throw new HttpError(409, 'No question is open.');
      endQuestion(g);
      return { ok: true };
    case 'next': {
      if (g.phase !== 'reveal') throw new HttpError(409, 'Close the current question first.');
      const r = ROUNDS[g.round];
      if (g.qNum + 1 < roundTotal(r)) {
        g.qNum += 1;
        if (r.kind === 'pick') startPick(g, now); else startQuestion(g, now);
      } else endRound(g, now);
      return { ok: true };
    }
    case 'pick': // host picks the category for the team whose turn it is
      if (g.phase !== 'pick') throw new HttpError(409, 'No category is being chosen right now.');
      pickCategory(g, String(body.category), now, 'host');
      return { ok: true };
    case 'startround':
      if (g.phase !== 'between') throw new HttpError(409, 'There is no round waiting to start.');
      startRound(g, g.between.next, now);
      return { ok: true };
    case 'addbreak': {
      if (g.phase !== 'between' || !g.between.breakEndsAt) throw new HttpError(409, 'There is no break running.');
      const mins = Math.min(Math.max(Number(body.minutes) || 5, 1), 60);
      g.between.breakEndsAt = Math.max(g.between.breakEndsAt, now) + mins * 60000;
      return { ok: true };
    }
    case 'end':
      if (!['question', 'reveal', 'pick', 'between'].includes(g.phase)) throw new HttpError(409, 'No game is running.');
      finish(g);
      return { ok: true };
    case 'reset': {
      const keep = {};
      if (body.keepTeams) {
        for (const t of teamList(g)) {
          keep[t.id] = { ...t, score: 0, base: 0, correct: 0, totalMs: 0, answer: null, turns: t.members.map(() => 0) };
        }
      }
      const v = g.v;
      Object.assign(g, newGame(keep), { v });
      return { ok: true };
    }
    case 'kick':
      delete g.teams[String(body.teamId)];
      if (g.phase === 'question' && teamList(g).length && teamList(g).every((x) => x.answer)) endQuestion(g);
      return { ok: true };
    default:
      throw new HttpError(404, 'Unknown action.');
  }
}
