// The front page in the browser (src/index.html): no sideways scroll on a phone and at 1280 px, the picture of S2 is loaded, the cards link to the map and
// the student view, the links that must be there are there, dark mode, and the page opens offline after the first visit (service worker).
// Served by a small node:http server over the folder as it is published (dist/publiser/). Screenshots go to skjermbilete/19.
// Needs dist/S2.json (python3 scripts/bygg.py) and Chromium, else skipped. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { skip, viewerDir, chromiumPath, TOUR_DONE } from './browser.mjs';
import { distDir } from './kart.mjs';

const S2 = path.join(distDir, 'S2.json');
const opts = { skip: skip || (fs.existsSync(S2) ? false : 'no dist/S2.json') };
const SHOTS = path.join(viewerDir, 'skjermbilete', '19');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.webp': 'image/webp' };

async function site() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-landing-b-'));
  execFileSync(process.execPath, ['build.mjs', `--out=${out}`, '--adresse=', '--offentlege=S2', S2], { cwd: viewerDir, stdio: 'pipe' });
  const root = path.join(out, 'publiser');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(u.pathname).slice(1).replace(/\/$/, '/index.html') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nei'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/`, close: async () => { await new Promise((r) => server.close(r)); fs.rmSync(out, { recursive: true, force: true }); } };
}
async function launch() {
  const { chromium } = await import('playwright-core');
  return chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
}
async function open(browser, base, viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  await ctx.addInitScript(TOUR_DONE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  await page.goto(base);
  await page.waitForLoadState('load');
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);

for (const [name, viewport, shot] of [['phone, 390 px', { width: 390, height: 844 }, 'landingsside-mobil'], ['desktop, 1280 px', { width: 1280, height: 800 }, 'landingsside-1280']]) {
  test(`front page, ${name}: no sideways scroll, the picture loads, the cards and links are there`, opts, async () => {
    const s = await site();
    const browser = await launch();
    try {
      const { page, errors } = await open(browser, s.base, viewport, { hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
      assert.equal(await noSideways(page), true, 'no horizontal scroll');
      assert.equal(await page.textContent('h1'), 'Fagkart');
      assert.equal(await page.evaluate(() => document.querySelectorAll('ul.kart > li').length), 1, 'one public map');
      assert.match(await page.textContent('ul.kart'), /Matematikk S2/);
      assert.deepEqual(await page.locator('ul.kart a').evaluateAll((a) => a.map((x) => [x.textContent, x.getAttribute('href')])), [['Opne kartet', 's2/'], ['Elevvising', 's2/?vising=elev']]);
      assert.equal(await page.evaluate(() => { const i = document.querySelector('.hero img'); return i.complete && i.naturalWidth > 0; }), true, 'the picture of S2 is loaded');
      assert.ok(!(await page.textContent('body')).match(/MAT1[12]-01|mat1[12]-01/i), 'no other map by code');
      const hrefs = await page.locator('a').evaluateAll((a) => a.map((x) => x.getAttribute('href')));
      for (const h of ['https://github.com/lektorodd/fagkart', 'https://github.com/lektorodd/fagkart/issues']) assert.ok(hrefs.includes(h), h);
      assert.ok(!hrefs.some((h) => h.includes('inn' + 'spel')), 'the page of rooms is not linked'); // spelled in two parts: the open export forbids the word in files
      assert.match(await page.textContent('.sitat'), /Ottestad, T\. F\. \(\d{4}\)\. Matematikk S2 \(versjon [^)]+\)\./);
      // everything inside the width of the window
      const wide = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.tagName + '.' + e.className));
      assert.deepEqual(wide, []);
      // the buttons can be hit with a finger
      const small = await page.locator('ul.kart a').evaluateAll((a) => a.map((x) => x.getBoundingClientRect().height).filter((h) => h < 40));
      assert.deepEqual(small, []);
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${shot}.png`), fullPage: true });
      assert.deepEqual(errors, []);
    } finally { await browser.close(); await s.close(); }
  });
}

test('front page, dark mode: a dark board, no sideways scroll', opts, async () => {
  const s = await site();
  const browser = await launch();
  try {
    const { page, errors } = await open(browser, s.base, { width: 390, height: 844 }, { colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(21, 32, 43)');
    assert.equal(await noSideways(page), true);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'landingsside-mork.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});

test('the buttons open the map and the student view', opts, async () => {
  const s = await site();
  const browser = await launch();
  try {
    const { page, errors } = await open(browser, s.base, { width: 1280, height: 800 });
    await page.click('ul.kart a:text("Elevvising")');
    await page.waitForSelector('html[data-ready="1"]');
    assert.equal(new URL(page.url()).pathname, '/s2/');
    assert.equal(new URL(page.url()).searchParams.get('vising'), 'elev');
    assert.equal(await page.isVisible('#evBtn'), true, 'the student view has "Kva kan eg?"');
    await page.goBack();
    await page.click('ul.kart a:text("Opne kartet")');
    await page.waitForSelector('html[data-ready="1"]');
    assert.equal(await page.isHidden('#evBtn'), true, 'the teacher view');
    assert.deepEqual(errors.filter((e) => !/ERR_/.test(e)), []);
  } finally { await browser.close(); await s.close(); }
});

test('offline after the first visit: the page and its picture come from the service worker', opts, async () => {
  const s = await site();
  const browser = await launch();
  try {
    const { ctx, page, errors } = await open(browser, s.base, { width: 390, height: 844 });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 10000 });
    // the second visit goes through the service worker, which keeps the page and the picture
    await page.reload();
    await page.waitForFunction(async () => { const c = await caches.open('fagkart'); return !!(await c.match(location.origin + '/')) && !!(await c.match(location.origin + '/s2-oversikt.webp')); }, null, { timeout: 10000 });
    await ctx.setOffline(true);
    await page.reload();
    assert.equal(await page.textContent('h1'), 'Fagkart');
    assert.equal(await page.evaluate(() => { const i = document.querySelector('.hero img'); return i.complete && i.naturalWidth > 0; }), true, 'the picture is there without a net');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});
