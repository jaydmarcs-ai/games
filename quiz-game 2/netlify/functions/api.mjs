import { getStore } from '@netlify/blobs';
import { makeHandler } from '../../lib/handler.mjs';

// The whole game lives in one Netlify Blobs entry. "strong" consistency means every
// request sees the latest save, and the etag check stops two requests overwriting each other.
const KEY = 'game';
const blobs = () => getStore({ name: 'quiz-game', consistency: 'strong' });

const store = {
  async load() {
    const r = await blobs().getWithMetadata(KEY, { type: 'json' });
    return r ? { data: r.data, etag: r.etag } : null;
  },
  async save(data, etag) {
    return blobs().setJSON(KEY, data, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
  },
};

// Pictures the host uploads (logos and celebrity photos) live in their own store. Keys use "--" instead of "/".
const imgBlobs = () => getStore({ name: 'quiz-images', consistency: 'strong' });
const key = (slot) => slot.replace('/', '--');
const images = {
  async get(slot) {
    const r = await imgBlobs().getWithMetadata(key(slot), { type: 'arrayBuffer' });
    return r ? { data: r.data, contentType: (r.metadata && r.metadata.contentType) || 'image/png' } : null;
  },
  async put(slot, bytes, contentType) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await imgBlobs().set(key(slot), buf, { metadata: { contentType } });
  },
  async del(slot) { await imgBlobs().delete(key(slot)); },
  async list() {
    const { blobs } = await imgBlobs().list();
    return blobs.map((b) => b.key.replace('--', '/'));
  },
};

// Questions the host edited live in their own entry. Reads are cached for a few seconds (the screens ask
// about once a second); saving, or asking for a fresh copy, skips the cache.
const quizBlobs = () => getStore({ name: 'quiz-content', consistency: 'strong' });
let quizCache = null, quizCachedAt = 0;
const quiz = {
  async load(fresh) {
    if (!fresh && quizCachedAt && Date.now() - quizCachedAt < 5000) return quizCache;
    quizCache = await quizBlobs().get('quiz', { type: 'json' });
    quizCachedAt = Date.now();
    return quizCache;
  },
  async save(q) { await quizBlobs().setJSON('quiz', q); quizCache = q; quizCachedAt = Date.now(); },
  async clear() { await quizBlobs().delete('quiz'); quizCache = null; quizCachedAt = Date.now(); },
};

export default async (req) =>
  makeHandler(store, {
    images,
    quiz,
    adminPin: process.env.ADMIN_PIN,
    adminName: process.env.ADMIN_NAME || 'Ibrahim',
  })(req);

export const config = { path: '/api/*' };
