// Typed-number questions: scoring, tolerance, bad input, and questions that are still waiting for an answer.
import { newGame, answer, admin, view, ROUNDS, LIVE_ANSWER_QUESTIONS } from '../lib/game.mjs';

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.status || 1; } };

// A game paused on a typed-number question, owned by team t1 (as in a claim round)
function numberGame(answerNum, tolerance = 0) {
  const g = newGame({
    t1: { id: 't1', name: 'Alpha', deviceId: 'd1', members: ['Sam', 'Aisha'], turns: [0, 0], score: 0, base: 0, correct: 0, totalMs: 0, answer: null },
    t2: { id: 't2', name: 'Beta', deviceId: 'd2', members: ['Lina'], turns: [0], score: 0, base: 0, correct: 0, totalMs: 0, answer: null },
  });
  g.round = 1; g.phase = 'question'; g.seconds = 25; g.startedAt = 1000; g.endsAt = 26000;
  g.turn = { team: 't1', cat: 'jw', qs: [0], i: 0 };
  g.cur = { type: 'number', answerNum, tolerance, text: 'How many?', options: [], correct: null, image: null, crop: null, category: 'JW', chosenBy: null, owner: 't1' };
  return g;
}
const a = (g, value, now = 3000, team = 't1') => answer(g, { teamId: team, deviceId: team === 't1' ? 'd1' : 'd2', member: 1, value }, now);

{
  const g = numberGame(66);
  check('a number question is sent without its answer and without options', JSON.stringify(view(g, 0, {})).includes('"answerNum"') === false && view(g, 0, {}).question.type === 'number' && view(g, 0, {}).question.options.length === 0);
  check('typed text is refused', throws(() => a(g, 'sixty six')) === 400);
  check('an empty answer is refused', throws(() => a(g, '')) === 400);
  check('only the team whose turn it is can answer', throws(() => a(g, '66', 3000, 't2')) === 403);
  a(g, ' 66 ');
  check('the right number closes the question and scores', g.phase === 'reveal' && g.reveal.results.t1.correct && g.reveal.results.t1.gain >= 10 && g.reveal.results.t1.value === 66);
  check('the reveal shows the number (and who answered)', g.reveal.answerValue === 66 && g.reveal.results.t1.member === 'Aisha');
}
{
  const g = numberGame(66);
  a(g, '67');
  check('one off is wrong when no tolerance is set', g.reveal.results.t1.correct === false && g.reveal.results.t1.gain === 0 && g.teams.t1.score === 0);
}
{
  const g = numberGame(1200, 20);
  a(g, '1,190');
  check('with a tolerance of 20, 1,190 counts for 1200 (commas allowed)', g.reveal.results.t1.correct === true);
}
{
  const g = numberGame(1200, 20);
  a(g, '1150');
  check('but 1150 is outside the tolerance', g.reveal.results.t1.correct === false);
}
{
  const g = numberGame(12);
  g.cur.owner = null; g.turn = null;                      // an ordinary round: everyone can answer
  a(g, '12', 2000, 't1');
  check('in a normal round the question waits for the other team', g.phase === 'question');
  const again = a(g, '99', 2100, 't1');
  check('a locked answer cannot be changed (the first one stands)', again.already === true && g.teams.t1.answer.value === 12);
  a(g, '13', 2500, 't2');
  check('...and closes when everyone has answered; only the right team scores', g.phase === 'reveal' && g.reveal.results.t1.correct && !g.reveal.results.t2.correct);
}
// ---- Questions with no saved answer (the Njakai numbers): teams type, the host enters the number ----
const adminDo = (g, action, body = {}, now = 40000) => admin(g, action, body, now);
{
  const g = numberGame(null);
  check('the screens are told it is a live-answer question, but never a number', view(g, 0, {}).question.liveAnswer === true && !JSON.stringify(view(g, 0, {})).includes('answerNum'));
  a(g, '14', 3000, 't1');
  check('the owning team can type its answer as usual', g.phase === 'reveal');
  check('the question closes but is not scored yet', g.reveal.pending === true && g.teams.t1.score === 0 && g.reveal.results.t1.value === 14 && g.reveal.results.t1.correct === false);
  check('the typed answers are visible so the host can see them', view(g, 0, {}).reveal.results.t1.value === 14);
  check('the host cannot move on until the answer is entered', throws(() => adminDo(g, 'next')) === 409);
  check('an empty or non-number answer from the host is refused', throws(() => adminDo(g, 'setanswer', { value: '' })) === 400 && throws(() => adminDo(g, 'setanswer', { value: 'lots' })) === 400);
  adminDo(g, 'setanswer', { value: ' 14 ' });
  check('entering 14 scores the team that typed 14', g.reveal.pending === false && g.reveal.answerValue === 14 && g.reveal.results.t1.correct === true && g.teams.t1.score === g.reveal.results.t1.gain && g.teams.t1.score >= 10);
  check('speed bonus still comes from when the team answered', g.reveal.results.t1.gain >= 10 && g.reveal.results.t1.gain <= 15);
  check('now the host can move on', adminDo(g, 'next').ok === true && g.phase === 'between');
  check('entering an answer when there is nothing to settle is refused', throws(() => adminDo(g, 'setanswer', { value: 5 })) === 409);
}
{
  const g = numberGame(null);
  g.cur.owner = null; g.turn = null;                       // an ordinary round with two teams
  a(g, '14', 2000, 't1'); a(g, '15', 2500, 't2');
  adminDo(g, 'setanswer', { value: 15 });
  check('with two teams, only the team that typed the right number scores', g.reveal.results.t2.correct && !g.reveal.results.t1.correct && g.teams.t1.score === 0 && g.teams.t2.score >= 10);
}
{
  const g = numberGame(null);
  a(g, '9');
  adminDo(g, 'skipanswer');
  check('the host can skip a question: nobody scores', g.reveal.pending === false && g.reveal.skipped === true && g.teams.t1.score === 0);
  check('...and then move on', adminDo(g, 'next').ok === true);
}
{
  const g = numberGame(null);
  adminDo(g, 'setanswer', { value: 7 });
  check('the host can enter the number before the question closes', g.cur.answerNum === 7 && g.phase === 'question');
  a(g, '7');
  check('then it scores straight away when the question closes', g.reveal.pending === false && g.reveal.results.t1.correct === true);
}
{
  const g = numberGame(7);
  g.phase = 'reveal'; g.reveal = { pending: false };
  check('answers can only be entered for questions that have none', throws(() => adminDo(g, 'setanswer', { value: 3 })) === 409);
}
check('the four Njakai questions are in the game, with no saved answer', LIVE_ANSWER_QUESTIONS.length === 4 && LIVE_ANSWER_QUESTIONS.every((t) => t.includes('Njakai')));
const jw = ROUNDS[1].categories.find((c) => c.id === 'jw');
check('they are part of the JW category (not skipped)', LIVE_ANSWER_QUESTIONS.every((t) => jw.questions.some((q) => q.text === t)));
check('the host\'s lobby lists them', view(newGame(), 0, {}).liveAnswer.length === 4);
check('typed questions that do have an answer are still there', jw.questions.some((q) => q.type === 'number' && q.answer === 66));

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
