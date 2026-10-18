// Today's card: nine called shots, the same for everyone on a given day, and which of the nine is the golden ball.
// Hit the called hole and that ball scores double; the golden ball scores double too, so a called shot with it is ×4.
// The day is the player's own calendar day, so the card changes at their midnight.

// How often each hole gets called: mostly the middle rings, a 50 now and then, a 100 rarely.
const DRAW = [20, 20, 30, 30, 30, 40, 40, 40, 50, 50, 100];

export function dayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayBefore(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12));
}

// A small seeded random from the date (FNV-1a into mulberry32), so every phone draws the same card.
function seeded(text) {
  let h = 2166136261;
  for (const c of text) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function cardFor(key) {
  const r = seeded('roll-up:' + key);
  const calls = [];
  let hundreds = 0;
  while (calls.length < 9) {
    const v = DRAW[Math.floor(r() * DRAW.length)];
    if (v === 100 && hundreds) continue; // one 100 a day at most
    if (v === 100) hundreds++;
    calls.push(v);
  }
  return { key, calls, golden: Math.floor(r() * 9) };
}

// What a ball is worth: its hole, doubled for a called shot, doubled again for the golden ball.
export function points(value, { call = null, golden = false } = {}) {
  const hit = call != null && value === call;
  return { points: value * (hit ? 2 : 1) * (golden ? 2 : 1), hit };
}

// The line to send someone: the day, the score, and a star for each call hit.
export function shareLine(key, score, marks) {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(y, m - 1, d, 12).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `Roll Up · ${day} · ${score}\n${marks.map(h => (h ? '★' : '☆')).join('')}\nroll-up.junkdrawer.works`;
}
