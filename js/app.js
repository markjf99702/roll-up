// Roll Up: skee-ball. This file runs the game: the turns, the flick, the score, the tickets and the prize counter.
// js/physics.js moves the ball, js/scene.js draws it and js/sound.js makes the noises.

import * as phys from './physics.js';
import { createScene } from './scene.js';
import * as sound from './sound.js';
import { PRIZES, ticketsFor } from './prizes.js';

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
let game = { thrown: 0, score: 0, balls: [] };
let ball = phys.newBall(0);
let handX = 0;
let shown = 0;               // the score on the board, counting up to game.score
let resultT = 0, deal = null, drag = null, charge = null, thrownOnce = false;
let paused = false, timeScale = 1;
let zoom = 0;                // 0: the whole machine; 1: pushed in on the board while the ball's up there
const pops = [];
let flash = null;
const lights = { mode: 'idle', t: 0 };

function newGame() {
  game = { thrown: 0, score: 0, balls: [] };
  shown = 0;
  ball = phys.newBall(handX);
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
  game.score += v;
  game.thrown++;
  game.balls.push(v);
  if (!ball.hole) {
    // a hole already rang its bell and showed its number as the ball dropped in
    const at = ball.why === 'short'
      ? { x: ball.x, y: phys.ground(LANE.foul + 30) + 8, z: LANE.foul + 30 }
      : { x: ball.x, y: phys.BOARD.y0 + 4, z: phys.JUMP.z1 + 8 };
    pops.push({ text: v ? '+' + v : 'No jump', ...at, age: 0, big: false });
    sound.score(v);
    lights.mode = 'score'; lights.t = 0;
  }
  const left = BALLS - game.thrown;
  $('live').textContent = `${v} points. ${game.score} so far, ${left ? left + (left === 1 ? ' ball' : ' balls') + ' left' : 'game over'}.`;
  mode = 'result';
  resultT = 0;
  hud();
}

function intoHole(hole) {
  const p = phys.fromBoard(hole.u, hole.s, 3);
  pops.push({ text: '+' + hole.value, ...p, age: 0, big: hole.value >= 50 });
  flash = { hole, t: 0 };
  sound.drop();
  sound.score(hole.value);
  lights.mode = hole.value === 100 ? 'win' : 'score'; lights.t = 0;
  if (navigator.vibrate) try { navigator.vibrate(hole.value >= 50 ? [18, 40, 18] : 12); } catch { /* not allowed */ }
}

function nextBall() {
  const from = scene.traySpot(BALLS - game.thrown - 1);
  ball = phys.newBall(handX);
  deal = { t: 0, from, to: { x: ball.x, y: ball.y, z: ball.z } };
  ball.x = from.x; ball.y = from.y; ball.z = from.z;
  mode = 'deal';
  hud();
}

function gameOver() {
  mode = 'over';
  const won = ticketsFor(game.score);
  const first = saved.games === 0;
  const isBest = game.score > saved.best;
  saved.tickets += won; saved.games++;
  if (isBest) saved.best = game.score;
  save();
  $('overT').textContent = `Nine balls, ${game.score} points`;
  $('tally').replaceChildren(...game.balls.map(v => {
    const c = document.createElement('span');
    c.textContent = v;
    if (v >= 50) c.className = 'hi';
    return c;
  }));
  $('overBest').textContent = isBest && !first ? 'A new best.' : `Best: ${saved.best}`;
  $('wonWord').textContent = won === 1 ? 'ticket' : 'tickets';
  $('over').hidden = false;
  if (isBest && !first) { lights.mode = 'win'; lights.t = 0; }
  sound.fanfare();
  // the tickets come out of the machine one by one
  let n = 0;
  $('won').textContent = '0';
  const step = () => {
    if (mode !== 'over') return;
    n = Math.min(won, n + Math.max(1, Math.round(won / 30)));
    $('won').textContent = n;
    sound.ticket();
    if (n < won) setTimeout(step, 45);
    else hud();
  };
  setTimeout(step, 500);
  $('again').focus({ preventScroll: true });
}

// ---------- the scoreboard ----------
function hud() {
  $('score').textContent = Math.round(shown);
  const n = mode === 'result' || mode === 'over' ? game.thrown : game.thrown + 1;
  $('ballNo').textContent = mode === 'over' ? 'Game over' : `Ball ${Math.min(BALLS, Math.max(1, n))} of ${BALLS}`;
  $('tix').textContent = saved.tickets;
  $('hint').hidden = !(mode === 'aim' && !thrownOnce);
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
function start() {
  sound.unlock();
  $('title').hidden = true;
  $('over').hidden = true;
  newGame();
}
$('play').addEventListener('click', start);
$('again').addEventListener('click', start);

function toggleMenu(open = $('menu').hidden) {
  $('menu').hidden = !open;
  paused = open;
  if (open) { drag = null; charge = null; if (mode === 'drag') settle(); $('resume').focus({ preventScroll: true }); }
}
$('menuBtn').addEventListener('click', () => { sound.unlock(); toggleMenu(); });
$('resume').addEventListener('click', () => toggleMenu(false));
$('restart').addEventListener('click', () => { toggleMenu(false); newGame(); });
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
    ball, tray: trayCount(), pops, flash, lights, now, zoom: zoom * zoom * (3 - 2 * zoom),
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
