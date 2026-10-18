const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LET = 'ABCD';

// Keep clocks in sync with the server so every screen's timer matches.
let _offset = 0;
const serverNow = () => Date.now() + _offset;

// How often a screen asks for updates (milliseconds). Each ask is one Netlify Function call.
// Lower = snappier but more calls. During a question or a category pick we also check
// right when time runs out. During a long break the screens slow right down.
function pollDelay(S) {
  if (!S) return 1000;
  const t = S.phase === 'question' ? S.endsAt : S.phase === 'pick' && S.pick ? S.pick.endsAt : 0;
  if (t) {
    const untilClose = t + 450 - serverNow();
    return untilClose > 0 && untilClose < 1000 ? untilClose + 30 : 1000;
  }
  if (S.phase === 'between') {
    const b = S.between.breakEndsAt;
    return b && b - serverNow() > 70000 ? 5000 : 1500;
  }
  if (S.phase === 'lobby') return 1500;
  if (S.phase === 'reveal') return 1000;
  return 3000; // final
}

function startPolling({ url, onState, onStatus }) {
  let v = null, last = null, timer = null, busy = false, again = false;
  async function once() {
    if (busy) { again = true; return; }
    busy = true;
    clearTimeout(timer);
    const t0 = Date.now();
    try {
      const r = await fetch(url(v), { cache: 'no-store' });
      const s = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(s.error || 'Server error.');
      _offset = s.now - (t0 + Date.now()) / 2; // halve the round trip
      if (!s.unchanged) { v = s.v; last = s; onState(s); }
      onStatus && onStatus(true);
    } catch (e) {
      onStatus && onStatus(false, e instanceof TypeError ? '' : e.message);
    }
    busy = false;
    if (again) { again = false; v = null; return once(); }
    timer = setTimeout(once, Math.max(150, pollDelay(last)));
  }
  once();
  return {
    refresh() { v = null; once(); },          // ask for a full update right now
    reset() { v = null; last = null; once(); } // after the team id changes
  };
}

async function post(url, body, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body || {}),
  });
  let j = {};
  try { j = await r.json(); } catch (e) { /* empty body */ }
  if (!r.ok) {
    const err = new Error(j.error || 'Something went wrong.');
    err.status = r.status;
    err.code = j.code;
    throw err;
  }
  return j;
}

function showConn(ok, msg) {
  const el = $('#conn');
  el.hidden = ok;
  if (!ok) el.textContent = msg || 'Reconnecting…';
}

function meterHTML(n) {
  return '<div class="meter" id="meter" role="timer">' + '<i></i>'.repeat(n) + '</div>';
}

function timing(S) {
  if (S.phase === 'question') return { endsAt: S.endsAt, seconds: S.seconds };
  if (S.phase === 'pick' && S.pick) return { endsAt: S.pick.endsAt, seconds: S.pick.seconds };
  return null;
}

function tickMeter(S) {
  const m = $('#meter');
  const tm = S && timing(S);
  if (!m || !tm) return;
  const left = Math.max(0, tm.endsAt - serverNow());
  const frac = left / (tm.seconds * 1000);
  const lit = Math.ceil(frac * tm.seconds - 1e-9);
  const cls = frac > 0.5 ? '' : frac > 0.25 ? 'warm' : 'hot';
  [...m.children].forEach((el, i) => { el.className = i < lit ? 'on ' + cls : ''; });
  const s = $('#secs');
  if (s) s.textContent = Math.ceil(left / 1000);
}

// Break countdown (minutes:seconds)
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function tickBreak(S) {
  const el = $('#brk');
  if (!el || !S || !S.between || !S.between.breakEndsAt) return;
  const left = S.between.breakEndsAt - serverNow();
  el.textContent = fmtClock(left);
  const note = $('#brknote');
  if (note) note.textContent = left > 0 ? 'until the next round' : 'Break over. Waiting for the host to start the next round.';
}
function tickAll(S) { tickMeter(S); tickBreak(S); }

// A question picture is looked for in this order: first one the host uploaded on the picture page,
// then a file in /img/<name>.<ext> (png, jpg, webp or svg), which is also where the placeholders are.
const EXTS = ['upload', 'png', 'jpg', 'jpeg', 'webp', 'svg'];
const imgSrc = (base, ext) => (ext === 'upload' ? `/api/image?slot=${encodeURIComponent(base)}` : `/img/${base}.${ext}`);
const IMG_OK = {};
// Photo crops: while a question is open a photo can show only part of the picture.
// Regions are fractions of the picture (x, y, width, height); presets assume a normal
// head-and-shoulders portrait with the face roughly centred.
const CROPS = {
  eyes: { x: 0.14, y: 0.27, w: 0.72, h: 0.2 },
  smile: { x: 0.24, y: 0.56, w: 0.52, h: 0.22 },
  'half-left': { x: 0, y: 0.15, w: 0.5, h: 0.65 },
  'half-right': { x: 0.5, y: 0.15, w: 0.5, h: 0.65 },
};
// crop: preset name or region, or null for the whole picture. maxH: biggest height as a fraction of the screen.
function imgHTML(base, crop, maxH) {
  const e = IMG_OK[base] || EXTS[0];
  const c = crop ? ` data-crop="${esc(JSON.stringify(crop))}" data-maxh="${maxH || 0.4}"` : '';
  return `<div class="imgcard"${c}><img class="qimg" alt="Question image" src="${esc(imgSrc(base, e))}" data-b="${esc(base)}" data-i="${Math.max(0, EXTS.indexOf(e))}" onerror="imgErr(this)" onload="IMG_OK[this.dataset.b]=EXTS[+this.dataset.i];applyCrop(this)"></div>`;
}
function applyCrop(img) {
  const card = img.closest('.imgcard');
  if (!card || !card.dataset.crop) return;
  let spec; try { spec = JSON.parse(card.dataset.crop); } catch (e) { spec = null; }
  const r = typeof spec === 'string' ? CROPS[spec] : spec;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!r || !nw || !nh) { // cannot crop: show it whole rather than not at all
    card.style.width = card.style.height = '';
    img.style.cssText = 'position:static;width:auto;height:auto;max-width:100%;visibility:visible';
    return;
  }
  const ar = (r.w * nw) / (r.h * nh);
  const parent = card.parentElement;
  const avail = (parent.clientWidth || 340) / (parent.classList.contains('stage') ? 2.1 : 1) - 8;
  const maxH = window.innerHeight * (Number(card.dataset.maxh) || 0.4);
  const w = Math.max(120, Math.min(avail, maxH * ar, 560));
  const k = w / (r.w * nw);
  card.style.width = w + 'px';
  card.style.height = w / ar + 'px';
  img.style.cssText = `position:absolute;max-width:none;max-height:none;width:${nw * k}px;height:${nh * k}px;left:${-r.x * nw * k}px;top:${-r.y * nh * k}px;visibility:visible`;
}
function fixCrops() {
  document.querySelectorAll('.imgcard[data-crop] img').forEach((i) => { if (i.complete) applyCrop(i); });
}
window.addEventListener('resize', fixCrops);
function imgErr(el) {
  const i = +el.dataset.i + 1;
  if (i < EXTS.length) { el.dataset.i = i; el.src = imgSrc(el.dataset.b, EXTS[i]); return; }
  el.replaceWith(Object.assign(document.createElement('div'), { className: 'imgmissing', textContent: 'Image missing: img/' + el.dataset.b }));
}
const PRELOADED = new Set();
function preload(list) {
  const go = (b, i) => {
    if (i >= EXTS.length) return;
    const im = new Image();
    im.onload = () => { IMG_OK[b] = EXTS[i]; };
    im.onerror = () => go(b, i + 1);
    im.src = imgSrc(b, EXTS[i]);
  };
  for (const b of list || []) { if (!PRELOADED.has(b)) { PRELOADED.add(b); go(b, 0); } }
}
