// Roll Up's picture: the machine in perspective on a canvas, drawn from the numbers in js/physics.js.
// Everything that doesn't move is drawn once per resize into `bake`. Each frame copies that and adds
// the ball, its shadow, the bulbs, a lit hole and the score pop-ups on top.

import { R, LANE, JUMP, BOARD, RINGS, HOLES, LIP, LIP_Y, ground, fromBoard } from './physics.js';

const X = { x: 1, y: 0, z: 0 };
const TB = { x: 0, y: BOARD.sin, z: BOARD.cos };
const NB = { x: 0, y: BOARD.cos, z: -BOARD.sin };
const V = (x, y, z) => ({ x, y, z });
const add = (a, b, k = 1) => V(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = a => { const l = Math.hypot(a.x, a.y, a.z) || 1; return V(a.x / l, a.y / l, a.z / l); };
const LIGHT = norm(V(-0.25, 1, -0.45)); // overhead, a little in front of the board and to the left

const COL = {
  bg0: '#100c22', bg1: '#2a1538',
  planks: ['#e8c38b', '#e3b87c', '#ecc995', '#dfb377', '#e6bf86', '#e1b67f', '#eac58f', '#ddb074'],
  grain: 'rgba(150, 92, 40, .16)',
  seam: 'rgba(110, 62, 24, .38)',
  wall: '#6e1820', wallLo: '#3a0b12', cap: '#c23a2e', capLo: '#8f2620', gold: '#f2c14e',
  board: '#18224a', ringA: '#213166', ringB: '#18224a', cup: '#2b3f7e',
  hole: '#04050b', number: '#ffcf5a',
  steelLo: [52, 60, 76], steelHi: [236, 240, 247],
  marquee: '#8e1c22', marqueeLo: '#55101a', cream: '#fbeed2',
  bulbOff: '#5b3d24', bulbOn: '#ffd884',
  ball: ['#ff8a72', '#d23a2c', '#7c1612'], stripe: 'rgba(255, 238, 214, .92)',
};

// A tiny seeded random, so the wood grain and the lights in the background come out the same each time.
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Points the picture has to show: the ball tray at the front, the marquee at the back.
const KEY = [
  V(-34, -10, -20), V(34, -10, -20), V(-34, ground(0) + 12, -4), V(34, ground(0) + 12, -4),
  V(-BOARD.half - 5, BOARD.yTop + 48, BOARD.zTop + 6), V(BOARD.half + 5, BOARD.yTop + 48, BOARD.zTop + 6),
  V(-BOARD.half - 3, BOARD.y0 - 14, JUMP.z1), V(BOARD.half + 3, BOARD.y0 - 14, JUMP.z1),
];
const LOOK = V(0, 26, 170);

function camera(pitchDeg, dist) {
  const p = pitchDeg * Math.PI / 180;
  const eye = V(0, LOOK.y + dist * Math.sin(p), LOOK.z - dist * Math.cos(p));
  const fw = norm(V(LOOK.x - eye.x, LOOK.y - eye.y, LOOK.z - eye.z));
  const rt = norm(V(fw.z, 0, -fw.x)); // up × forward
  const up = V(fw.y * rt.z - fw.z * rt.y, fw.z * rt.x - fw.x * rt.z, fw.x * rt.y - fw.y * rt.x); // forward × right
  return { eye, fw, rt, up, F: 1, ox: 0, oy: 0, pitch: pitchDeg, dist };
}
function project(c, p) {
  const dx = p.x - c.eye.x, dy = p.y - c.eye.y, dz = p.z - c.eye.z;
  const d = dx * c.fw.x + dy * c.fw.y + dz * c.fw.z;
  const k = c.F / d;
  return { x: c.ox + k * (dx * c.rt.x + dy * c.rt.y + dz * c.rt.z), y: c.oy - k * (dx * c.up.x + dy * c.up.y + dz * c.up.z), d, k };
}

// The view: from behind the player and well above, steep enough that the numbers down in the holes show
// over the lips in front of them. A wide screen has less height to spare, so it looks along the lane a
// little lower. Then the picture is scaled to fit between the scoreboard and the bottom of the screen.
function fit(W, H, top, bottom) {
  const c = camera(W > H ? 34 : 42, 600);
  const pts = KEY.map(p => project(c, p));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const F = Math.min((W - 12) / (x1 - x0), (H - top - bottom) / (y1 - y0));
  const spare = (H - top - bottom) - F * (y1 - y0);
  return Object.assign(c, { F, ox: W / 2 - F * (x0 + x1) / 2, oy: top + spare * 0.62 - F * y0 });
}

export function createScene(canvas) {
  const ctx = canvas.getContext('2d');
  const bake = document.createElement('canvas');
  const bctx = bake.getContext('2d');
  let W = 0, H = 0, DPR = 1, BD = 1, cam = null;
  // The push-in toward the board while the ball is in the air: a 2D zoom of the whole picture,
  // screen point p lands at zk·p + (zx, zy). The baked picture is drawn denser (BD) so it stays sharp zoomed in.
  let zk = 1, zx = 0, zy = 0, zoomTo = null;
  let lipParts = [];   // the lip pieces, kept so the ones in front of the ball can be drawn again over it
  let bulbs = [];      // [{ x, y, r, group, i }]
  let glow = null;     // a soft light, drawn scaled for each bulb
  const P = p => project(cam, p);

  function resize(w, h, dpr, insets = { top: 0, bottom: 0 }) {
    W = w; H = h; DPR = dpr;
    // dense enough to stay sharp pushed in, within about 14 million pixels
    BD = Math.max(DPR, Math.min(DPR * 2.2, Math.sqrt(14e6 / (W * H))));
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    bake.width = Math.round(W * BD); bake.height = Math.round(H * BD);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    cam = fit(W, H, insets.top, insets.bottom);
    zoomTo = closeUp(insets.top);
    paint();
  }

  // ---------- small drawing helpers ----------
  function path(c, pts) {
    c.beginPath();
    pts.forEach((p, i) => { const s = P(p); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
    c.closePath();
  }
  function fillPts(c, pts, style) { path(c, pts); c.fillStyle = style; c.fill(); }
  function line(c, a, b, style, width) {
    const s = P(a), e = P(b);
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(e.x, e.y); c.strokeStyle = style; c.lineWidth = width; c.stroke();
  }
  function circleOnBoard(u, s, r, n = 0, steps = 48) {
    const pts = [];
    for (let i = 0; i < steps; i++) { const a = i / steps * Math.PI * 2; pts.push(fromBoard(u + Math.cos(a) * r, s + Math.sin(a) * r, n)); }
    return pts;
  }
  // Back to drawing in screen pixels: the baked picture's, or the live one's with the zoom.
  function base(c) {
    if (c === bctx) c.setTransform(BD, 0, 0, BD, 0, 0);
    else c.setTransform(DPR * zk, 0, 0, DPR * zk, DPR * zx, DPR * zy);
  }
  // Sets the canvas up so drawing in centimetres lands flat on a surface at world point o, with ax across and ay down it.
  function onSurface(c, o, ax, ay) {
    const p0 = P(o), pa = P(add(o, ax)), pb = P(add(o, ay));
    const s = c === bctx ? BD : DPR * zk, ex = c === bctx ? 0 : DPR * zx, ey = c === bctx ? 0 : DPR * zy;
    c.setTransform(s * (pa.x - p0.x), s * (pa.y - p0.y), s * (pb.x - p0.x), s * (pb.y - p0.y), s * p0.x + ex, s * p0.y + ey);
  }

  // How far to push in, and where the board ends up: as big as fits below the scoreboard, at most 2.4×.
  function closeUp(top) {
    const pts = [fromBoard(-BOARD.half, -6, 0), fromBoard(BOARD.half, -6, 0), fromBoard(-BOARD.half, BOARD.len + 2, LIP.h), fromBoard(BOARD.half, BOARD.len + 2, LIP.h)].map(P);
    const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x));
    const y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
    const room = H - top - 24;
    const k = Math.max(1, Math.min(2.4, (W - 16) / (x1 - x0), room / (y1 - y0)));
    return { k, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, tx: W / 2, ty: top + 8 + room / 2 };
  }
  function setZoom(z) {
    const t = zoomTo;
    zk = 1 + (t.k - 1) * z;
    zx = t.cx * (1 - zk) + (t.tx - t.cx) * z;
    zy = t.cy * (1 - zk) + (t.ty - t.cy) * z;
    // never show past the edge of the picture
    zx = Math.min(0, Math.max(W - zk * W, zx));
    zy = Math.min(0, Math.max(H - zk * H, zy));
  }
  const rgb = (a, k) => `rgb(${a.map(v => Math.round(v * k)).join(',')})`;
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

  // ---------- the baked picture ----------
  function paint() {
    const c = bctx;
    zk = 1; zx = 0; zy = 0;
    base(c);
    c.clearRect(0, 0, W, H);
    bulbs = [];
    background(c);
    head(c);
    boardFace(c);
    lips(c);
    trough(c);
    lane(c);
    walls(c);
    tray(c);
    for (const b of bulbs) { c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fillStyle = COL.bulbOff; c.fill(); }
    glow = makeGlow();
  }

  function background(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COL.bg0); g.addColorStop(1, COL.bg1);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // the rest of the arcade, out of focus
    const rnd = seeded(11), hues = ['255,190,90', '255,110,140', '90,210,220', '170,140,255', '255,226,150'];
    for (let i = 0; i < 26; i++) {
      const x = rnd() * W, y = rnd() * H * 0.7, r = 10 + rnd() * Math.min(W, H) * 0.09;
      const rg = c.createRadialGradient(x, y, 0, x, y, r);
      const h = hues[Math.floor(rnd() * hues.length)];
      rg.addColorStop(0, `rgba(${h},${0.10 + rnd() * 0.14})`); rg.addColorStop(1, `rgba(${h},0)`);
      c.fillStyle = rg; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // the carpet under the machine
    const fy = P(V(0, -10, -20)).y;
    const fg = c.createLinearGradient(0, fy - 40, 0, H);
    fg.addColorStop(0, 'rgba(20,10,30,0)'); fg.addColorStop(1, 'rgba(8,4,14,.9)');
    c.fillStyle = fg; c.fillRect(0, fy - 40, W, H - fy + 40);
  }

  // The cabinet around the board: side panels, the net at the back and the marquee over it.
  function head(c) {
    const zb = JUMP.z1, zt = BOARD.zTop + 6, hw = BOARD.half;
    const yLo = BOARD.y0 - 14, yFront = LIP_Y + 24, yBack = BOARD.yTop + 48;
    for (const sx of [-1, 1]) {
      const x = sx * hw;
      const pts = [V(x, yLo, zb), V(x, yFront, zb), V(x, yBack, zt), V(x, yLo, zt)];
      path(c, pts);
      const a = P(pts[1]), b = P(pts[0]);
      const g = c.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, COL.wall); g.addColorStop(1, COL.wallLo);
      c.fillStyle = g; c.fill();
      // a gold stripe and a row of bulbs along the top edge
      line(c, V(x, yFront - 3, zb), V(x, yBack - 3, zt), COL.gold, Math.max(1, P(V(x, yFront, zb)).k * 0.9));
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, p = V(x, yFront + (yBack - yFront) * t - 7, zb + (zt - zb) * t);
        addBulb(p, 1.3, 'side', i);
      }
    }
    // the net behind the board
    const yn0 = BOARD.yTop - 2, yn1 = BOARD.yTop + 26;
    fillPts(c, [V(-hw, yn0, zt - 6), V(hw, yn0, zt - 6), V(hw, yn1, zt - 6), V(-hw, yn1, zt - 6)], '#0b0a14');
    c.save(); path(c, [V(-hw, yn0, zt - 6), V(hw, yn0, zt - 6), V(hw, yn1, zt - 6), V(-hw, yn1, zt - 6)]); c.clip();
    for (let i = -16; i <= 16; i++) {
      line(c, V(i * 4 - 14, yn0, zt - 6), V(i * 4 + 14, yn1, zt - 6), 'rgba(160,150,190,.16)', 1);
      line(c, V(i * 4 + 14, yn0, zt - 6), V(i * 4 - 14, yn1, zt - 6), 'rgba(160,150,190,.16)', 1);
    }
    c.restore();
    // the marquee
    const m0 = BOARD.yTop + 24, m1 = BOARD.yTop + 47, mw = hw + 4;
    const quad = [V(-mw, m0, zt), V(mw, m0, zt), V(mw, m1, zt), V(-mw, m1, zt)];
    path(c, quad);
    const ga = P(quad[3]), gb = P(quad[0]);
    const mg = c.createLinearGradient(0, ga.y, 0, gb.y);
    mg.addColorStop(0, COL.marquee); mg.addColorStop(1, COL.marqueeLo);
    c.fillStyle = mg; c.fill();
    c.lineWidth = Math.max(1.5, P(quad[0]).k * 1.4); c.strokeStyle = COL.gold; c.stroke();
    c.save();
    onSurface(c, V(0, (m0 + m1) / 2, zt), X, V(0, -1, 0));
    c.font = '400 11px Bungee, Impact, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillText('ROLL UP', 0.5, 1.3);
    c.fillStyle = COL.cream; c.fillText('ROLL UP', 0, 0.6);
    c.restore();
    base(c);
    // bulbs round the marquee
    const n = 13;
    for (let i = 0; i <= n; i++) {
      const x = -mw + 2.5 + (mw * 2 - 5) * i / n;
      addBulb(V(x, m1 - 2.4, zt - 0.5), 1.15, 'marquee', i);
      addBulb(V(x, m0 + 2.4, zt - 0.5), 1.15, 'marquee', i + n + 1);
    }
  }

  function boardFace(c) {
    const h = BOARD.half, L = BOARD.len;
    const quad = [fromBoard(-h, 0, 0), fromBoard(h, 0, 0), fromBoard(h, L, 0), fromBoard(-h, L, 0)];
    fillPts(c, quad, COL.board);
    // a pool of light from the bulbs above
    const mid = P(fromBoard(0, L * 0.55, 0)), edge = P(fromBoard(h, L * 0.55, 0));
    const r = Math.abs(edge.x - mid.x) * 1.5;
    c.save(); path(c, quad); c.clip();
    const g = c.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, r);
    g.addColorStop(0, 'rgba(120,150,255,.16)'); g.addColorStop(1, 'rgba(120,150,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.restore();
    // the rings' floors, outermost first, so each crescent shows its own colour
    RINGS.forEach((ring, i) => {
      const col = ring.value === 100 || ring.value === 50 ? COL.cup : i % 2 ? COL.ringB : COL.ringA;
      fillPts(c, circleOnBoard(ring.u, ring.s, ring.r, 0, 64), col);
    });
    // the holes, each with its number lit at the bottom
    for (const o of HOLES) {
      fillPts(c, circleOnBoard(o.u, o.s, o.r, 0, 40), COL.hole);
      c.save();
      onSurface(c, fromBoard(o.u, o.s, -2.2), X, add(V(0, 0, 0), TB, -1));
      const big = o.value === 100;
      c.font = `400 ${big ? 2.7 : 3.4}px Bungee, Impact, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(255,190,70,.9)'; c.shadowBlur = 6;
      c.fillStyle = COL.number; c.fillText(String(o.value), 0, 0.3);
      c.restore();
      base(c);
      // the far wall of the hole catches a little light
      const rim = [];
      for (let i = 0; i <= 20; i++) { const a = Math.PI * (0.08 + 0.84 * i / 20); rim.push(fromBoard(o.u + Math.cos(a) * o.r, o.s + Math.sin(a) * o.r, -0.2)); }
      c.beginPath(); rim.forEach((p, i) => { const s = P(p); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
      c.strokeStyle = 'rgba(140,150,190,.35)'; c.lineWidth = Math.max(1, P(rim[10]).k * 0.5); c.stroke();
    }
    // 10 for anything that rolls off the bottom
    for (const u of [-21, 21]) {
      c.save();
      onSurface(c, fromBoard(u, 4.4, 0), X, add(V(0, 0, 0), TB, -1));
      c.font = '400 4.4px Bungee, Impact, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(251,238,210,.82)'; c.fillText('10', 0, 0.3);
      c.restore();
    }
    base(c);
  }

  // The ring lips: short chrome walls, drawn as pieces from the back of the board to the front.
  function lips(c) {
    lipParts = [];
    const top = LIP.h;
    for (const ring of RINGS) {
      const steps = ring.r > 10 ? 72 : 40;
      for (let i = 0; i < steps; i++) {
        const a0 = i / steps * Math.PI * 2, a1 = (i + 1) / steps * Math.PI * 2, am = (a0 + a1) / 2;
        const nOut = add(V(Math.cos(am), 0, 0), TB, Math.sin(am));
        const mid = fromBoard(ring.u + Math.cos(am) * ring.r, ring.s + Math.sin(am) * ring.r, top / 2);
        const toEye = norm(V(cam.eye.x - mid.x, cam.eye.y - mid.y, cam.eye.z - mid.z));
        const outer = dot(nOut, toEye) > 0;
        const rf = outer ? ring.r + LIP.t : ring.r - LIP.t;
        const nFace = outer ? nOut : V(-nOut.x, -nOut.y, -nOut.z);
        const lit = Math.max(0, dot(nFace, LIGHT));
        const spec = Math.pow(Math.max(0, dot(nFace, norm(add(LIGHT, toEye)))), 12);
        const at = (a, r, n) => fromBoard(ring.u + Math.cos(a) * r, ring.s + Math.sin(a) * r, n);
        const face = [at(a0, rf, 0), at(a1, rf, 0), at(a1, rf, top), at(a0, rf, top)];
        const cap = [at(a0, ring.r - LIP.t, top), at(a1, ring.r - LIP.t, top), at(a1, ring.r + LIP.t, top), at(a0, ring.r + LIP.t, top)];
        const faceCol = mix(COL.steelLo, COL.steelHi, Math.min(1, 0.18 + lit * 0.62 + spec * 0.6));
        const capCol = mix(COL.steelLo, COL.steelHi, Math.min(1, 0.72 + spec * 0.3));
        const pm = P(mid);
        const part = { d: pm.d, face, cap, faceCol, capCol, x: pm.x, y: pm.y, s: pm.k * (ring.r * 0.3 + 6) };
        lipParts.push(part);
      }
    }
    lipParts.sort((a, b) => b.d - a.d);
    for (const part of lipParts) drawLip(c, part);
  }
  function drawLip(c, part) {
    path(c, part.face); c.fillStyle = part.faceCol; c.fill();
    c.lineWidth = 0.6; c.strokeStyle = part.faceCol; c.stroke(); // closes the hairline gaps between pieces
    path(c, part.cap); c.fillStyle = part.capCol; c.fill();
    c.strokeStyle = part.capCol; c.stroke();
  }

  // The gap under the lip of the jump, where a short ball drops for 10.
  function trough(c) {
    const h = BOARD.half;
    fillPts(c, [V(-h, LIP_Y, JUMP.z1), V(h, LIP_Y, JUMP.z1), fromBoard(h, 0, 0), fromBoard(-h, 0, 0)], '#05040a');
  }

  function lane(c) {
    const rnd = seeded(5), n = COL.planks.length, w = LANE.half * 2 / n;
    const z0 = -4, z1 = JUMP.z1;
    // the planks run the length of the lane and up over the jump
    const prof = [];
    for (let z = z0; z < JUMP.z0; z += 50) prof.push(z);
    for (let i = 0; i <= 12; i++) prof.push(JUMP.z0 + (JUMP.z1 - JUMP.z0) * i / 12);
    for (let i = 0; i < n; i++) {
      const xa = -LANE.half + i * w, xb = xa + w;
      for (let j = 0; j < prof.length - 1; j++) {
        const za = prof[j], zb = prof[j + 1];
        const pts = [V(xa, ground(za), za), V(xb, ground(za), za), V(xb, ground(zb), zb), V(xa, ground(zb), zb)];
        let col = COL.planks[i];
        if (za >= JUMP.z0) {
          // the jump's curve turns it toward the lights
          const k = (za - JUMP.z0) / (JUMP.z1 - JUMP.z0);
          col = shade(COL.planks[i], 0.9 + k * 0.3);
        }
        path(c, pts); c.fillStyle = col; c.fill(); c.strokeStyle = col; c.lineWidth = 0.6; c.stroke();
      }
      // grain
      for (let k = 0; k < 9; k++) {
        const x = xa + 0.6 + rnd() * (w - 1.2), za = z0 + rnd() * (JUMP.z0 - 20), zb = Math.min(JUMP.z0, za + 30 + rnd() * 90);
        line(c, V(x, ground(za), za), V(x + (rnd() - 0.5) * 0.8, ground(zb), zb), COL.grain, Math.max(0.5, P(V(x, 0, za)).k * 0.25));
      }
    }
    for (let i = 1; i < n; i++) {
      const x = -LANE.half + i * w;
      line(c, V(x, ground(z0), z0), V(x, ground(JUMP.z0), JUMP.z0), COL.seam, 1);
    }
    // shading: darker at the player's end, a sheen of the marquee down the middle
    const near = P(V(0, ground(z0), z0)), far = P(V(0, ground(JUMP.z1), JUMP.z1));
    c.save();
    path(c, [V(-LANE.half, ground(z0), z0), V(LANE.half, ground(z0), z0), V(LANE.half, LIP_Y, z1), V(-LANE.half, LIP_Y, z1)]);
    c.clip();
    const g = c.createLinearGradient(0, near.y, 0, far.y);
    g.addColorStop(0, 'rgba(60,20,10,.28)'); g.addColorStop(0.5, 'rgba(60,20,10,0)'); g.addColorStop(1, 'rgba(255,230,190,.10)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const sheen = c.createLinearGradient(0, far.y, 0, near.y);
    sheen.addColorStop(0, 'rgba(255,240,215,.2)'); sheen.addColorStop(0.6, 'rgba(255,240,215,0)');
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = sheen;
    path(c, [V(-14, ground(30), 30), V(14, ground(30), 30), V(10, ground(JUMP.z0), JUMP.z0), V(-10, ground(JUMP.z0), JUMP.z0)]);
    c.fill();
    c.restore();
    // the foul line
    const fz = LANE.foul;
    fillPts(c, [V(-LANE.half, ground(fz), fz), V(LANE.half, ground(fz), fz), V(LANE.half, ground(fz + 1.4), fz + 1.4), V(-LANE.half, ground(fz + 1.4), fz + 1.4)], 'rgba(200,40,40,.75)');
    // the brass edge on the lip of the jump
    const ly = LIP_Y;
    fillPts(c, [V(-LANE.half, ly - 0.2, JUMP.z1 - 1.4), V(LANE.half, ly - 0.2, JUMP.z1 - 1.4), V(LANE.half, ly + 0.3, JUMP.z1), V(-LANE.half, ly + 0.3, JUMP.z1)], COL.gold);
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    return rgb([(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.min(255 / k, v)), k);
  }

  // The lane's side walls and the red rails along their tops, with bulbs.
  function walls(c) {
    const zs = [];
    for (let z = -4; z < JUMP.z0; z += 50) zs.push(z);
    for (let i = 0; i <= 8; i++) zs.push(JUMP.z0 + (JUMP.z1 - JUMP.z0) * i / 8);
    const hgt = 11, capW = 9;
    for (const sx of [-1, 1]) {
      const x = sx * LANE.half;
      const top = zs.map(z => V(x, ground(z) + hgt, z)), bot = zs.map(z => V(x, ground(z) - 0.5, z));
      path(c, [...bot, ...top.reverse()]);
      const a = P(V(x, ground(100) + hgt, 100)), b = P(V(x, ground(100), 100));
      const g = c.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, COL.wall); g.addColorStop(1, COL.wallLo);
      c.fillStyle = g; c.fill();
      // the rail along the top
      const inner = zs.map(z => V(x, ground(z) + hgt, z)), outer = zs.map(z => V(x + sx * capW, ground(z) + hgt, z));
      path(c, [...inner, ...outer.reverse()]);
      const ga = P(V(x, 0, 60)), gb = P(V(x + sx * capW, 0, 60));
      const cg = c.createLinearGradient(ga.x, ga.y, gb.x, gb.y);
      cg.addColorStop(0, COL.cap); cg.addColorStop(1, COL.capLo);
      c.fillStyle = cg; c.fill();
      c.beginPath();
      zs.forEach((z, i) => { const s = P(V(x + sx * 0.4, ground(z) + hgt, z)); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
      c.strokeStyle = COL.gold; c.lineWidth = Math.max(1, P(V(x, 0, 30)).k * 0.7); c.stroke();
      // the front end of the rail
      fillPts(c, [V(x, ground(-4) - 0.5, -4), V(x + sx * capW, ground(-4) - 0.5, -4), V(x + sx * capW, ground(-4) + hgt, -4), V(x, ground(-4) + hgt, -4)], COL.capLo);
      for (let i = 0, z = 12; z < JUMP.z1 - 6; i++, z += 28) {
        addBulb(V(x + sx * capW * 0.55, ground(z) + hgt + 0.6, z), 1.4, 'rail', i);
      }
    }
  }

  // The tray across the front where the balls wait their turn.
  function tray(c) {
    const y = -6, z0 = -19, z1 = -5;
    fillPts(c, [V(-34, y, z0), V(34, y, z0), V(34, y, z1), V(-34, y, z1)], '#2b0d12');
    fillPts(c, [V(-34, y, z0), V(34, y, z0), V(34, y - 5, z0 - 1), V(-34, y - 5, z0 - 1)], COL.capLo);
    line(c, V(-34, y, z0), V(34, y, z0), COL.gold, Math.max(1, P(V(0, y, z0)).k * 0.6));
    fillPts(c, [V(-34, y, z1), V(34, y, z1), V(34, ground(-4) - 0.5, -4), V(-34, ground(-4) - 0.5, -4)], '#1a070b');
  }
  const TRAY = { y: -6 + R, z: -12 };
  function traySpot(i) { return V(-30 + i * 7.6, TRAY.y, TRAY.z); }

  function addBulb(p, r, group, i) {
    const s = P(p);
    bulbs.push({ x: s.x, y: s.y, r: Math.max(1.2, s.k * r), group, i });
  }
  function makeGlow() {
    const g = document.createElement('canvas'); g.width = g.height = 64;
    const c = g.getContext('2d');
    const rg = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,236,190,1)'); rg.addColorStop(0.18, 'rgba(255,214,130,.9)');
    rg.addColorStop(0.45, 'rgba(255,170,70,.25)'); rg.addColorStop(1, 'rgba(255,150,60,0)');
    c.fillStyle = rg; c.fillRect(0, 0, 64, 64);
    return g;
  }

  // ---------- each frame ----------
  // view: { ball, tray, lights: { mode, t }, flash: { hole, t }, pops: [{ text, x, y, z, age, big }], charge, now }
  function frame(view) {
    setZoom(view.zoom || 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bake, DPR * zx, DPR * zy, W * DPR * zk, H * DPR * zk);
    base(ctx);
    if (view.flash) holeFlash(view.flash);
    lights(view.lights, view.now);
    trayBalls(view.tray, view.ball);
    const b = view.ball;
    if (b && b.state !== 'done' && !b.hidden) drawBall(b);
    if (view.charge != null && b) chargeMeter(b, view.charge);
    for (const p of view.pops) pop(p);
  }

  function holeFlash(f) {
    const a = Math.max(0, 1 - f.t / 1.1);
    if (!a) return;
    const o = f.hole;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * (0.65 + 0.35 * Math.sin(f.t * 22));
    fillPts(ctx, circleOnBoard(o.u, o.s, o.r + 1.4, 0.3, 40), 'rgba(255,200,90,.55)');
    ctx.restore();
  }

  function lights(l, now) {
    const t = now / 1000;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bulbs) {
      let on;
      if (l.mode === 'win') on = Math.floor(t * 8 + b.i) % 2 === 0;           // everything flashing
      else if (l.mode === 'score') on = (l.t < 0.9) ? Math.floor(l.t * 10) % 2 === 0 : (Math.floor(t * 5) + b.i) % 3 === 0;
      else on = (Math.floor(t * 4) + b.i) % 3 === 0;                         // a slow chase
      const r = b.r * (on ? 5 : 2.2);
      ctx.globalAlpha = on ? 0.95 : 0.22;
      ctx.drawImage(glow, b.x - r, b.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function trayBalls(n, ball) {
    for (let i = 0; i < n; i++) sphere(traySpot(i), null, 1);
  }

  function drawBall(b) {
    const p = V(b.x, b.y, b.z);
    const beyond = b.z > JUMP.z1 - 1;
    // shadow: straight down onto the lane, or onto the board
    if (!beyond) {
      const g = ground(b.z), lift = b.y - R - g;
      shadow(V(b.x, g, b.z), X, norm(V(0, -LANE.slope, -1)), lift);
    } else {
      const s = (b.y - BOARD.y0) * BOARD.sin + (b.z - BOARD.z0) * BOARD.cos;
      const n = (b.y - BOARD.y0) * BOARD.cos - (b.z - BOARD.z0) * BOARD.sin;
      if (s > -2 && s < BOARD.len && n > -R && b.state !== 'sinking') shadow(fromBoard(b.x, s, 0.05), X, V(-TB.x, -TB.y, -TB.z), n - R);
    }
    ctx.save();
    if (beyond) {
      // the lip of the jump hides a ball that has dropped behind it
      const l = P(V(-80, LIP_Y + 0.3, JUMP.z1)), r = P(V(80, LIP_Y + 0.3, JUMP.z1));
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.lineTo(r.x, -10); ctx.lineTo(l.x, -10); ctx.closePath(); ctx.clip();
    }
    if (b.state === 'sinking' && b.hole) {
      // only what's above the board, or seen down through the hole
      path(ctx, circleOnBoard(b.hole.u, b.hole.s, b.hole.r, 0, 40));
      ctx.clip();
    }
    const dark = b.state === 'sinking' ? Math.min(1, b.sinkT / 0.22) : 0;
    sphere(p, b.spin, 1 - dark * 0.75);
    ctx.restore();
    // lip pieces nearer than the ball cover it
    if (beyond) {
      const s = P(p), r = s.k * R;
      for (const part of lipParts) {
        if (part.d >= s.d - 1) continue;
        if (Math.abs(part.x - s.x) > r + part.s || Math.abs(part.y - s.y) > r + part.s) continue;
        drawLip(ctx, part);
      }
    }
  }

  function shadow(o, ax, ay, lift) {
    const a = Math.max(0, 0.42 - lift * 0.012);
    if (a <= 0) return;
    const r = R * (1.05 + lift * 0.02);
    ctx.save();
    onSurface(ctx, o, ax, ay);
    const g = ctx.createRadialGradient(-0.6, 0.6, 0, -0.6, 0.6, r);
    g.addColorStop(0, `rgba(10,4,0,${a})`); g.addColorStop(0.6, `rgba(10,4,0,${a * 0.6})`); g.addColorStop(1, 'rgba(10,4,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(-0.6, 0.6, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // A shiny red ball with a cream stripe round it, turned by `spin` so it visibly rolls.
  function sphere(p, spin, bright) {
    const s = P(p), r = s.k * R;
    const g = ctx.createRadialGradient(s.x - r * 0.35, s.y - r * 0.4, r * 0.1, s.x, s.y, r);
    g.addColorStop(0, COL.ball[0]); g.addColorStop(0.45, COL.ball[1]); g.addColorStop(1, COL.ball[2]);
    ctx.save();
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.clip();
    if (spin) {
      ctx.lineWidth = r * 0.24; ctx.lineCap = 'round'; ctx.strokeStyle = COL.stripe;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= 40; i++) {
        const a = i / 40 * Math.PI * 2;
        const d = rotate(spin, V(Math.cos(a), 0, Math.sin(a)));
        const toward = dot(d, cam.fw);
        if (toward < 0.05) {
          const sx = s.x + r * dot(d, cam.rt), sy = s.y - r * dot(d, cam.up);
          if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
          pen = true;
        } else pen = false;
      }
      ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
      // shade the stripe with the ball
      const sh = ctx.createRadialGradient(s.x - r * 0.35, s.y - r * 0.4, r * 0.2, s.x, s.y, r);
      sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(60,0,0,.55)');
      ctx.fillStyle = sh; ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }
    // the shine
    const hl = ctx.createRadialGradient(s.x - r * 0.38, s.y - r * 0.45, 0, s.x - r * 0.38, s.y - r * 0.45, r * 0.5);
    hl.addColorStop(0, 'rgba(255,255,255,.85)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl; ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    if (bright < 1) { ctx.fillStyle = `rgba(4,5,11,${1 - bright})`; ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2); }
    ctx.restore();
  }
  // Turns v by the unit quaternion q: v + w·t + q × t, where t = 2 (q × v).
  function rotate(q, v) {
    const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
    return V(
      v.x + q.w * tx + (q.y * tz - q.z * ty),
      v.y + q.w * ty + (q.z * tx - q.x * tz),
      v.z + q.w * tz + (q.x * ty - q.y * tx),
    );
  }

  function chargeMeter(b, k) {
    const s = P(V(b.x + R * 2.2, b.y, b.z)), h = s.k * 22, w = Math.max(5, s.k * 2.2);
    ctx.fillStyle = 'rgba(16,12,34,.7)'; ctx.fillRect(s.x, s.y - h, w, h);
    ctx.fillStyle = k > 0.78 ? '#ff6a4d' : COL.gold; ctx.fillRect(s.x, s.y - h * k, w, h * k);
    ctx.strokeStyle = COL.cream; ctx.lineWidth = 1; ctx.strokeRect(s.x, s.y - h, w, h);
  }

  function pop(p) {
    const s = P(V(p.x, p.y, p.z));
    // the same size on screen however far the picture is pushed in
    const rise = p.age * 40 / zk, a = Math.max(0, Math.min(1, (1.5 - p.age) * 2));
    const size = (p.big ? 34 : 26) / zk * (1 + Math.max(0, 0.22 - p.age) * 1.8);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `400 ${size}px Bungee, Impact, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size * 0.16); ctx.strokeStyle = 'rgba(30,8,20,.9)'; ctx.lineJoin = 'round';
    ctx.strokeText(p.text, s.x, s.y - rise - size * 0.6);
    ctx.fillStyle = p.big ? '#ffe28a' : COL.cream;
    ctx.fillText(p.text, s.x, s.y - rise - size * 0.6);
    ctx.restore();
  }

  // Where a finger on the screen is, on the lane under the ball's centre.
  function unproject(sx, sy) {
    const d = norm(add(add(cam.fw, cam.rt, (sx - cam.ox) / cam.F), cam.up, -(sy - cam.oy) / cam.F));
    const e = cam.eye, k = LANE.slope;
    const t = (k * e.z + R - e.y) / (d.y - k * d.z);
    return t > 0 ? { x: e.x + d.x * t, z: e.z + d.z * t } : null; // null: above the horizon
  }

  return {
    resize, frame, unproject, traySpot,
    project: p => P(p),
    get camera() { return cam; },
    repaint: () => cam && paint(),
  };
}
