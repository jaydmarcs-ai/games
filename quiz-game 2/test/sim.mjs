// Run with: npm test   (no Netlify account or network needed)
import { makeHandler } from '../lib/handler.mjs';
import { ROUNDS, TOTAL_QUESTIONS } from '../lib/game.mjs';

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
const S = async () => (await state()).body;

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };

// ---- Setup ----
check(`question bank has ${TOTAL_QUESTIONS} questions in ${ROUNDS.length} rounds`, TOTAL_QUESTIONS === 100 && ROUNDS.length === 4);
check('wrong PIN is rejected', (await adm('check', {}, '0000')).status === 401);
check('cannot start with no teams', (await adm('start')).status === 409);

const mk = async (name, dev, members) => (await post('join', { name, deviceId: dev, members })).body;
const A = await mk('Alpha', 'phoneA', ['Sam', 'Aisha', 'Tom']);
const B = await mk('Beta', 'phoneB', ['Lina', 'Omar']);
const C = await mk('Gamma', 'phoneC', ['Joy']);
const teams = [{ ...A, dev: 'phoneA' }, { ...B, dev: 'phoneB' }, { ...C, dev: 'phoneC' }];
check('3 teams joined (admin can start without a full house)', (await adm('start')).status === 200 && (await S()).phase === 'question');
check('new team refused after start', (await post('join', { name: 'Late', deviceId: 'pl', members: ['M'] })).status === 403);

const ans = (team, choice, member) => post('answer', { teamId: team.teamId, deviceId: team.dev, choice, member });
// Every team answers; the question closes early once the last one is in.
async function allAnswer(choices) {
  for (let i = 0; i < teams.length; i++) { clock += 700; await ans(teams[i], choices[i]); }
}
let seen = 0;

// ---- Round 1: general knowledge ----
let s = await S();
check('round 1 info', s.round.n === 1 && s.round.of === 4 && s.round.qTotal === 30 && s.round.title === 'General knowledge');
check('correct answer hidden during a question', s.reveal === null && !JSON.stringify(s).includes('"correct"'));
// first question: Alpha right, Beta wrong, Gamma silent -> times out by itself
const q0 = ROUNDS[0].questions[0];
clock += 2000; await ans(teams[0], q0.correct, 2);
clock += 1000; await ans(teams[1], (q0.correct + 1) % 4);
check('not closed until every team answers or time runs out', (await S()).phase === 'question');
clock += 25_000;
s = await S();
check('round closes itself after the time limit', s.phase === 'reveal');
check('right answer scores 10 + bonus; wrong or missing scores 0',
  s.reveal.results[A.teamId].gain >= 10 && s.reveal.results[A.teamId].gain <= 15 &&
  s.reveal.results[B.teamId].gain === 0 && s.reveal.results[C.teamId].choice === null);
check('late answer after close is refused', (await ans(teams[2], 0)).status === 409);
seen++;
let r1ok = true;
for (let i = 1; i < 30; i++) {
  const r = await adm('next');
  if (r.status !== 200) { r1ok = false; break; }
  seen++;
  const q = ROUNDS[0].questions[i];
  clock += 1000; await ans(teams[0], q.correct);   // Alpha is always right
  clock += 500; await ans(teams[1], 0);
  clock += 500; await ans(teams[2], 0);
}
check('all 30 round-1 questions played', r1ok && (await S()).reveal.lastInRound === true && (await S()).reveal.lastInGame === false);
const turns = (await state(`?teamId=${A.teamId}&deviceId=phoneA`)).body.me.turns;
check('answering member rotates when the phone does not choose', Math.max(...turns) - Math.min(...turns) <= 1, JSON.stringify(turns));

// ---- Between rounds 1 and 2 ----
await adm('next');
s = await S();
check('round 1 ends on a results screen, no break', s.phase === 'between' && s.between.done.n === 1 && s.between.next.n === 2 && s.between.breakEndsAt === 0);
check('round gains are shown', s.teams.every((t) => t.roundGain === t.score));
check('cannot add break time when there is no break', (await adm('addbreak', { minutes: 5 })).status === 409);
check('no question can be answered between rounds', (await ans(teams[0], 0)).status === 409);

// ---- Round 2: teams choose the category ----
check('host starts round 2', (await adm('startround')).status === 200);
s = await S();
check('round 2 opens on a category pick', s.phase === 'pick' && s.round.kind === 'pick' && s.round.qTotal === 32 && s.pick.categories.length === 4);
check('categories are Sports, History, CRE, Entertainment, 8 questions each',
  s.pick.categories.map((c) => c.name).join() === 'Sports,History,CRE,Entertainment' && s.pick.categories.every((c) => c.left === 8));

const choosers = [];
const catsSeen = {};
for (let i = 0; i < 32; i++) {
  s = await S();
  if (s.phase !== 'pick') { check(`pick phase before question ${i + 1}`, false, s.phase); break; }
  choosers.push(s.pick.chooserName);
  const chooser = teams.find((t) => t.teamId === s.pick.chooserId);
  const other = teams.find((t) => t.teamId !== s.pick.chooserId);
  if (i === 0) {
    check('a team whose turn it is not cannot pick',
      (await post('pick', { teamId: other.teamId, deviceId: other.dev, category: 'sports' })).status === 403);
    const me = (await state(`?teamId=${chooser.teamId}&deviceId=${chooser.dev}`)).body.me;
    check('the choosing team is told it is its turn', me.isChooser === true);
  }
  if (i === 9) {
    const full = s.pick.categories.find((c) => c.id === 'sports');
    check('a used-up category cannot be chosen',
      full.left === 0 && (await post('pick', { teamId: chooser.teamId, deviceId: chooser.dev, category: 'sports' })).status === 409);
  }
  if (i === 10) {
    clock += 20_000; // nobody picks: a random category is chosen
    s = await S();
    check('if the team does not choose in time, a category is chosen at random',
      s.phase === 'question' && !!s.question.category && s.question.chosenBy === null);
  } else if (i === 11) {
    const left = s.pick.categories.find((c) => c.left > 0).id;
    check('host can choose for the team', (await adm('pick', { category: left })).status === 200);
  } else {
    const cat = i < 8 ? 'sports' : s.pick.categories.find((c) => c.left > 0).id; // first 8 picks use up Sports
    const r = await post('pick', { teamId: chooser.teamId, deviceId: chooser.dev, category: cat });
    if (r.status !== 200) { check(`pick ${i + 1}`, false, JSON.stringify(r.body)); break; }
  }
  s = await S();
  seen++;
  catsSeen[s.question.category] = (catsSeen[s.question.category] || 0) + 1;
  if (i === 0) check('the question shows its category and which team chose it', s.question.category === 'Sports' && s.question.chosenBy === chooser.name);
  clock += 1000; await allAnswer([0, 1, 2]);
  if (i < 31) await adm('next');
}
check('choosers rotate through all teams', new Set(choosers.slice(0, 3)).size === 3, choosers.slice(0, 4).join());
check('each category was played 8 times', Object.values(catsSeen).length === 4 && Object.values(catsSeen).every((n) => n === 8), JSON.stringify(catsSeen));
check('round 2 ends with the last question flagged', (await S()).reveal.lastInRound === true);

// ---- The 30 minute break ----
await adm('next');
s = await S();
const breakStart = clock;
check('after round 2 comes a 30 minute break', s.phase === 'between' && s.between.breakEndsAt === breakStart + 30 * 60000 && s.between.next.n === 3);
check('break screen lists the logo images to download, without the answers',
  s.between.preload.length === 20 && !JSON.stringify(s.between).includes('Safaricom'));
clock += 10 * 60000;
check('host can add 5 minutes', (await adm('addbreak', { minutes: 5 })).status === 200 && (await S()).between.breakEndsAt === breakStart + 35 * 60000);
clock += 26 * 60000; // past the end of the break: nothing starts by itself
check('the game waits for the host after the break', (await S()).phase === 'between');
check('wrong PIN cannot start the round', (await adm('startround', {}, '1111')).status === 401);

// ---- Round 3: logos ----
check('host starts round 3', (await adm('startround')).status === 200);
const logoItems = Object.fromEntries(ROUNDS[2].items.map((i) => [i.image, i]));
const groupOf = {};
ROUNDS[2].items.forEach((i) => { groupOf[i.answer] = i.group; });
ROUNDS[2].pool.forEach((p) => { groupOf[p.name] = p.group; });
let imgOk = true, optOk = true, sameGroupOk = true;
const imagesSeen = new Set();
for (let i = 0; i < 20; i++) {
  s = await S();
  seen++;
  const it = logoItems[s.question.image];
  if (!it || s.question.options.length !== 4 || new Set(s.question.options).size !== 4) imgOk = false;
  imagesSeen.add(s.question.image);
  if (!s.question.options.includes(it.answer)) optOk = false;
  if (s.question.options.filter((o) => groupOf[o] === it.group).length < 4) sameGroupOk = false;
  clock += 800; await allAnswer([s.question.options.indexOf(it.answer), 0, 0]);
  if (s.question.options[(await S()).reveal.correct] !== it.answer) optOk = false;
  if (i < 19) await adm('next');
}
check('20 logo questions, each with its own image and 4 different options', imgOk && imagesSeen.size === 20);
check('the right brand is always among the options and marked correct', optOk);
check('wrong options are the same kind of brand (sportswear with sportswear, etc.)', sameGroupOk);

// ---- Round 4: faces ----
await adm('next');
s = await S();
check('round 3 ends on a results screen', s.phase === 'between' && s.between.next.n === 4 && s.between.breakEndsAt === 0);
await adm('startround');
const faceItems = Object.fromEntries(ROUNDS[3].items.map((i) => [i.image, i]));
const names = new Set(ROUNDS[3].items.map((i) => i.answer));
let facesOk = true;
for (let i = 0; i < 18; i++) {
  s = await S();
  seen++;
  const it = faceItems[s.question.image];
  if (!it || !s.question.options.every((o) => names.has(o)) || !s.question.options.includes(it.answer)) facesOk = false;
  clock += 800; await allAnswer([s.question.options.indexOf(it.answer), 0, 0]);
  if (i < 17) await adm('next');
}
check('18 face questions; every option is a Kenyan comedian from the list', facesOk);
check('the last question of the last round is flagged as the end of the game', (await S()).reveal.lastInGame === true);
check(`all ${TOTAL_QUESTIONS} questions were played`, seen === TOTAL_QUESTIONS, String(seen));

// ---- Final ----
await adm('next');
s = await S();
check('final results', s.phase === 'final' && s.final.winners.length >= 1);
check('winner is top of the board', s.final.winners.includes(s.teams[0].id), JSON.stringify(s.final));
check('Alpha (right in rounds 1, 3 and 4) wins', s.teams[0].name === 'Alpha');
check('play again keeps teams, zeroes scores', (await adm('reset', { keepTeams: true })).status === 200
  && (await S()).phase === 'lobby' && (await S()).teams.length === 3 && (await S()).teams.every((t) => t.score === 0));
check('clear removes teams', (await adm('reset', { keepTeams: false })).status === 200 && (await S()).teams.length === 0);

// ---- Ending early, takeover, tiny replies, concurrency ----
await post('join', { name: 'Solo', deviceId: 'ps', members: ['One'] });
await adm('start');
check('host can end the game early', (await adm('end')).status === 200 && (await S()).phase === 'final');
await adm('reset', { keepTeams: true });
await adm('start');
const solo = (await S()).teams[0];
const take = await post('join', { name: 'solo', deviceId: 'newPhone', takeover: true });
check('replacement phone can take over a team mid-game', take.status === 200 && take.body.teamId === solo.id);
check('old phone can no longer answer', (await post('answer', { teamId: solo.id, deviceId: 'ps', choice: 0 })).status === 403);
const s1 = await S();
check('unchanged state returns a tiny reply', (await state(`?since=${s1.v}`)).body.unchanged === true);

await adm('reset', { keepTeams: false });
await Promise.all(['A', 'B', 'C', 'D'].map((n) => post('join', { name: 'Race' + n, deviceId: 'r' + n, members: ['M'] })));
check('4 simultaneous joins all saved (etag retry works)', (await S()).teams.length === 4);

const noPin = makeHandler(store, { adminPin: undefined, adminName: 'x' });
const np = await noPin(new Request('http://x/api/state'));
check('missing ADMIN_PIN gives a clear setup message', np.status === 500 && (await np.json()).error.includes('ADMIN_PIN'));

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
