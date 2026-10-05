const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LET = 'ABCD';

// Keep clocks in sync with the server so every screen's timer matches.
let _offset = 0;
const serverNow = () => Date.now() + _offset;

// How often a screen asks for updates (milliseconds). Each ask is one Netlify Function call.
// Lower = snappier but more calls. During a question we also check right when time runs out.
function pollDelay(S) {
  if (!S) return 1000;
  if (S.phase === 'question') {
    const untilClose = S.endsAt + 450 - serverNow();
    return untilClose > 0 && untilClose < 1000 ? untilClose + 30 : 1000;
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

function tickMeter(S) {
  const m = $('#meter');
  if (!m || !S || S.phase !== 'question') return;
  const left = Math.max(0, S.endsAt - serverNow());
  const frac = left / (S.seconds * 1000);
  const lit = Math.ceil(frac * S.seconds - 1e-9);
  const cls = frac > 0.5 ? '' : frac > 0.25 ? 'warm' : 'hot';
  [...m.children].forEach((el, i) => { el.className = i < lit ? 'on ' + cls : ''; });
  const s = $('#secs');
  if (s) s.textContent = Math.ceil(left / 1000);
}
