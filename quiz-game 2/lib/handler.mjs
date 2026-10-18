import { timingSafeEqual } from 'node:crypto';
import { HttpError, newGame, normalize, tick, view, join, leave, answer, pickByTeam, admin, IMAGE_SLOTS, IMAGE_SLOT_SET } from './game.mjs';

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
// The kinds of picture the host can upload, each with a check on the file's first bytes.
const IMAGE_TYPES = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  'image/svg+xml': (b) => /<svg[\s>]/i.test(b.toString('utf8', 0, Math.min(b.length, 2000))),
};
const MAX_IMAGE_BASE64 = 5_500_000; // a little under Netlify's 6 MB request limit
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: HEADERS });

/**
 * store: { load(): Promise<{data, etag}|null>, save(data, etag|null): Promise<{modified?:boolean}> }
 * opts:  { adminPin, adminName, now(), images }
 *   images (optional): { get(slot) -> {data, contentType}|null, put(slot, bytes, contentType), del(slot), list() -> [slot] }
 */
export function makeHandler(store, opts) {
  const now = opts.now || (() => Date.now());

  function adminOk(key) {
    const a = Buffer.from(String(key || ''));
    const b = Buffer.from(String(opts.adminPin));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // Load, change, save. If another request saved in between (etag mismatch), run again.
  async function mutate(fn) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const cur = await store.load();
      const g = normalize(cur ? cur.data : newGame());
      const t = now();
      tick(g, t);
      const out = fn(g, t);
      g.v = (g.v || 0) + 1;
      const res = await store.save(g, cur ? cur.etag : null);
      if (!res || res.modified !== false) return { out, g, t };
    }
    throw new HttpError(503, 'The game is busy. Try again in a moment.');
  }

  async function readState(url) {
    const cur = await store.load();
    let g = normalize(cur ? cur.data : newGame());
    let t = now();
    if (tick(structuredClone(g), t)) ({ g, t } = await mutate(() => {})); // time ran out: close the round
    const who = { teamId: url.searchParams.get('teamId'), deviceId: url.searchParams.get('deviceId') };
    // Nothing changed since this screen last looked: send a tiny reply.
    if (String(g.v) === url.searchParams.get('since')) return { unchanged: true, v: g.v, now: t };
    return { ...view(g, t, who), adminName: opts.adminName };
  }

  // The host's picture page: list the slots, upload a picture, remove a picture.
  async function pictures(action, body) {
    if (!opts.images) throw new HttpError(501, 'Picture uploads are not available here.');
    if (action === 'slots') {
      const have = new Set(await opts.images.list());
      return { slots: IMAGE_SLOTS.map((s) => ({ ...s, uploaded: have.has(s.slot) })) };
    }
    const slot = String(body.slot || '');
    if (!IMAGE_SLOT_SET.has(slot)) throw new HttpError(400, 'Unknown picture slot.');
    if (action === 'imagedelete') { await opts.images.del(slot); return { ok: true }; }
    const type = String(body.contentType || '');
    if (!IMAGE_TYPES[type]) throw new HttpError(400, 'Use a PNG, JPG, WEBP or SVG picture.');
    if (typeof body.data !== 'string' || !body.data) throw new HttpError(400, 'No picture received.');
    if (body.data.length > MAX_IMAGE_BASE64) throw new HttpError(413, 'That picture is too big. Try a smaller one.');
    const bytes = Buffer.from(body.data, 'base64');
    if (!bytes.length || !IMAGE_TYPES[type](bytes)) throw new HttpError(400, 'That file is not a valid ' + type.replace('image/', '').toUpperCase() + ' picture.');
    await opts.images.put(slot, bytes, type);
    return { ok: true, bytes: bytes.length };
  }

  return async function handle(req) {
    try {
      if (!opts.adminPin) {
        throw new HttpError(500, 'ADMIN_PIN is not set. Add it under Site configuration > Environment variables in Netlify, then redeploy.');
      }
      const url = new URL(req.url);
      const route = url.pathname.replace(/^\/api\/?/, '');

      if (req.method === 'GET' && route === 'state') return json(200, await readState(url));

      // A question picture the host uploaded. Public, because the teams' phones load it.
      if (req.method === 'GET' && route === 'image') {
        const slot = url.searchParams.get('slot') || '';
        if (!opts.images || !IMAGE_SLOT_SET.has(slot)) throw new HttpError(404, 'No such picture.');
        const img = await opts.images.get(slot);
        if (!img) throw new HttpError(404, 'No picture uploaded for this one yet.');
        return new Response(img.data, {
          status: 200,
          headers: {
            'Content-Type': img.contentType,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        });
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');

      const body = await req.json().catch(() => ({}));
      if (route.startsWith('admin/')) {
        if (!adminOk(req.headers.get('x-admin-key'))) throw new HttpError(401, 'Wrong admin PIN.');
        const action = route.slice('admin/'.length);
        if (action === 'check') return json(200, { ok: true });
        if (['slots', 'imageput', 'imagedelete'].includes(action)) return json(200, await pictures(action, body));
        const { out } = await mutate((g, t) => admin(g, action, body, t));
        return json(200, out);
      }
      if (route === 'join') return json(200, (await mutate((g) => join(g, body))).out);
      if (route === 'leave') return json(200, (await mutate((g) => leave(g, body.deviceId))).out);
      if (route === 'answer') return json(200, (await mutate((g, t) => answer(g, body, t))).out);
      if (route === 'pick') return json(200, (await mutate((g, t) => pickByTeam(g, body, t))).out);
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message, code: e.code });
      console.error(e);
      return json(500, { error: 'Server error.' });
    }
  };
}
