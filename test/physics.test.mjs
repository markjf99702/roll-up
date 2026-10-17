// The physics on its own, without a browser:  node --test test/physics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, RINGS, HOLES, BOARD, R } from '../js/physics.js';
import { PRIZES, ticketsFor } from '../js/prizes.js';

const still = () => 0.5; // the shake for a stuck ball, made predictable

test('a straight roll climbs the rings as it gets firmer, then sails over into the 10', () => {
  const cases = [[180, [0, 10]], [250, [20]], [280, [30]], [305, [40]], [332, [50]], [380, [10]]];
  for (const [speed, want] of cases) {
    const b = simulate(0, speed, 0, still);
    assert.ok(want.includes(b.value), `a ${speed} roll scored ${b.value} (${b.why}), expected ${want.join(' or ')}`);
  }
});

test('a roll too gentle to clear the jump rolls back for nothing', () => {
  const b = simulate(0, 150, 0, still);
  assert.equal(b.value, 0);
  assert.equal(b.why, 'short');
});

test('a firm roll angled at a corner can drop into a 100', () => {
  const b = simulate(26, 374, 0, still);
  assert.equal(b.value, 100);
  assert.equal(simulate(-26, 374, 0, still).value, 100, 'the left corner works the same way');
});

test('every roll ends, with a score the machine has', () => {
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const allowed = new Set([0, 10, 20, 30, 40, 50, 100]);
  for (let i = 0; i < 300; i++) {
    const b = simulate((rnd() - 0.5) * 80, 120 + rnd() * 320, (rnd() - 0.5) * 40, rnd);
    assert.equal(b.state, 'done', `roll ${i} never finished`);
    assert.ok(allowed.has(b.value), `roll ${i} scored ${b.value}`);
    assert.ok(b.t < 15, `roll ${i} took ${b.t.toFixed(1)}s`);
  }
});

test('each hole sits inside its own ring and clear of the ring inside it', () => {
  for (const [i, hole] of HOLES.entries()) {
    const ring = RINGS[i];
    const out = Math.hypot(hole.u - ring.u, hole.s - ring.s) + hole.r;
    assert.ok(out <= ring.r, `the ${hole.value} hole pokes through its ring`);
    if (hole.value < 50) {
      const inner = RINGS[i + 1];
      const gap = Math.hypot(hole.u - inner.u, hole.s - inner.s) - hole.r;
      assert.ok(gap >= inner.r - 0.01, `the ${hole.value} hole runs under the ${inner.value} ring`);
    }
    assert.ok(hole.r > R, 'a ball has to fit through every hole');
    assert.ok(Math.abs(hole.u) + hole.r < BOARD.half && hole.s + hole.r < BOARD.len, `the ${hole.value} hole is off the board`);
  }
});

test('tickets and prizes', () => {
  assert.equal(ticketsFor(0), 0);
  assert.equal(ticketsFor(239), 23);
  assert.equal(ticketsFor(900), 90);
  const ids = new Set(PRIZES.map(p => p.id));
  assert.equal(ids.size, PRIZES.length, 'prize ids are unique');
  for (let i = 1; i < PRIZES.length; i++) assert.ok(PRIZES[i].cost > PRIZES[i - 1].cost, 'cheapest first');
});
