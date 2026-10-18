// The question editor: who may change the questions, what is accepted, and when.
import { makeHandler } from '../lib/handler.mjs';
import { DEFAULT_QUIZ, TOTAL_QUESTIONS, setQuiz } from '../lib/game.mjs';

let blob = null, n = 0;
const store = {
  async load() { return blob ? { data: JSON.parse(JSON.stringify(blob.data)), etag: blob.etag } : null; },
  async save(d, e) { if (e === null ? blob !== null : !blob || blob.etag !== e) return { modified: false }; blob = { data: JSON.parse(JSON.stringify(d)), etag: String(++n) }; return { modified: true }; },
};
let saved = null;                                   // stand-in for the edited-questions entry in Netlify Blobs
const quiz = { async load() { return saved ? JSON.parse(JSON.stringify(saved)) : null; }, async save(q) { saved = JSON.parse(JSON.stringify(q)); }, async clear() { saved = null; } };
const images = (() => { const m = new Map(); return { async get(s) { return m.get(s) || null; }, async put(s, b, t) { m.set(s, { data: b, contentType: t }); }, async del(s) { m.delete(s); }, async list() { return [...m.keys()]; } }; })();
let clock = 1_000_000;
const newHandler = () => makeHandler(store, { adminPin: '4321', adminName: 'Ibrahim', quiz, images, now: () => clock });
let h = newHandler();

const call = async (method, path, body, pin = '4321') => {
  const res = await h(new Request('http://x/api/' + path, { method, headers: { 'content-type': 'application/json', ...(pin ? { 'x-admin-key': pin } : {}) }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined }));
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const adm = (a, b, pin) => call('POST', 'admin/' + a, b, pin);
const S = async () => (await call('GET', 'state')).body;
const copy = () => JSON.parse(JSON.stringify(DEFAULT_QUIZ));
const put = (q, pin) => adm('quizput', { quiz: q }, pin);

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };

// ---- who may read and change ----
check('reading the questions needs the PIN', (await adm('quizget', {}, '0000')).status === 401);
check('saving questions needs the PIN', (await put(copy(), '0000')).status === 401 && (await put(copy(), null)).status === 401);
let g = (await adm('quizget')).body;
check('at first the original questions are in use', g.custom === false && g.running === false && g.quiz.rounds.length === 4 && TOTAL_QUESTIONS === 100);

// ---- a valid edit ----
let q = copy();
q.rounds[0].questions[0].text = 'Which planet is called the Red Planet?';
q.rounds[0].questions.push({ text: 'What is 2 + 2?', options: ['3', '4', '5', '22'], correct: 1 });
let r = await put(q);
check('a valid edit is saved', r.status === 200 && r.body.total === 101, JSON.stringify(r.body));
g = (await adm('quizget')).body;
check('the editor then shows the edited questions', g.custom === true && g.quiz.rounds[0].questions[0].text.startsWith('Which planet is called') && g.quiz.rounds[0].questions.length === 31);
check('the game screens are told the new total', (await S()).totalQuestions === 101);
h = newHandler();
check('a brand-new server instance uses the edited questions too', (await S()).totalQuestions === 101);

// ---- edits that are refused (and nothing is saved) ----
const refused = async (name, mutate, expect) => {
  const bad = copy(); mutate(bad);
  const res = await put(bad);
  check(name, res.status === 400 && (!expect || res.body.error.includes(expect)), JSON.stringify(res.body));
};
await refused('a question with only one answer is refused, naming where', (b) => { b.rounds[0].questions[4].options = ['only one']; b.rounds[0].questions[4].correct = 0; }, 'Round 1, question 5');
await refused('a question with no text is refused', (b) => { b.rounds[0].questions[2].text = '  '; }, 'no text');
await refused('a right answer that does not exist is refused', (b) => { b.rounds[0].questions[0].correct = 7; }, 'right one marked');
await refused('a typed question with a non-number answer is refused', (b) => { b.rounds[1].categories[2].questions.find((x) => x.type === 'number').answer = 'lots'; }, 'number');
await refused('two categories with the same id are refused', (b) => { b.rounds[1].categories[1].id = b.rounds[1].categories[0].id; }, 'share the id');
await refused('a category with no questions is refused', (b) => { b.rounds[1].categories[3].questions = []; }, 'no questions');
await refused('a round with no questions is refused', (b) => { b.rounds[0].questions = []; }, 'no questions');
await refused('a round with no title is refused', (b) => { b.rounds[2].title = ''; }, 'title');
await refused('an image round with too few different names is refused', (b) => { b.rounds[3].items = b.rounds[3].items.slice(0, 2); b.rounds[3].pool = []; }, 'different names');
await refused('two pictures in the same slot are refused', (b) => { b.rounds[2].items[1].image = b.rounds[2].items[0].image; }, 'same slot'.replace('same slot', 'slot'));
await refused('a bad crop is refused', (b) => { b.rounds[3].items[0].crop = 'sideways'; }, 'crop');
check('something that is not a quiz is refused', (await adm('quizput', { quiz: 'hello' })).status === 400 && (await adm('quizput', {})).status === 400);
check('too much data is refused', (await adm('quizput', { quiz: { rounds: [], junk: 'x'.repeat(700000) } })).status === 413);
check('after all the refusals, the earlier good edit is still what is saved', (await adm('quizget')).body.quiz.rounds[0].questions.length === 31 && (await S()).totalQuestions === 101);

// ---- typed-number questions: blank answer, then a number ----
q = copy();
const jw = q.rounds[1].categories.find((c) => c.id === 'jw');
jw.questions.find((x) => x.text.includes('plagues')).answer = null;
await put(q);
let s = await S();
check('blanking a typed answer makes it a live-answer question (listed for the host)', s.liveAnswer.some((t) => t.includes('plagues')) && s.liveAnswer.length === 5);
jw.questions.find((x) => x.text.includes('elders')).answer = 14;
await put(q);
s = await S();
check('giving the Njakai elders answer removes it from that list', !s.liveAnswer.some((t) => t.includes('elders')) && s.liveAnswer.length === 4);

// ---- pictures follow the questions ----
q = copy();
q.rounds[2].items.push({ image: 'logos/21', answer: 'Brand New', group: 'telecom' });
await put(q);
let slots = (await adm('slots')).body.slots;
check('adding a logo adds a picture slot for it', slots.length === 39 && slots.some((x) => x.slot === 'logos/21' && x.label === 'Brand New'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
check('a picture can be uploaded for the new slot', (await adm('imageput', { slot: 'logos/21', contentType: 'image/png', data: png.toString('base64') })).status === 200);
q.rounds[2].items.pop();
await put(q);
check('removing it takes the slot away again', (await adm('slots')).body.slots.length === 38 && (await adm('imageput', { slot: 'logos/21', contentType: 'image/png', data: png.toString('base64') })).status === 400);

// ---- the game really uses the edited questions ----
q = copy();
q.rounds[0].questions = [
  { text: 'Edited question A?', options: ['a1', 'a2'], correct: 0 },
  { text: 'Edited question B?', options: ['b1', 'b2', 'b3'], correct: 2 },
  { text: 'Edited question C?', options: ['c1', 'c2', 'c3', 'c4'], correct: 3 },
];
await put(q);
const team = (await call('POST', 'join', { name: 'Alpha', deviceId: 'dA', members: ['Sam'] })).body;
await adm('start');
s = await S();
check('a game started now asks the edited questions (3 in round 1)', s.round.qTotal === 3 && /^Edited question [ABC]\?$/.test(s.question.text), JSON.stringify(s.question));

// ---- locked while a game is running ----
g = (await adm('quizget')).body;
check('the editor can still read the questions during a game, and is told one is running', g.running === true && g.phase === 'question');
r = await put(copy());
check('saving is refused while a game is running, with a plain explanation', r.status === 409 && /between games/.test(r.body.error), JSON.stringify(r.body));
check('resetting to the originals is refused while a game is running', (await adm('quizreset')).status === 409);
check('the running game was not disturbed', (await S()).question.text.startsWith('Edited question'));
await adm('end');
check('when the game has ended (final results), editing is allowed again', (await put(copy())).status === 200);

// ---- back to the originals ----
check('"reset to the original questions" works', (await adm('quizreset')).status === 200 && (await adm('quizget')).body.custom === false && (await S()).totalQuestions === 100);
check('and the saved edits are gone', saved === null);

// ---- a damaged saved set never breaks the game ----
saved = { rounds: [{ title: 'Broken', kind: 'standard', questions: [] }] };
h = newHandler();
r = await call('GET', 'state');
check('if the saved questions are somehow invalid, the original ones are used', r.status === 200 && r.body.totalQuestions === 100);
saved = null;

// ---- no store, no editor ----
const bare = makeHandler(store, { adminPin: '4321', adminName: 'x' });
check('without a questions store the editor says so plainly', (await bare(new Request('http://x/api/admin/quizget', { method: 'POST', headers: { 'x-admin-key': '4321' }, body: '{}' }))).status === 501);

setQuiz(DEFAULT_QUIZ);
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
