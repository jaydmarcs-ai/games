// Round 2 with a full house: 8 teams, 8 categories, each team answers its own 4 questions.
import { makeHandler } from '../lib/handler.mjs';
import { ROUNDS } from '../lib/game.mjs';

function setup() {
  let blob = null, n = 0, clock = 1_000_000;
  const store = {
    async load() { return blob ? { data: JSON.parse(JSON.stringify(blob.data)), etag: blob.etag } : null; },
    async save(d, e) { if (e === null ? blob !== null : !blob || blob.etag !== e) return { modified: false }; blob = { data: JSON.parse(JSON.stringify(d)), etag: String(++n) }; return { modified: true }; },
  };
  const h = makeHandler(store, { adminPin: '4321', adminName: 'Ibrahim', now: () => clock });
  const call = async (m, p, b, hd = {}) => { const r = await h(new Request('http://x/api/' + p, { method: m, headers: { 'content-type': 'application/json', ...hd }, body: m === 'POST' ? JSON.stringify(b || {}) : undefined })); return { status: r.status, body: await r.json() }; };
  return {
    post: (p, b) => call('POST', p, b), adm: (a, b) => call('POST', 'admin/' + a, b, { 'x-admin-key': '4321' }),
    S: async () => (await call('GET', 'state')).body, tick: (ms) => { clock += ms; },
  };
}
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const correctFor = (text) => { for (const c of ROUNDS[1].categories) { const q = c.questions.find((x) => x.text === text); if (q) return q.correct; } };

async function toRound2(g, count) {
  const teams = [];
  for (let i = 0; i < count; i++) {
    const r = (await g.post('join', { name: 'Team' + (i + 1), deviceId: 'd' + i, members: ['M'] })).body;
    teams.push({ ...r, dev: 'd' + i });
  }
  await g.adm('start');
  for (let i = 0; i < 30; i++) { await g.tick(1000); await g.adm('close'); await g.adm('next'); }
  await g.adm('next'); // reveal -> between
  await g.adm('startround');
  return teams;
}

const findQ = (text) => { for (const c of ROUNDS[1].categories) { const q = c.questions.find((x) => x.text === text); if (q) return q; } };
const right = (text) => { const q = findQ(text); return q.type === 'number' ? { value: q.answer ?? 5 } : { choice: q.correct }; };
const settle = async (g) => { const st = await g.S(); if (st.reveal && st.reveal.pending) await g.adm('setanswer', { value: 5 }); };

// Plays the 4 questions of one team's turn, answering everything correctly. Returns the categories seen.
async function playTurn(g, team, name) {
  const cats = new Set(), texts = new Set();
  for (let i = 0; i < 4; i++) {
    const s = await g.S();
    cats.add(s.question.category); texts.add(s.question.text);
    if (s.question.owner.id !== team.teamId) { check(name + ' owns every question of its turn', false, s.question.owner.name); break; }
    await g.tick(1000);
    await g.post('answer', { teamId: team.teamId, deviceId: team.dev, member: 0, ...right(s.question.text) });
    await settle(g);
    if (i < 3) await g.adm('next');
  }
  return { cats, texts };
}

// ---------- Scenario 1: 8 teams, each drawn at random, each plays one category alone ----------
{
  const g = setup();
  const teams = await toRound2(g, 8);
  const drawn = [], catOf = {}, owners = {};
  let allOwn = true, allFour = true;
  for (let turn = 1; turn <= 8; turn++) {
    let s = await g.S();
    if (s.phase !== 'pick') { check('turn ' + turn + ' starts with a draw', false, s.phase); break; }
    const chooser = teams.find((t) => t.teamId === s.pick.chooserId);
    drawn.push(s.pick.chooserName);
    const free = s.pick.categories.filter((c) => c.left > 0);
    const r = await g.post('pick', { teamId: chooser.teamId, deviceId: chooser.dev, category: free[free.length - 1].id });
    if (r.status !== 200) { check('turn ' + turn + ' claim', false, JSON.stringify(r.body)); break; }
    const { cats, texts } = await playTurn(g, chooser, s.pick.chooserName);
    catOf[s.pick.chooserName] = [...cats][0]; (owners[[...cats][0]] ||= new Set()).add(s.pick.chooserName);
    if (cats.size !== 1) allOwn = false;
    if (texts.size !== 4) allFour = false;
    if (turn < 8) { await settle(g); await g.adm('next'); }
  }
  check('all 8 teams were drawn exactly once', new Set(drawn).size === 8, drawn.join());
  check('each team stayed on its own category for all 4 questions', allOwn);
  check('each team played 4 different questions', allFour);
  check('8 different categories were played, one per team', Object.keys(owners).length === 8 && Object.values(owners).every((x) => x.size === 1));
  let s = await g.S();
  check('after the 8th team the round is over', s.phase === 'reveal' && s.reveal.lastInRound === true);
  check('each team scored only from its own 4 questions (40 to 60 points)', s.teams.every((t) => t.roundGain >= 40 && t.roundGain <= 60), JSON.stringify(s.teams.map((t) => t.roundGain)));
  check('round 2 ends and the 30 minute break starts', (await g.adm('next')).status === 200 && (await g.S()).between.breakEndsAt > 0);
}

// ---------- Scenario 2: teams removed during the round ----------
{
  const g = setup();
  const teams = await toRound2(g, 3);
  let s = await g.S();
  const first = s.pick.chooserId;
  await g.adm('kick', { teamId: first });
  s = await g.S();
  check('if the team that was drawn is removed, another team is drawn', s.phase === 'pick' && s.pick.chooserId !== first && s.teams.length === 2);
  const second = teams.find((t) => t.teamId === s.pick.chooserId);
  await g.post('pick', { teamId: second.teamId, deviceId: second.dev, category: s.pick.categories.find((x) => x.left > 0).id });
  s = await g.S();
  check('that team starts its turn', s.phase === 'question' && s.question.owner.id === second.teamId);
  await g.adm('kick', { teamId: second.teamId });   // the team in the spotlight is removed
  s = await g.S();
  check('removing the team that is playing closes its question', s.phase === 'reveal');
  await g.adm('skipanswer').catch(() => {});
  await g.adm('next');
  s = await g.S();
  const third = teams.find((t) => t.teamId === s.pick.chooserId);
  check('then the last team is drawn', s.phase === 'pick' && third && third.teamId !== first && third.teamId !== second.teamId);
  await g.post('pick', { teamId: third.teamId, deviceId: third.dev, category: s.pick.categories.find((x) => x.left > 0).id });
  const { texts } = await playTurn(g, third, 'last team');
  s = await g.S();
  check('the last team plays its 4 questions and the round ends', texts.size === 4 && s.reveal.lastInRound === true);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
