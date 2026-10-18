// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded, so the same pictures come out every time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
let UPNG = null;
try { UPNG = require('upng-js'); } catch { /* without it og.png is saved as it comes */ }
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
const SEED = 4;
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// A returning player: some tickets, a best score and a few prizes on the shelf.
const SAVED = { best: 340, tickets: 214, games: 7, sound: true, prizes: { lollipop: 2, 'spider-ring': 1, duck: 1, dinosaur: 1 } };

async function open(viewport, deviceScaleFactor, saved = SAVED) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(([seed, saved]) => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    // always the same day, so today's card is always the same card
    const Real = Date, fixed = new Real(2026, 9, 18, 10).getTime();
    window.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
    try { localStorage.setItem('roll-up.v1', JSON.stringify(saved)); } catch { }
  }, [SEED, saved]);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  return page;
}

// Plays some balls quickly, so the scoreboard and the tray look like a game in progress.
async function play(page, rolls, daily = false) {
  await page.evaluate(daily => { rollUp.start(daily); rollUp.speed = 8; }, daily);
  for (const [vx, vz, x] of rolls) {
    await page.waitForFunction(() => rollUp.mode === 'aim');
    await page.evaluate(([vx, vz, x]) => rollUp.roll(vx, vz, x), [vx, vz, x]);
  }
  await page.waitForFunction(() => rollUp.mode === 'aim');
  await page.evaluate(() => { rollUp.speed = 1; });
  await page.waitForTimeout(1200); // the score counts up and the lights settle
}

// The lane on today's card, three balls in: the 100 is called and the golden ball is up.
// (On 18 October 2026 the card calls 30, 20, 40, 100, … and ball 4 is golden.)
{
  const page = await open({ width: 390, height: 844 }, 2);
  await play(page, [[0, 280, 0], [0, 250, 0], [0, 305, 0]], true);
  await page.screenshot({ path: join(root, 'docs/phone-lane.png') });
  await page.context().close();
}

// Pushed in on the board as a ball drops into the 50.
let board = null;
{
  const page = await open({ width: 390, height: 844 }, 2);
  await play(page, [[0, 280, 0], [0, 305, 0]]);
  await page.evaluate(() => rollUp.roll(0, 332, 0));
  await page.waitForFunction(() => rollUp.ball.state === 'sinking' || rollUp.mode === 'result');
  await page.waitForTimeout(260);
  await page.screenshot({ path: join(root, 'docs/phone-board.png') });
  board = await page.screenshot({ clip: { x: 0, y: 54, width: 390, height: 560 } });
  await page.context().close();
}

// The end of today's card: the tally, the stars, and the tickets feeding out of the slot.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await play(page, [[0, 280, 0], [0, 250, 0], [0, 305, 0], [26, 374, 0], [0, 290, 0], [0, 250, 0], [0, 305, 0], [0, 340, 0]], true);
  await page.evaluate(() => { rollUp.speed = 1; rollUp.roll(0, 280, 0); });
  await page.waitForFunction(() => rollUp.mode === 'over', null, { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('won').textContent === String(rollUp.saved.daily.won), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(root, 'docs/phone-card.png') });
  await page.context().close();
}

// The prize counter.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await page.click('#toPrizes');
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(root, 'docs/phone-prizes.png') });
  await page.context().close();
}

// Link preview, 1200 x 630: the name and one line on the left, the board on the right.
{
  const page = await open({ width: 1200, height: 630 }, 1);
  const font = async f => `data:font/woff2;base64,${(await readFile(join(root, 'fonts', f))).toString('base64')}`;
  const img = `data:image/png;base64,${board.toString('base64')}`;
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Bungee; src: url(${await font('bungee.woff2')}); }
    @font-face { font-family: Figtree; src: url(${await font('figtree.woff2')}); font-weight: 300 900; }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { background: radial-gradient(circle at 18% 22%, rgba(255,190,90,.14), transparent 26%), radial-gradient(circle at 8% 88%, rgba(255,110,140,.13), transparent 24%),
      radial-gradient(circle at 52% 70%, rgba(90,210,220,.10), transparent 22%), linear-gradient(#100c22, #2a1538); color: #fbeed2; font-family: Figtree; position: relative; }
    .left { position: absolute; left: 72px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; }
    .sign { align-self: flex-start; padding: 26px 40px 22px; border-radius: 22px; background: linear-gradient(#8e1c22, #55101a); border: 4px solid #f2c14e;
      box-shadow: 0 0 0 8px rgba(242,193,78,.14), 0 18px 50px rgba(194,58,46,.4); position: relative; }
    .sign::before, .sign::after { content: ""; position: absolute; left: 18px; right: 18px; height: 10px;
      background: radial-gradient(circle, #ffe3a1 0 4px, rgba(255,210,120,.35) 5px, transparent 6.5px) 0 0 / 24px 10px repeat-x; }
    .sign::before { top: 8px; } .sign::after { bottom: 8px; }
    h1 { margin: 6px 0 0; font: 400 92px/1 Bungee; letter-spacing: .01em; white-space: nowrap; text-shadow: 0 5px 0 rgba(0,0,0,.35); }
    p { margin: 40px 0 0; font-size: 38px; line-height: 1.25; font-weight: 600; max-width: 560px; }
    small { display: block; margin-top: 22px; font-size: 24px; color: rgba(251,238,210,.6); font-weight: 500; }
    .shot { position: absolute; right: 64px; top: 40px; width: 430px; height: 550px; border-radius: 26px; overflow: hidden;
      box-shadow: 0 24px 70px rgba(0,0,0,.55), 0 0 0 2px rgba(242,193,78,.5); background: url(${img}) center / cover; }
  </style></head><body>
    <div class="left"><div class="sign"><h1>ROLL UP</h1></div>
      <p>Skee-ball on your phone, with tickets and a prize counter.</p><small>roll-up.junkdrawer.works</small></div>
    <div class="shot"></div>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot();
  await writeFile(join(root, 'og.png'), UPNG ? palette(png) : png);
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');

// Squeezes the share image down to 256 colours, which keeps it small enough for link previews.
function palette(png) {
  const img = UPNG.decode(png);
  const rgba = UPNG.toRGBA8(img)[0];
  return Buffer.from(UPNG.encode([rgba], img.width, img.height, 256));
}
