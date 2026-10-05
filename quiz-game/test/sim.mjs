// Run with: npm test   (no Netlify account or network needed)
import { makeHandler } from '../lib/handler.mjs';

// In-memory stand-in for Netlify Blobs, with the same etag behaviour.
let blob = null, etagN = 0;
const store = {
  async load() { return blob ? { data: structuredClone(blob.data), etag: blob.etag } : null; },
  async save(data, etag) {
    if (etag === null ? blob !== null : !blob || blob.etag !== etag) return { modified: false };
    blob = { data: structuredClone(data), etag: String(++etagN) };
    return { modified: true, etag: blob.etag };
  },
};
let clock = 1_000_000;
const handle = makeHandler(store, { adminPin: '4321', adminName: 'Ibrahim', now: () => clock });

const call = async (method, path, body, headers = {}) => {
  const res = await handle(new Request('http://x/api/' + path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
  }));
  return { status: res.status, body: await res.json() };
};
const post = (p, b) => call('POST', p, b);
const adm = (a, b, pin = '4321') => call('POST', 'admin/' + a, b, { 'x-admin-key': pin });
const state = (q = '') => call('GET', 'state' + q);

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };

// ---- Lobby ----
check('wrong PIN is rejected', (await adm('check', {}, '0000')).status === 401);
check('cannot start with no teams', (await adm('start')).status === 409);

const a = (await post('join', { name: 'Alpha', deviceId: 'phoneA', members: ['Sam', 'Aisha', 'Tom', 'Zed', 'Extra'] })).body;
check('team created, members capped at 4', (await state(`?teamId=${a.teamId}&deviceId=phoneA`)).body.me.members.length === 4);
check('team needs at least one member', (await post('join', { name: 'Empty', deviceId: 'p0', members: [] })).status === 400);
const dup = await post('join', { name: 'ALPHA', deviceId: 'phoneX', members: ['X'] });
check('same name from another phone asks for confirmation', dup.status === 409 && dup.body.code === 'exists');
check('same phone rejoins without duplicating', (await post('join', { name: 'Alpha', deviceId: 'phoneA' })).body.teamId === a.teamId);
const b = (await post('join', { name: 'Beta', deviceId: 'phoneB', members: ['Lina', 'Omar'] })).body;
const c = (await post('join', { name: 'Gamma', deviceId: 'phoneC', members: ['Joy'] })).body;
for (let i = 4; i <= 8; i++) await post('join', { name: 'Team' + i, deviceId: 'p' + i, members: ['M'] });
check('9th team is refused', (await post('join', { name: 'Ninth', deviceId: 'p9', members: ['M'] })).status === 403);
check('8 teams in lobby', (await state()).body.teams.length === 8);

// ---- Admin override: start with a subset ----
await adm('kick', { teamId: (await state()).body.teams.find((t) => t.name === 'Team8').id });
for (let i = 4; i <= 7; i++) await adm('kick', { teamId: (await state()).body.teams.find((t) => t.name === 'Team' + i).id });
check('3 teams left (Alpha, Beta, Gamma)', (await state()).body.teams.length === 3);
check('admin starts without a full house', (await adm('start')).status === 200 && (await state()).body.phase === 'question');
check('new team refused after start', (await post('join', { name: 'Late', deviceId: 'pl', members: ['M'] })).status === 403);
const q1 = (await state()).body;
check('correct answer hidden during the question', q1.reveal === null && !JSON.stringify(q1).includes('"correct"'));

// ---- Question 1 (correct = B / index 1) ----
clock += 2000; // 2s in
const ans = await post('answer', { teamId: a.teamId, deviceId: 'phoneA', choice: 1, member: 2 });
check('Alpha answers as Tom (member 2)', ans.body.member === 2);
check('second tap does not change a locked answer', (await post('answer', { teamId: a.teamId, deviceId: 'phoneA', choice: 0 })).body.already === true);
check('another phone cannot answer for Alpha', (await post('answer', { teamId: a.teamId, deviceId: 'phoneZ', choice: 1 })).status === 403);
const mid = (await state(`?teamId=${a.teamId}&deviceId=phoneA`)).body;
check('state shows who answered', mid.teams.find((t) => t.name === 'Alpha').by === 'Tom' && mid.me.answer.member === 2);
clock += 3000;
await post('answer', { teamId: b.teamId, deviceId: 'phoneB', choice: 0 }); // Beta wrong, default member
// Gamma never answers: the round should close by itself once time runs out
clock += 20_000; // way past the 20s limit
const ended = (await state()).body;
check('round closes itself after the time limit', ended.phase === 'reveal');
const res = ended.reveal.results;
check('Alpha gets 10 + speed bonus', res[a.teamId].correct && res[a.teamId].gain >= 10 && res[a.teamId].gain <= 15, JSON.stringify(res[a.teamId]));
check('wrong and missing answers score 0', res[b.teamId].gain === 0 && res[c.teamId].choice === null);
check('late answer after close is refused', (await post('answer', { teamId: c.teamId, deviceId: 'phoneC', choice: 1 })).status === 409);

// ---- Question 2: everyone answers -> closes early; default member rotates ----
await adm('next');
await post('answer', { teamId: a.teamId, deviceId: 'phoneA', choice: 2 });
const meA = (await state(`?teamId=${a.teamId}&deviceId=phoneA`)).body.me;
check('with no pick, the least-used member answers (Sam)', meA.answer.member === 0, JSON.stringify(meA.answer));
await post('answer', { teamId: b.teamId, deviceId: 'phoneB', choice: 2 });
check('not closed until all teams answer', (await state()).body.phase === 'question');
await post('answer', { teamId: c.teamId, deviceId: 'phoneC', choice: 0 });
check('closes early once all teams answered', (await state()).body.phase === 'reveal');

// ---- unchanged-update shortcut ----
const s1 = (await state()).body;
const s2 = (await state(`?since=${s1.v}`)).body;
check('unchanged state returns a tiny reply', s2.unchanged === true && s2.now !== undefined);

// ---- Rejoin + takeover ----
const take = await post('join', { name: 'beta', deviceId: 'newPhoneB', takeover: true });
check('replacement phone can take over a team mid-game', take.status === 200 && take.body.teamId === b.teamId);
check('old phone can no longer answer', (await post('answer', { teamId: b.teamId, deviceId: 'phoneB', choice: 1 })).status !== 200);

// ---- End, final, replay ----
check('host can end the game early', (await adm('end')).status === 200);
const fin = (await state()).body;
check('final standings', fin.phase === 'final' && Array.isArray(fin.final.winners));
const top = fin.teams[0];
check('winner is top of the board', fin.final.winners.includes(top.id), JSON.stringify(fin.final));
check('play again keeps teams, zeroes scores', (await adm('reset', { keepTeams: true })).status === 200
  && (await state()).body.teams.length === 3 && (await state()).body.teams.every((t) => t.score === 0));
check('clear removes teams', (await adm('reset', { keepTeams: false })).status === 200 && (await state()).body.teams.length === 0);

// ---- Concurrency: simultaneous joins must all survive ----
await Promise.all(['A', 'B', 'C', 'D'].map((n) => post('join', { name: 'Race' + n, deviceId: 'r' + n, members: ['M'] })));
check('4 simultaneous joins all saved (etag retry works)', (await state()).body.teams.length === 4);

// ---- Setup error ----
const noPin = makeHandler(store, { adminPin: undefined, adminName: 'x' });
const np = await noPin(new Request('http://x/api/state'));
check('missing ADMIN_PIN gives a clear setup message', np.status === 500 && (await np.json()).error.includes('ADMIN_PIN'));

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
