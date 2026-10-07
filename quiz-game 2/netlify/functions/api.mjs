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

export default async (req) =>
  makeHandler(store, {
    adminPin: process.env.ADMIN_PIN,
    adminName: process.env.ADMIN_NAME || 'Ibrahim',
  })(req);

export const config = { path: '/api/*' };
