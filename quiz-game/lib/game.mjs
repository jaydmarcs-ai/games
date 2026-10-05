// Game rules for "Guess the Quiz". Pure functions on a plain JSON state object,
// so the same code runs in the Netlify Function and in the local tests.
import QUESTIONS from '../questions/general_knowledge.json' with { type: 'json' };

export const MAX_TEAMS = 8;
export const TEAM_SIZE = 4;          // members per team (one phone per team)
export const DEFAULT_SECONDS = 20;   // per question; a question can set its own "seconds"
export const BASE_POINTS = 10;
export const MAX_BONUS = 5;          // speed bonus: up to +5, shrinking as the clock runs down
export const GRACE_MS = 400;         // allowance for network lag on a late answer
const NAME_MAX = 24;
const MEMBER_MAX = 20;

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// ---------- Questions ----------
QUESTIONS.forEach((q, i) => {
  const ok =
    q && typeof q.text === 'string' && Array.isArray(q.options) &&
    q.options.length >= 2 && q.options.length <= 4 &&
    q.options.every((o) => typeof o === 'string') &&
    Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length;
  if (!ok) throw new Error(`Question ${i + 1} is invalid: needs "text", 2-4 "options", and a "correct" index.`);
});
export const QUESTION_COUNT = QUESTIONS.length;

// ---------- State ----------
export function newGame(teams = {}) {
  return {
    v: 0,               // bumped on every change; phones use it to skip unchanged updates
    phase: 'lobby',     // lobby | question | reveal | final
    qIndex: -1,
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
  const q = g.qIndex >= 0 ? QUESTIONS[g.qIndex] : null;
  const showQ = q && (g.phase === 'question' || g.phase === 'reveal');
  const list = ranked(g);
  const out = {
    v: g.v,
    now,
    phase: g.phase,
    maxTeams: MAX_TEAMS,
    teamSize: TEAM_SIZE,
    total: QUESTIONS.length,
    index: g.qIndex,
    seconds: g.seconds,
    endsAt: g.endsAt,
    // The correct answer is never sent until the round is closed.
    question: showQ ? { text: q.text, options: q.options } : null,
    reveal: g.phase === 'reveal' ? g.reveal : null,
    final: g.phase === 'final' ? g.final : null,
    teams: list.map(({ t, rank }) => ({
      id: t.id, name: t.name, score: t.score, rank, members: t.members,
      answered: !!t.answer, by: t.answer ? t.members[t.answer.member] : null,
    })),
    me: null,
  };
  const t = g.teams[who.teamId];
  if (t && t.deviceId === who.deviceId) {
    out.me = {
      id: t.id, name: t.name, score: t.score, rank: list.find((x) => x.t === t).rank,
      members: t.members, turns: t.turns,
      answer: t.answer ? { choice: t.answer.choice, member: t.answer.member } : null,
      result: g.phase === 'reveal'
        ? g.reveal.results[t.id] || { choice: null, member: null, correct: false, gain: 0 } : null,
    };
  }
  return out;
}

// ---------- Game flow ----------
// There is no background timer on Netlify, so a question that has run out of time
// is closed by whichever request arrives next (the screens poll every second).
export function tick(g, now) {
  if (g.phase === 'question' && now >= g.endsAt + GRACE_MS) { endQuestion(g); return true; }
  return false;
}

function startQuestion(g, now) {
  g.qIndex += 1;
  const q = QUESTIONS[g.qIndex];
  g.seconds = Number(q.seconds) > 0 ? Math.min(Number(q.seconds), 60) : DEFAULT_SECONDS;
  g.phase = 'question';
  g.reveal = null;
  g.startedAt = now;
  g.endsAt = now + g.seconds * 1000;
  for (const t of teamList(g)) t.answer = null;
}

function endQuestion(g) {
  if (g.phase !== 'question') return;
  const q = QUESTIONS[g.qIndex];
  const span = g.seconds * 1000;
  const counts = q.options.map(() => 0);
  const results = {};
  for (const t of teamList(g)) {
    let gain = 0, choice = null, member = null, correct = false;
    if (t.answer) {
      choice = t.answer.choice;
      member = t.members[t.answer.member] ?? null;
      counts[choice] += 1;
      if (choice === q.correct) {
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
  g.reveal = { correct: q.correct, counts, results, isLast: g.qIndex >= QUESTIONS.length - 1 };
  g.phase = 'reveal';
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
          score: 0, correct: 0, totalMs: 0, answer: null };
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
  const q = QUESTIONS[g.qIndex];
  const choice = Number(body.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) {
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

// ---------- Admin actions ----------
export function admin(g, action, body, now) {
  switch (action) {
    case 'check':
      return { ok: true };
    case 'start':
      if (g.phase !== 'lobby') throw new HttpError(409, 'The game is already running.');
      if (!teamList(g).length) throw new HttpError(409, 'At least one team has to join first.');
      g.qIndex = -1;
      startQuestion(g, now);
      return { ok: true };
    case 'close':
      if (g.phase !== 'question') throw new HttpError(409, 'No question is open.');
      endQuestion(g);
      return { ok: true };
    case 'next':
      if (g.phase !== 'reveal') throw new HttpError(409, 'Close the current question first.');
      if (g.qIndex >= QUESTIONS.length - 1) finish(g); else startQuestion(g, now);
      return { ok: true };
    case 'end':
      if (g.phase !== 'question' && g.phase !== 'reveal') throw new HttpError(409, 'No game is running.');
      finish(g);
      return { ok: true };
    case 'reset': {
      const keep = {};
      if (body.keepTeams) {
        for (const t of teamList(g)) keep[t.id] = { ...t, score: 0, correct: 0, totalMs: 0, answer: null, turns: t.members.map(() => 0) };
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
