// Roll Up: skee-ball. This file runs the game: the turns, the flick, the score, the tickets and the prize counter.
// js/physics.js moves the ball, js/scene.js draws it and js/sound.js makes the noises.

import * as phys from './physics.js';
import { createScene } from './scene.js';
import * as sound from './sound.js';
import { PRIZES, ticketsFor } from './prizes.js';
import { dayKey, dayBefore, cardFor, points, shareLine } from './daily.js';

const $ = id => document.getElementById(id);
const KEY = 'roll-up.v1';
const BALLS = 9;
const { LANE, R } = phys;

// How a flick becomes a roll. The finger's speed along the lane (cm/s, measured where the ball is) is eased,
// so the firmer rolls that reach the 40 and the 50 get a wider range of flicks than the 20 does,
// and the hardest flick tops out a little past the 50, into the 10.
const FLICK = { window: 90, min: 70, top: 420, ease: 480, aim: 0.85, maxAngle: 0.32 };
const power = speed => FLICK.top * (1 - Math.exp(-speed / FLICK.ease));

// ---------- what's kept between visits ----------
const saved = load();
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* none yet, or storage is off */ }
  return { best: 0, tickets: 0, games: 0, prizes: {}, sound: true, ...(s && typeof s === 'object' ? s : {}) };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage full or off: the game still plays */ }
}
sound.setEnabled(saved.sound);

// ---------- the scene ----------
const canvas = $('stage');
const scene = createScene(canvas);
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
document.body.append(probe);
function layout() {
  const cs = getComputedStyle(probe);
  const hud = document.querySelector('.hud').getBoundingClientRect();
  scene.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1), {
    top: Math.max(hud.bottom + 4, 56),
    bottom: parseFloat(cs.paddingBottom) + 4,
  });
}
addEventListener('resize', layout);
layout();
if (document.fonts) document.fonts.load('400 20px Bungee').then(() => scene.repaint()).catch(() => {});

// ---------- the game ----------
let mode = 'title';          // title → aim ⇄ drag → roll → result → (deal → aim) … → over
// balls: what each ball did, { value, points, golden, call, hit }. card: today's card, for a daily game.
let game = { thrown: 0, score: 0, balls: [], golden: -1, card: null };
let ball = phys.newBall(0);
let handX = 0;
let shown = 0;               // the score on the board, counting up to game.score
let resultT = 0, deal = null, drag = null, charge = null, thrownOnce = false;
let paused = false, timeScale = 1;
let zoom = 0;                // 0: the whole machine; 1: pushed in on the board while the ball's up there
const pops = [];
let flash = null;
const lights = { mode: 'idle', t: 0 };

function newGame(daily = false) {
  const card = daily ? cardFor(dayKey()) : null;
  // one ball of the nine is golden: today's card says which, otherwise it's a surprise
  game = { thrown: 0, score: 0, balls: [], card, golden: card ? card.golden : Math.floor(Math.random() * BALLS) };
  shown = 0;
  ball = phys.newBall(handX);
  ball.golden = game.golden === 0;
  pops.length = 0; flash = null;
  lights.mode = 'idle';
  mode = 'aim';
  hud();
}

function trayCount() {
  if (mode === 'title') return BALLS - 1;
  if (mode === 'result' || mode === 'over') return BALLS - game.thrown;
  return BALLS - game.thrown - 1;
}
// Which tray spot holds the golden ball, if it's still waiting. The next ball is the last spot in the row.
function trayGold() {
  if (mode === 'title') return -1;
  const n = trayCount(), first = mode === 'result' || mode === 'over' ? game.thrown : game.thrown + 1;
  const i = n - 1 - (game.golden - first);
  return i >= 0 && i < n ? i : -1;
}
const callNow = () => (game.card && ['aim', 'drag', 'roll', 'deal'].includes(mode) ? game.card.calls[game.thrown] : null);

// What a ball that dropped into `value` is worth this time, and what the pop-up says about it.
function worth(value) {
  const call = game.card ? game.card.calls[game.thrown] : null;
  const w = points(value, { call, golden: ball.golden });
  const why = [w.hit && 'called', ball.golden && value && 'golden'].filter(Boolean);
  w.call = call;
  w.sub = why.length === 2 ? 'called + gold ×4' : why.length ? `${why[0]} ×2` : null;
  w.subColor = w.hit ? '#5ee6d8' : '#ffd36a';
  return w;
}

function throwBall(vx, vz) {
  phys.launch(ball, vx, vz);
  mode = 'roll';
  thrownOnce = true;
  handX = ball.x;
  hud();
}

// The ball is done: it dropped in a hole, fell in the trough, or didn't make the jump.
function scored() {
  const v = ball.value;
  const w = worth(v);
  if (!ball.hole) {
    // a hole already rang its bell and showed its number as the ball dropped in
    const at = ball.why === 'short'
      ? { x: ball.x, y: phys.ground(LANE.foul + 30) + 8, z: LANE.foul + 30 }
      : { x: ball.x, y: phys.BOARD.y0 + 4, z: phys.JUMP.z1 + 8 };
    pops.push({ text: v ? '+' + w.points : 'No jump', sub: w.sub, subColor: w.subColor, ...at, age: 0, big: false });
    sound.score(v);
    lights.mode = 'score'; lights.t = 0;
  }
  game.score += w.points;
  game.balls.push({ value: v, points: w.points, golden: !!ball.golden, call: w.call, hit: w.hit });
  game.thrown++;
  const left = BALLS - game.thrown;
  const extra = w.hit ? ', the called shot' : '';
  $('live').textContent = `${w.points} points${extra}. ${game.score} so far, ${left ? left + (left === 1 ? ' ball' : ' balls') + ' left' : 'game over'}.`;
  mode = 'result';
  resultT = 0;
  hud();
}

function intoHole(hole) {
  const p = phys.fromBoard(hole.u, hole.s, 3);
  const w = worth(hole.value);
  pops.push({ text: '+' + w.points, sub: w.sub, subColor: w.subColor, ...p, age: 0, big: w.points >= 50 });
  flash = { hole, t: 0 };
  sound.drop();
  sound.score(w.hit || ball.golden ? Math.max(50, hole.value) : hole.value);
  lights.mode = hole.value === 100 || w.hit ? 'win' : 'score'; lights.t = 0;
  if (navigator.vibrate) try { navigator.vibrate(hole.value >= 50 ? [18, 40, 18] : 12); } catch { /* not allowed */ }
}

function nextBall() {
  const from = scene.traySpot(BALLS - game.thrown - 1);
  ball = phys.newBall(handX);
  ball.golden = game.golden === game.thrown;
  deal = { t: 0, from, to: { x: ball.x, y: ball.y, z: ball.z } };
  ball.x = from.x; ball.y = from.y; ball.z = from.z;
  mode = 'deal';
  hud();
}

function gameOver() {
  mode = 'over';
  const won = ticketsFor(game.score);
  const first = saved.games === 0;
  const result = { score: game.score, balls: game.balls, won };
  saved.tickets += won; saved.games++;
  if (game.card) {
    // today's card: kept for the title card and the share line, with the run of days played
    const key = game.card.key, prev = saved.daily;
    result.key = key;
    result.streak = prev && prev.key === dayBefore(key) ? (prev.streak || 1) + 1 : 1;
    saved.daily = result;
  } else {
    result.isBest = game.score > saved.best && !first;
    if (game.score > saved.best) saved.best = game.score;
  }
  save();
  dailyButton();
  showOver(result, true);
  if (result.isBest) { lights.mode = 'win'; lights.t = 0; }
  sound.fanfare();
}

// The game-over card, for a game just finished (the tickets feed out) or for today's card played earlier.
let feeding = 0;
function showOver(r, fresh) {
  const daily = !!r.key;
  $('overT').textContent = daily ? `Today's card, ${r.score} points` : `Nine balls, ${r.score} points`;
  $('tally').replaceChildren(...r.balls.map(b => {
    const c = document.createElement('span');
    c.textContent = b.points;
    c.className = [b.golden && 'golden', b.hit && 'called', !b.golden && b.value >= 50 && 'hi'].filter(Boolean).join(' ');
    c.title = [b.hit && 'called shot', b.golden && 'golden ball'].filter(Boolean).join(', ');
    return c;
  }));
  $('stars').hidden = !daily;
  if (daily) {
    const hits = r.balls.filter(b => b.hit).length;
    $('stars').innerHTML = '';
    const b = document.createElement('b');
    b.textContent = r.balls.map(x => (x.hit ? '★' : '☆')).join('');
    $('stars').append(b, `${hits} of 9 calls${r.streak > 1 ? ` · ${r.streak} days in a row` : ''}`);
  }
  $('overBest').textContent = daily ? 'A new card comes at midnight.' : r.isBest ? 'A new best.' : `Best: ${saved.best}`;
  $('share').hidden = !daily;
  $('again').textContent = daily ? 'Play' : 'Roll again';
  $('wonWord').textContent = r.won === 1 ? 'ticket' : 'tickets';
  $('over').hidden = false;
  $('title').hidden = true;
  // the tickets come out of the slot one by one, and the strip grows
  const strip = $('strip');
  const show = n => {
    $('won').textContent = n;
    strip.style.height = Math.min(n, 7) * 22 + (n ? 4 : 0) + 'px';
    strip.style.backgroundPositionY = n * 22 + 'px';
  };
  clearTimeout(feeding);
  if (!fresh) { show(r.won); return; }
  let n = 0;
  show(0);
  const step = () => {
    if (mode !== 'over') return;
    n = Math.min(r.won, n + Math.max(1, Math.round(r.won / 40)));
    show(n);
    sound.ticket();
    if (n < r.won) feeding = setTimeout(step, 55);
    else hud();
  };
  feeding = setTimeout(step, 500);
  $('again').focus({ preventScroll: true });
}

// ---------- the scoreboard ----------
function hud() {
  $('score').textContent = Math.round(shown);
  const n = mode === 'result' || mode === 'over' ? game.thrown : game.thrown + 1;
  $('ballNo').textContent = mode === 'over' ? 'Game over' : `Ball ${Math.min(BALLS, Math.max(1, n))} of ${BALLS}`;
  $('tix').textContent = saved.tickets;
  $('hint').hidden = !(mode === 'aim' && !thrownOnce);
  const ready = ['aim', 'drag', 'deal'].includes(mode);
  const call = callNow();
  $('callNote').hidden = !(ready && call);
  if (call) $('callV').textContent = call;
  $('goldNote').hidden = !(ready && ball.golden);
}

// ---------- flicking the ball ----------
function sample(e) {
  const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of list.length ? list : [e]) {
    const w = scene.unproject(ev.clientX, ev.clientY);
    if (w) drag.samples.push({ t: ev.timeStamp, x: w.x, z: w.z });
  }
  if (drag.samples.length > 40) drag.samples.splice(0, drag.samples.length - 40);
}

canvas.addEventListener('pointerdown', e => {
  sound.unlock();
  if (mode !== 'aim' || paused || charge) return;
  const w = scene.unproject(e.clientX, e.clientY);
  if (!w || w.z > LANE.foul + 50) return; // a touch up by the board isn't a grab
  drag = { id: e.pointerId, off: { x: ball.x - w.x, z: ball.z - w.z }, samples: [] };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* fine without */ }
  mode = 'drag';
  sample(e);
  e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
  if (mode !== 'drag' || !drag || e.pointerId !== drag.id) return;
  sample(e);
  const last = drag.samples[drag.samples.length - 1];
  if (!last) return;
  const lim = LANE.half - R - 0.5;
  ball.x = Math.max(-lim, Math.min(lim, last.x + drag.off.x));
  const z = last.z + drag.off.z;
  ball.z = Math.max(LANE.start - 12, Math.min(LANE.foul, z));
  ball.y = phys.ground(ball.z) + R;
  if (z >= LANE.foul) release(); // over the line: it's gone
});
canvas.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id) release(); });
canvas.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) { drag = null; settle(); } });

function release() {
  const s = drag.samples;
  drag = null;
  if (s.length < 2) return settle();
  const last = s[s.length - 1];
  let i = s.length - 2;
  while (i > 0 && last.t - s[i - 1].t <= FLICK.window) i--;
  const first = s[i], dt = (last.t - first.t) / 1000;
  if (dt <= 0.004) return settle();
  const vx = (last.x - first.x) / dt, vz = (last.z - first.z) / dt;
  if (vz < FLICK.min) return settle();
  const speed = power(Math.hypot(vx, vz));
  const ang = Math.max(-FLICK.maxAngle, Math.min(FLICK.maxAngle, Math.atan2(vx, vz) * FLICK.aim));
  throwBall(speed * Math.sin(ang), speed * Math.cos(ang));
}

// Not a throw: the ball goes back to its spot behind the line, where the finger left it across the lane.
function settle() {
  handX = ball.x;
  ball.z = LANE.start;
  ball.y = phys.ground(ball.z) + R;
  mode = 'aim';
}

// The keyboard: arrows move the ball, Space winds up and lets go.
const chargeLevel = () => { const p = ((performance.now() - charge.t0) / 1500) % 2; return p < 1 ? p : 2 - p; };
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('button, a') && (e.key === ' ' || e.key === 'Enter')) return;
  if (e.key === 'Escape') { if (!$('prizes').hidden) closePrizes(); else toggleMenu(); return; }
  if (paused || !$('prizes').hidden) return;
  if (mode === 'title' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); start(); return; }
  if (mode !== 'aim') return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const lim = LANE.half - R - 0.5;
    ball.x = Math.max(-lim, Math.min(lim, ball.x + (e.key === 'ArrowLeft' ? -1.6 : 1.6)));
    handX = ball.x;
    e.preventDefault();
  } else if ((e.key === ' ' || e.key === 'ArrowUp') && !e.repeat && !charge) {
    sound.unlock();
    charge = { t0: performance.now() };
    e.preventDefault();
  }
});
addEventListener('keyup', e => {
  if (!charge || (e.key !== ' ' && e.key !== 'ArrowUp')) return;
  const k = chargeLevel();
  charge = null;
  if (mode === 'aim') throwBall(0, 190 + k * 320);
});

// ---------- cards ----------
function start(daily = false) {
  sound.unlock();
  $('title').hidden = true;
  $('over').hidden = true;
  newGame(daily);
}
$('play').addEventListener('click', () => start());
$('again').addEventListener('click', () => start());

// Today's card: play it once a day; after that the button shows how it went.
function dailyButton() {
  const d = saved.daily, done = d && d.key === dayKey();
  $('daily').classList.toggle('done', !!done);
  $('daily').textContent = done ? `Today: ${d.score}` : "Today's card";
  $('dailyHow').textContent = done
    ? `${d.balls.filter(b => b.hit).length} of 9 calls${d.streak > 1 ? `, ${d.streak} days in a row` : ''}. A new card comes at midnight.`
    : 'Nine called shots, the same for everyone today. Hit the call for double.';
}
$('daily').addEventListener('click', () => {
  sound.unlock();
  const d = saved.daily;
  if (d && d.key === dayKey()) showOver(d, false);
  else start(true);
});
dailyButton();

$('share').addEventListener('click', async () => {
  const d = saved.daily;
  if (!d) return;
  const text = shareLine(d.key, d.score, d.balls.map(b => b.hit));
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it anywhere.'); }
  catch { toast(text.replace(/\n/g, '  ')); }
});

function toggleMenu(open = $('menu').hidden) {
  $('menu').hidden = !open;
  paused = open;
  if (open) { drag = null; charge = null; if (mode === 'drag') settle(); $('resume').focus({ preventScroll: true }); }
}
$('menuBtn').addEventListener('click', () => { sound.unlock(); toggleMenu(); });
$('resume').addEventListener('click', () => toggleMenu(false));
$('restart').addEventListener('click', () => { toggleMenu(false); newGame(!!game.card); });
$('sound').addEventListener('click', () => {
  saved.sound = !saved.sound; save();
  sound.setEnabled(saved.sound);
  soundLabel();
});
function soundLabel() {
  $('sound').textContent = `Sound: ${saved.sound ? 'on' : 'off'}`;
  $('sound').setAttribute('aria-pressed', String(saved.sound));
}
soundLabel();

// ---------- the prize counter ----------
let toastTimer = 0;
function openPrizes() {
  renderPrizes();
  $('prizes').hidden = false;
  paused = true;
  $('closePrizes').focus({ preventScroll: true });
}
function closePrizes() {
  $('prizes').hidden = true;
  paused = !$('menu').hidden;
}
$('tixBtn').addEventListener('click', () => { sound.unlock(); if (mode === 'drag') settle(); openPrizes(); });
for (const id of ['toPrizes', 'overPrizes', 'menuPrizes']) $(id).addEventListener('click', openPrizes);
$('closePrizes').addEventListener('click', closePrizes);
$('prizes').addEventListener('click', e => { if (e.target === $('prizes')) closePrizes(); });

function renderPrizes() {
  $('bal').textContent = saved.tickets;
  const shelf = $('shelf');
  shelf.replaceChildren();
  const owned = PRIZES.filter(p => saved.prizes[p.id]);
  if (!owned.length) {
    const e = document.createElement('span'); e.className = 'empty';
    e.textContent = saved.games ? 'Nothing yet. Pick something below.' : 'Nothing yet. Play a game to win some tickets.';
    shelf.append(e);
  }
  for (const p of owned) {
    const s = document.createElement('span');
    s.textContent = p.emoji; s.title = p.name;
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', saved.prizes[p.id] > 1 ? `${saved.prizes[p.id]} × ${p.name}` : p.name);
    if (saved.prizes[p.id] > 1) { const n = document.createElement('sub'); n.textContent = saved.prizes[p.id]; s.append(n); }
    shelf.append(s);
  }
  const grid = $('grid');
  grid.replaceChildren();
  for (const p of PRIZES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'prize' + (saved.tickets < p.cost ? ' short' : '');
    b.innerHTML = `<span class="e" aria-hidden="true"></span><span class="n"></span><span class="c"><svg aria-hidden="true"><use href="#ticket"/></svg></span>`;
    b.querySelector('.e').textContent = p.emoji;
    b.querySelector('.n').textContent = p.name;
    b.querySelector('.c').append(String(p.cost));
    b.setAttribute('aria-label', `${p.name}, ${p.cost} tickets`);
    b.addEventListener('click', () => buy(p));
    grid.append(b);
  }
  hud();
}
function buy(p) {
  if (saved.tickets < p.cost) return toast(`You need ${p.cost - saved.tickets} more tickets for that.`);
  saved.tickets -= p.cost;
  saved.prizes[p.id] = (saved.prizes[p.id] || 0) + 1;
  save();
  sound.buy();
  toast(`You got ${p.say}.`);
  renderPrizes();
}
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- every frame ----------
let last = performance.now();
const hits = [];
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000) * timeScale;
  last = now;
  if (!paused) update(dt);
  scene.frame({
    ball, tray: trayCount(), trayGold: trayGold(), call: callNow(), pops, flash, lights, now, zoom: zoom * zoom * (3 - 2 * zoom),
    charge: charge && mode === 'aim' ? chargeLevel() : null,
  });
  requestAnimationFrame(tick);
}

function update(dt) {
  lights.t += dt;
  const close = (mode === 'roll' && ball.z > LANE.foul + 40) || (mode === 'result' && ball.why !== 'short');
  zoom += ((close ? 1 : 0) - zoom) * Math.min(1, dt * (close ? 2.6 : 4));
  if (lights.mode !== 'idle' && lights.t > (lights.mode === 'win' ? 2.6 : 1.4)) lights.mode = 'idle';
  if (flash) { flash.t += dt; if (flash.t > 1.2) flash = null; }
  for (const p of pops) p.age += dt;
  while (pops.length && pops[0].age > 1.6) pops.shift();
  if (shown < game.score) { shown = Math.min(game.score, shown + Math.max(60, (game.score - shown) * 6) * dt); hud(); }

  if (mode === 'roll') {
    hits.length = 0;
    phys.advance(ball, dt, hits);
    for (const h of hits) {
      if (h.kind === 'hole') intoHole(ball.hole);
      else sound.hit(h.kind, h.speed);
    }
    const c = ball.contact;
    sound.rolling(c && c.surface === 'lane' ? Math.hypot(ball.vx, ball.vy, ball.vz) : 0);
    if (ball.state === 'done') { sound.rolling(0); scored(); }
  } else if (mode === 'result') {
    resultT += dt;
    if (resultT > 1.05) { if (game.thrown < BALLS) nextBall(); else gameOver(); }
  } else if (mode === 'deal') {
    deal.t += dt;
    const k = Math.min(1, deal.t / 0.38), e = 1 - (1 - k) ** 3;
    ball.x = deal.from.x + (deal.to.x - deal.from.x) * e;
    ball.z = deal.from.z + (deal.to.z - deal.from.z) * e;
    ball.y = deal.from.y + (deal.to.y - deal.from.y) * e + Math.sin(k * Math.PI) * 5;
    if (k >= 1) { Object.assign(ball, deal.to); deal = null; mode = 'aim'; hud(); }
  }
}

hud();
$('titleBest').textContent = saved.best ? `Best: ${saved.best} · ${saved.tickets} tickets` : '';
requestAnimationFrame(tick);

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// For the tests and the screenshot tool: roll without a finger, and run the clock faster.
window.rollUp = {
  get mode() { return mode; },
  get score() { return game.score; },
  get thrown() { return game.thrown; },
  get ball() { return ball; },
  get saved() { return saved; },
  get game() { return game; },
  start,
  roll(vx, vz, x) {
    if (mode !== 'aim') return false;
    if (x != null) ball.x = x;
    throwBall(vx, vz);
    return true;
  },
  set speed(k) { timeScale = k; },
  scene,
};
