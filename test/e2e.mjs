// Plays Roll Up in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
const mode = () => page.evaluate(() => rollUp.mode);
const ballOnScreen = () => page.evaluate(() => { const b = rollUp.ball; const s = rollUp.scene.project({ x: b.x, y: b.y, z: b.z }); return { x: s.x, y: s.y }; });

// The title card, then a game.
assert.ok(await page.isVisible('#title'), 'the title card shows first');
await page.click('#play');
assert.equal(await mode(), 'aim');
assert.ok(await page.isVisible('#hint'), 'a first-timer is told how to roll');

// A slow drag isn't a throw: the ball goes back behind the line, moved across to where the finger left it.
let at = await ballOnScreen();
await page.mouse.move(at.x, at.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(at.x + i * 4, at.y - i * 2); await page.waitForTimeout(60); }
await page.mouse.up();
assert.equal(await mode(), 'aim', 'a slow drag should not roll the ball');
const moved = await page.evaluate(() => rollUp.ball.x);
assert.ok(moved > 3, `the ball should move across with the finger (x = ${moved.toFixed(1)})`);

// A flick rolls it up the lane, and it scores.
at = await ballOnScreen();
await page.mouse.move(at.x, at.y);
await page.mouse.down();
for (let i = 1; i <= 7; i++) { await page.mouse.move(at.x, at.y - i * 20); await page.waitForTimeout(12); }
await page.mouse.up();
assert.equal(await mode(), 'roll', 'a flick should roll the ball');
assert.ok(await page.isHidden('#hint'), 'the hint goes once the first ball is rolled');
await page.waitForFunction(() => rollUp.thrown === 1, null, { timeout: 15000 });
const first = await page.evaluate(() => rollUp.score);
assert.ok([0, 10, 20, 30, 40, 50, 100].includes(first), `the first ball scored ${first}`);
assert.match(await page.textContent('#live'), /points/, 'the score is read out');

// The other eight, quickly.
await page.evaluate(() => { rollUp.speed = 6; });
for (let i = 0; i < 8; i++) {
  await page.waitForFunction(() => rollUp.mode === 'aim', null, { timeout: 15000 });
  await page.evaluate(() => rollUp.roll(0, 305, 0));
}
await page.waitForFunction(() => rollUp.mode === 'over', null, { timeout: 30000 });
await page.evaluate(() => { rollUp.speed = 1; });
assert.ok(await page.isVisible('#over'), 'the game-over card shows after nine balls');
assert.equal(await page.locator('#tally span').count(), 9, 'it lists all nine balls');
const score = await page.evaluate(() => rollUp.score);
assert.ok(score >= 8 * 20, `eight rolls at 305 should score well (got ${score})`);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('roll-up.v1')));
assert.equal(stored.tickets, Math.floor(score / 10), 'a ticket for every 10 points');
assert.equal(stored.best, score);
await page.waitForFunction(t => document.getElementById('won').textContent === String(t), stored.tickets, { timeout: 5000 });

// The prize counter: buy the cheapest thing, and it goes on the shelf.
await page.click('#overPrizes');
assert.ok(await page.isVisible('#prizes'));
await page.click('.prize >> nth=0');
assert.match(await page.textContent('#toast'), /You got a lollipop/);
assert.match(await page.textContent('#shelf'), /🍭/);
assert.equal(await page.evaluate(() => rollUp.saved.tickets), stored.tickets - 5);
await page.click('.prize >> nth=15');
assert.match(await page.textContent('#toast'), /more tickets/, 'a prize you can’t afford says how many more you need');
await page.click('#closePrizes');

// Everything is still there after a reload.
await page.reload();
await page.evaluate(() => document.fonts.ready);
assert.match(await page.textContent('#titleBest'), new RegExp(`Best: ${score}`));
assert.equal(await page.textContent('#tix'), String(stored.tickets - 5));

// The keyboard: Enter to play, hold Space to wind up, let go to roll.
await page.keyboard.press('Enter');
assert.equal(await mode(), 'aim');
await page.keyboard.press('ArrowLeft');
await page.keyboard.down('Space');
await page.waitForTimeout(500);
await page.keyboard.up('Space');
assert.equal(await mode(), 'roll', 'Space should roll the ball');

// The menu pauses, and comes back.
await page.click('#menuBtn');
assert.ok(await page.isVisible('#menu'));
await page.click('#resume');
assert.ok(await page.isHidden('#menu'));

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// Chrome would offer to install it.
const cdp = await ctx.newCDPSession(page);
const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
assert.deepEqual(installabilityErrors, [], 'Chrome says it can’t be installed');

// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
assert.ok(await page.title(), 'the page did not load offline');
assert.ok(await page.evaluate(() => typeof rollUp === 'object'), 'the game did not start offline');
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
