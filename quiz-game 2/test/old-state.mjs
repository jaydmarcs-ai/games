// Game state saved by an older deployed version must still work (Netlify keeps state between deploys).
import { makeHandler } from '../lib/handler.mjs';
// State exactly as the FIRST deployed version saved it (no rounds, no pickCursor, no team.base)
let blob = { data: {
  v: 7, phase: 'lobby', qIndex: -1, startedAt: 0, endsAt: 0, seconds: 20, reveal: null, final: null,
  teams: {
    tAAAAAA: { id:'tAAAAAA', name:'Alpha', deviceId:'dA', members:['Sam','Aisha'], turns:[0,0], score:0, correct:0, totalMs:0, answer:null },
    tBBBBBB: { id:'tBBBBBB', name:'Beta',  deviceId:'dB', members:['Lina'],        turns:[0],   score:0, correct:0, totalMs:0, answer:null },
  } }, etag: '1' };
let n = 1;
const store = {
  async load() { return { data: JSON.parse(JSON.stringify(blob.data)), etag: blob.etag }; },   // JSON, like Netlify Blobs
  async save(d, e) { if (e !== blob.etag) return { modified: false }; blob = { data: JSON.parse(JSON.stringify(d)), etag: String(++n) }; return { modified: true }; },
};
let clock = 5_000_000;
const h = makeHandler(store, { adminPin: '4321', adminName: 'Ibrahim', now: () => clock });
const call = async (m, p, b, hd = {}) => { const r = await h(new Request('http://x/api/' + p, { method: m, headers: { 'content-type': 'application/json', ...hd }, body: m === 'POST' ? JSON.stringify(b || {}) : undefined })); return { s: r.status, b: await r.json() }; };
const adm = (a, b) => call('POST', 'admin/' + a, b, { 'x-admin-key': '4321' });
console.log('start', (await adm('start')).s);
for (let i = 0; i < 30; i++) {
  for (const [id, d] of [['tAAAAAA','dA'], ['tBBBBBB','dB']]) await call('POST', 'answer', { teamId: id, deviceId: d, choice: 0 });
  const r = await adm('next'); if (r.s !== 200) { console.log('next failed at', i, r); break; }
}
console.log('phase after round 1:', (await call('GET', 'state')).b.phase);
const r2 = await adm('startround');
const st = (await call('GET', 'state')).b;
let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
check('round 2 starts from state saved by the first version', r2.s === 200 && st.phase === 'pick');
check('a team is asked to choose the category', Boolean(st.pick && st.pick.chooserName));
console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exit(failed ? 1 : 0);
