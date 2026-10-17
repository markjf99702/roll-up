// Roll Up's physics: one ball on one machine, in centimetres and seconds.
// No DOM here, so node can run it (test/physics.test.mjs) and the page can draw it (js/scene.js).
//
// The machine, from the player's end:
//   the lane       z 0 → 210, rising 4°, walls at x = ±26
//   the jump       z 210 → 235, curving up to a lip that throws the ball at 42°
//   the trough     z 235 → 250, the gap under the lip: a ball that drops in here scores 10
//   the board      from z 250, tilted 28°, 72 long and 64 wide, with raised ring lips and holes
// The ball comes down onto the board steeply, so where it lands depends on how hard it was rolled.
// x runs across the lane, y is up, z runs away from the player.
// On the board, positions are (u, s, n): u across, s up the slope from its bottom edge, n off the surface.

export const R = 3.6;              // ball radius
export const GRAV = 981;
const ROLL = 5 / 7;                // a rolling solid ball only feels 5/7 of the pull down a slope

const rad = d => d * Math.PI / 180;
export const LANE = { half: 26, end: 210, slope: Math.tan(rad(4)), start: 18, foul: 58 };
export const JUMP = { z0: 210, z1: 235, angle: rad(42) };
JUMP.a = (Math.tan(JUMP.angle) - LANE.slope) / (2 * (JUMP.z1 - JUMP.z0));
const TILT = rad(28);
export const BOARD = {
  z0: 250, y0: 14, len: 72, half: 32, tilt: TILT,
  sin: Math.sin(TILT), cos: Math.cos(TILT),
};
BOARD.zTop = BOARD.z0 + BOARD.len * BOARD.cos;
BOARD.yTop = BOARD.y0 + BOARD.len * BOARD.sin;
export const CEILING = BOARD.yTop + 50;

// Ring lips: walls 4.4 tall (a little over the ball's middle) with a rounded top 0.8 thick. Each ring is a little higher up the board
// than the one around it, so the rings crowd together at the top and leave a wide gap at the bottom,
// where that ring's hole is. A ball that lands in a ring rolls down to its hole.
export const LIP = { h: 4.4, t: 0.8 };
export const RINGS = [
  { value: 20, u: 0, s: 33, r: 24 },
  { value: 30, u: 0, s: 39, r: 17 },
  { value: 40, u: 0, s: 44.5, r: 11.2 },
  { value: 50, u: 0, s: 49.5, r: 6 },
  // the 100s sit hard in the top corners, so there's no gap a ball could wedge in behind them
  { value: 100, u: -25.2, s: 65.4, r: 5.6 },
  { value: 100, u: 25.2, s: 65.4, r: 5.6 },
];
const HOLE = 4.3;
export const HOLES = [];
for (const [i, ring] of RINGS.entries()) {
  const inner = ring.value < 50 ? RINGS[i + 1] : null;
  // a ring's hole sits in the gap between its bottom and the bottom of the ring inside it;
  // the 50 and the 100s are cups, with the hole in the middle
  const s = inner
    ? ((ring.s - ring.r) + (inner.s - inner.r)) / 2
    : ring.s - ring.r + LIP.t + HOLE + 0.3;
  HOLES.push({ value: ring.value, u: ring.u, s, r: HOLE });
}

// The lane's height under a point, out to the lip of the jump.
export function ground(z) {
  if (z <= JUMP.z0) return z * LANE.slope;
  const t = Math.min(z, JUMP.z1) - JUMP.z0;
  return z * LANE.slope + JUMP.a * t * t;
}
export function groundSlope(z) {
  if (z <= JUMP.z0) return LANE.slope;
  return LANE.slope + 2 * JUMP.a * (Math.min(z, JUMP.z1) - JUMP.z0);
}
export const LIP_Y = ground(JUMP.z1);

// Board coordinates.
export function toBoard(x, y, z) {
  const ry = y - BOARD.y0, rz = z - BOARD.z0;
  return { u: x, s: ry * BOARD.sin + rz * BOARD.cos, n: ry * BOARD.cos - rz * BOARD.sin };
}
export function fromBoard(u, s, n) {
  return {
    x: u,
    y: BOARD.y0 + s * BOARD.sin + n * BOARD.cos,
    z: BOARD.z0 + s * BOARD.cos - n * BOARD.sin,
  };
}
// The board's directions in the world: up the slope (TB) and out of the surface (NB).
const TB = { x: 0, y: BOARD.sin, z: BOARD.cos };
const NB = { x: 0, y: BOARD.cos, z: -BOARD.sin };

export function newBall(x = 0) {
  return {
    x, y: ground(LANE.start) + R, z: LANE.start,
    vx: 0, vy: 0, vz: 0,
    t: 0, state: 'hand', // hand → rolling → sinking (into a hole) → done
    value: null, hole: null, why: '',
    contact: null, // the surface normal it touched last step, for rolling
    still: 0, nudges: 0, onBoard: false,
    spin: { x: 0, y: 0, z: 0, w: 1 }, // how it has turned, for drawing
  };
}

// Sets the ball rolling with this velocity along the lane (vz away from the player, vx across).
export function launch(ball, vx, vz) {
  const k = groundSlope(ball.z);
  ball.vx = vx;
  ball.vz = vz;
  ball.vy = vz * k;
  ball.state = 'rolling';
  ball.t = 0;
}

export const STEP = 1 / 600;

// Moves the ball on by dt seconds, in fixed small steps. Things it hit go in `hits`
// ({ kind: 'lane' | 'jump' | 'board' | 'lip' | 'wall' | 'rim' | 'back', speed, x, y, z }) so the page can make the sounds.
export function advance(ball, dt, hits = [], random = Math.random) {
  ball.acc = (ball.acc || 0) + dt;
  while (ball.acc >= STEP) {
    ball.acc -= STEP;
    if (ball.state === 'rolling') step(ball, hits, random);
    else if (ball.state === 'sinking') sink(ball);
    else break;
  }
  if (ball.state === 'hand' || ball.state === 'done') ball.acc = 0;
}

function step(b, hits, random) {
  const h = STEP;
  b.t += h;

  // gravity, less the part a rolling ball turns into spin
  let ax = 0, ay = -GRAV, az = 0;
  const c = b.contact;
  if (c) {
    const gn = -GRAV * c.y; // g · N
    const tx = -gn * c.x, ty = -GRAV - gn * c.y, tz = -gn * c.z; // the part along the surface
    ax = gn * c.x + tx * ROLL; ay = gn * c.y + ty * ROLL; az = gn * c.z + tz * ROLL;
    // rolling resistance: lacquered maple is quick, the board is felted and slow
    const vn = b.vx * c.x + b.vy * c.y + b.vz * c.z;
    const wx = b.vx - vn * c.x, wy = b.vy - vn * c.y, wz = b.vz - vn * c.z;
    const sp = Math.hypot(wx, wy, wz);
    if (sp > 1e-6) {
      const mu = (c.surface === 'board' ? 0.025 : 0.012) * GRAV * c.y;
      const k = Math.min(1, mu * h / sp);
      b.vx -= wx * k; b.vy -= wy * k; b.vz -= wz * k;
    }
  }
  b.vx += ax * h; b.vy += ay * h; b.vz += az * h;
  const ox = b.x, oy = b.y, oz = b.z;
  b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
  b.contact = null;

  // the lane and the jump
  if (b.z <= JUMP.z1) {
    const g = ground(b.z), k = groundSlope(b.z), m = Math.hypot(1, k);
    const d = (b.y - g) / m;
    if (d < R && d > -R * 2) {
      push(b, { x: 0, y: 1 / m, z: -k / m }, R - d, b.z > JUMP.z0 ? 'jump' : 'lane', 0.3, hits);
    }
  } else if (b.z < JUMP.z1 + R && b.y < LIP_Y + R) {
    // the rounded edge of the lip
    const dy = b.y - LIP_Y, dz = b.z - JUMP.z1, d = Math.hypot(dy, dz);
    if (dy >= 0 && d < R && d > 1e-6) push(b, { x: 0, y: dy / d, z: dz / d }, R - d, 'jump', 0.3, hits);
    // the back of the jump drops straight down into the trough
    if (dy < 0 && b.z < JUMP.z1 + R) push(b, { x: 0, y: 0, z: 1 }, JUMP.z1 + R - b.z, 'wall', 0.4, hits);
  }

  // walls: the lane's, then the wider head around the board
  const half = (b.z < JUMP.z1 ? LANE.half : BOARD.half) - R;
  if (b.x > half) push(b, { x: -1, y: 0, z: 0 }, b.x - half, 'wall', 0.5, hits);
  else if (b.x < -half) push(b, { x: 1, y: 0, z: 0 }, -half - b.x, 'wall', 0.5, hits);
  if (b.z > BOARD.zTop - R) net(b, b.z - (BOARD.zTop - R), hits);
  if (b.y > CEILING - R) push(b, { x: 0, y: -1, z: 0 }, b.y - (CEILING - R), 'back', 0.3, hits);

  board(b, hits);
  if (b.state !== 'rolling') return;

  // out of play
  if (b.z > JUMP.z1 && b.y < BOARD.y0 - 9) return finish(b, 10, null, 'trough');
  if (b.z < LANE.start - 8 && b.vz < 0) return finish(b, 0, null, 'short');
  if (b.t > 14) return finish(b, 10, null, 'stuck');

  // a ball resting somewhere on the board with nowhere to go gets a shake, the way a real machine rattles:
  // a little hop down the slope and to one side (in toward the middle when it's up against a wall)
  const moved = Math.hypot(b.x - ox, b.y - oy, b.z - oz) / h;
  if (b.onBoard && moved < 4) b.still += h; else b.still = 0;
  if (b.still > 0.8) {
    b.still = 0; b.nudges++;
    const dir = Math.abs(b.x) > 20 ? -Math.sign(b.x) : random() < 0.5 ? -1 : 1;
    const side = dir * (6 + random() * 8), down = 10 + random() * 10, up = 22;
    b.vx += side; b.vy += up * NB.y - down * TB.y; b.vz += up * NB.z - down * TB.z;
    if (b.nudges > 6) finish(b, 10, null, 'stuck');
  }
  roll(b, ox, oy, oz);
}

// Everything on the board: its surface, the holes, the bottom edge and the ring lips.
function board(b, hits) {
  const p = toBoard(b.x, b.y, b.z);
  if (p.s < -R - 1 || p.s > BOARD.len + R || p.n > R + LIP.h + 2) return;
  if (p.s > 0) b.onBoard = true;
  const inHole = HOLES.find(o => Math.hypot(p.u - o.u, p.s - o.s) < o.r);

  if (p.s >= 0 && !inHole) {
    if (p.n < R && p.n > -R) pushB(b, 0, 0, 1, R - p.n, 'board', 0.32, hits);
  } else if (p.s < 0 && p.n > -R) {
    // the rounded bottom edge, where a ball rolling down drops into the trough
    const d = Math.hypot(p.s, p.n);
    if (d < R && d > 1e-6) pushB(b, 0, p.s / d, p.n / d, R - d, 'board', 0.3, hits);
  }

  if (inHole) {
    // over a hole: nothing underneath, only the hole's edge
    const du = p.u - inHole.u, ds = p.s - inHole.s, dd = Math.hypot(du, ds);
    if (dd > 1e-6) {
      const eu = du / dd, es = ds / dd;
      const cu = (dd - inHole.r) * eu, cs = (dd - inHole.r) * es, cn = p.n;
      const d = Math.hypot(cu, cs, cn);
      if (d < R && d > 1e-6) pushB(b, cu / d, cs / d, cn / d, R - d, 'rim', 0.3, hits);
    }
    if (p.n < R * 0.4) {
      b.state = 'sinking';
      b.value = inHole.value;
      b.hole = inHole;
      b.sinkT = 0;
      b.sinkFrom = { u: p.u, s: p.s, n: p.n };
      hits.push({ kind: 'hole', value: inHole.value, speed: 0, x: b.x, y: b.y, z: b.z });
      return;
    }
  }

  // the lips: a low wall swept round each circle, with a rounded top
  const top = LIP.h - LIP.t;
  const q = toBoard(b.x, b.y, b.z);
  for (const ring of RINGS) {
    const du = q.u - ring.u, ds = q.s - ring.s, dd = Math.hypot(du, ds);
    if (Math.abs(dd - ring.r) > R + LIP.t || dd < 1e-6) continue;
    const eu = du / dd, es = ds / dd;
    const off = dd - ring.r;
    const cn = q.n - Math.max(0, Math.min(top, q.n));
    const d = Math.hypot(off, cn);
    if (d < R + LIP.t && d > 1e-6) {
      pushB(b, eu * off / d, es * off / d, cn / d, R + LIP.t - d, 'lip', 0.36, hits);
    }
  }
}

function pushB(b, nu, ns, nn, depth, kind, e, hits) {
  push(b, {
    x: nu + ns * TB.x + nn * NB.x,
    y: ns * TB.y + nn * NB.y,
    z: ns * TB.z + nn * NB.z,
  }, depth, kind, e, hits);
}

// Moves the ball out of a surface along its normal N and takes away the speed going into it,
// bouncing back a fraction e of a hard hit. A surface that holds it up becomes its rolling contact.
function push(b, N, depth, kind, e, hits) {
  b.x += N.x * depth; b.y += N.y * depth; b.z += N.z * depth;
  const vn = b.vx * N.x + b.vy * N.y + b.vz * N.z;
  if (vn < 0) {
    const hit = -vn;
    const bounce = hit > 45 ? e : 0;
    b.vx -= (1 + bounce) * vn * N.x; b.vy -= (1 + bounce) * vn * N.y; b.vz -= (1 + bounce) * vn * N.z;
    if (hit > 45 && (kind === 'board' || kind === 'lip' || kind === 'rim')) {
      // a hard landing on felt scrubs off some speed along the surface too
      const keep = 1 - 0.18 * Math.min(1, hit / 300);
      const vn2 = b.vx * N.x + b.vy * N.y + b.vz * N.z;
      b.vx = (b.vx - vn2 * N.x) * keep + vn2 * N.x;
      b.vy = (b.vy - vn2 * N.y) * keep + vn2 * N.y;
      b.vz = (b.vz - vn2 * N.z) * keep + vn2 * N.z;
    }
    if (hit > 20) hits.push({ kind, speed: hit, x: b.x, y: b.y, z: b.z });
  }
  if (N.y > 0.3) b.contact = { x: N.x, y: N.y, z: N.z, surface: kind === 'lane' || kind === 'jump' ? 'lane' : 'board' };
}

// The net hung behind the board: it soaks up a ball rolled too hard, which drops onto the top of the board.
function net(b, depth, hits) {
  b.z -= depth;
  if (b.vz > 0) {
    if (b.vz > 20) hits.push({ kind: 'net', speed: b.vz, x: b.x, y: b.y, z: b.z });
    b.vz = -b.vz * 0.12;
    b.vx *= 0.4;
    b.vy = Math.min(b.vy, 0) * 0.4;
  }
}

function finish(b, value, hole, why) {
  b.state = 'done';
  b.value = value;
  b.hole = hole;
  b.why = why;
  b.vx = b.vy = b.vz = 0;
}

// Into the hole: down and out of sight in a quarter of a second.
function sink(b) {
  b.sinkT += STEP;
  const k = Math.min(1, b.sinkT / 0.28);
  const f = b.sinkFrom, o = b.hole;
  const u = f.u + (o.u - f.u) * Math.min(1, k * 2);
  const s = f.s + (o.s - f.s) * Math.min(1, k * 2);
  const n = f.n - (f.n + R * 2.4) * k * k;
  const w = fromBoard(u, s, n);
  b.x = w.x; b.y = w.y; b.z = w.z;
  if (k >= 1) { b.state = 'done'; b.why = 'hole'; }
}

// Turns the ball's picture as it moves: rolling without slipping turns it by distance / R
// about the axis that lies flat on the surface, across the direction of travel.
function roll(b, ox, oy, oz) {
  const c = b.contact;
  if (!c) return;
  const dx = b.x - ox, dy = b.y - oy, dz = b.z - oz;
  let ax = c.y * dz - c.z * dy, ay = c.z * dx - c.x * dz, az = c.x * dy - c.y * dx; // N × d
  const len = Math.hypot(ax, ay, az);
  if (len < 1e-9) return;
  const ang = len / R;
  ax /= len; ay /= len; az /= len;
  const s = Math.sin(ang / 2), q = { x: ax * s, y: ay * s, z: az * s, w: Math.cos(ang / 2) };
  const p = b.spin;
  b.spin = {
    w: q.w * p.w - q.x * p.x - q.y * p.y - q.z * p.z,
    x: q.w * p.x + q.x * p.w + q.y * p.z - q.z * p.y,
    y: q.w * p.y - q.x * p.z + q.y * p.w + q.z * p.x,
    z: q.w * p.z + q.x * p.y - q.y * p.x + q.z * p.w,
  };
}

// Plays a whole roll without drawing it, for tests and tuning. Returns the ball when it's done.
export function simulate(vx, vz, x = 0, random = Math.random, hits = []) {
  const b = newBall(x);
  launch(b, vx, vz);
  for (let i = 0; i < 20 * 600 && b.state !== 'done'; i++) advance(b, STEP, hits, random);
  return b;
}
