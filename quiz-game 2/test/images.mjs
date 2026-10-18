// The host's picture uploads: who may upload, what is accepted, and how pictures are served.
import { makeHandler } from '../lib/handler.mjs';
import { IMAGE_SLOTS } from '../lib/game.mjs';

const mem = new Map();   // stand-in for the picture store in Netlify Blobs
const images = {
  async get(slot) { return mem.has(slot) ? { data: mem.get(slot).bytes, contentType: mem.get(slot).type } : null; },
  async put(slot, bytes, type) { mem.set(slot, { bytes: Buffer.from(bytes), type }); },
  async del(slot) { mem.delete(slot); },
  async list() { return [...mem.keys()]; },
};
let blob = null;
const store = { async load() { return blob; }, async save(d) { blob = { data: JSON.parse(JSON.stringify(d)), etag: String(Math.random()) }; return { modified: true }; } };
const h = makeHandler(store, { adminPin: '4321', adminName: 'Ibrahim', images });

const call = async (method, path, body, pin = '4321') => {
  const res = await h(new Request('http://x/api/' + path, { method, headers: { 'content-type': 'application/json', ...(pin ? { 'x-admin-key': pin } : {}) }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined }));
  return res;
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
const put = (slot, bytes, contentType, pin) => call('POST', 'admin/imageput', { slot, contentType, data: bytes.toString('base64') }, pin);

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };

check('there are 38 picture slots: 20 logos and 18 faces', IMAGE_SLOTS.length === 38 && IMAGE_SLOTS.filter((s) => s.slot.startsWith('logos/')).length === 20 && IMAGE_SLOTS.filter((s) => s.slot.startsWith('faces/')).length === 18);
check('uploading needs the admin PIN', (await put('logos/01', PNG, 'image/png', '0000')).status === 401 && (await put('logos/01', PNG, 'image/png', null)).status === 401);
check('the slot list needs the admin PIN', (await call('POST', 'admin/slots', {}, '1111')).status === 401);

let r = await call('POST', 'admin/slots', {});
let j = await r.json();
check('the host sees every slot with its answer, nothing uploaded yet', r.status === 200 && j.slots.length === 38 && j.slots[0].label === 'Safaricom' && j.slots.every((s) => s.uploaded === false));
check('face slots say how they will be cropped', j.slots.find((s) => s.slot === 'faces/01').crop === 'eyes' && j.slots.find((s) => s.slot === 'logos/01').crop === null);

check('before an upload, the public picture route says 404 (so the screens use the placeholder)', (await call('GET', 'image?slot=logos/01', null, null)).status === 404);
check('a PNG uploads', (await put('logos/01', PNG, 'image/png')).status === 200);
r = await call('GET', 'image?slot=logos/01', null, null);
check('anyone can view it, with the right type and the exact bytes', r.status === 200 && r.headers.get('content-type') === 'image/png' && Buffer.from(await r.arrayBuffer()).equals(PNG));
check('it is served so a browser re-checks it every time and cannot run scripts from it', r.headers.get('cache-control') === 'no-cache' && /sandbox/.test(r.headers.get('content-security-policy')) && r.headers.get('x-content-type-options') === 'nosniff');
check('a JPG uploads to a face slot', (await put('faces/03', JPG, 'image/jpeg')).status === 200);
check('an SVG uploads', (await put('logos/02', SVG, 'image/svg+xml')).status === 200 && (await (await call('GET', 'image?slot=logos/02', null, null)).arrayBuffer()).byteLength === SVG.length);

check('a slot that is not in the game is refused', (await put('logos/99', PNG, 'image/png')).status === 400 && (await put('../secret', PNG, 'image/png')).status === 400);
check('a slot that is not in the game cannot be read either', (await call('GET', 'image?slot=logos/99', null, null)).status === 404 && (await call('GET', 'image?slot=../x', null, null)).status === 404);
check('a file type that is not a picture is refused', (await put('logos/03', Buffer.from('hello'), 'text/html')).status === 400);
check('a text file pretending to be a PNG is refused', (await put('logos/03', Buffer.from('<script>alert(1)</script>'), 'image/png')).status === 400);
check('a PNG labelled as a JPG is refused', (await put('logos/03', PNG, 'image/jpeg')).status === 400);
check('an empty upload is refused', (await call('POST', 'admin/imageput', { slot: 'logos/03', contentType: 'image/png', data: '' })).status === 400);
check('a picture that is too big is refused', (await call('POST', 'admin/imageput', { slot: 'logos/03', contentType: 'image/png', data: 'A'.repeat(5_600_000) })).status === 413);
check('a refused upload leaves nothing behind', (await call('GET', 'image?slot=logos/03', null, null)).status === 404);

j = await (await call('POST', 'admin/slots', {})).json();
check('the host now sees 3 pictures uploaded', j.slots.filter((s) => s.uploaded).map((s) => s.slot).sort().join() === 'faces/03,logos/01,logos/02');
check('uploading again replaces the picture', (await put('logos/01', JPG, 'image/jpeg')).status === 200 && (await call('GET', 'image?slot=logos/01', null, null)).headers.get('content-type') === 'image/jpeg');
check('a picture can be removed', (await call('POST', 'admin/imagedelete', { slot: 'logos/01' })).status === 200 && (await call('GET', 'image?slot=logos/01', null, null)).status === 404);
check('removing needs the PIN too', (await call('POST', 'admin/imagedelete', { slot: 'logos/02' }, '0000')).status === 401 && mem.has('logos/02'));

const bare = makeHandler(store, { adminPin: '4321', adminName: 'x' });   // no picture store
check('without a picture store, the page is told plainly', (await bare(new Request('http://x/api/admin/slots', { method: 'POST', headers: { 'x-admin-key': '4321' }, body: '{}' }))).status === 501);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
