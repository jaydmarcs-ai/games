import { timingSafeEqual } from 'node:crypto';
import { HttpError, newGame, normalize, tick, view, join, leave, answer, pickByTeam, admin } from './game.mjs';

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: HEADERS });

/**
 * store: { load(): Promise<{data, etag}|null>, save(data, etag|null): Promise<{modified?:boolean}> }
 * opts:  { adminPin, adminName, now() }
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

  return async function handle(req) {
    try {
      if (!opts.adminPin) {
        throw new HttpError(500, 'ADMIN_PIN is not set. Add it under Site configuration > Environment variables in Netlify, then redeploy.');
      }
      const url = new URL(req.url);
      const route = url.pathname.replace(/^\/api\/?/, '');

      if (req.method === 'GET' && route === 'state') return json(200, await readState(url));
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');

      const body = await req.json().catch(() => ({}));
      if (route.startsWith('admin/')) {
        if (!adminOk(req.headers.get('x-admin-key'))) throw new HttpError(401, 'Wrong admin PIN.');
        const action = route.slice('admin/'.length);
        if (action === 'check') return json(200, { ok: true });
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
