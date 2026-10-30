// Publishing (src/oppdatering.js, src/sw.js): the strip for a newer version, the service worker (offline after the first visit), the downloaded copy (file://)
// with and without an address, and host mode. The pages are served by a small node:http server on 127.0.0.1 (a service worker needs http).
// Screenshots go to skjermbilete/14. Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { skip, viewerDir, chromiumPath, TOUR_DONE } from './browser.mjs';

const CODE = 'DEMO-01';
const SHOTS = path.join(viewerDir, 'skjermbilete', '14');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript' };
const CHECK_KEY = `fagkart.${CODE}.versjonsjekk`;
const hasStrip = (page) => page.evaluate(() => { const e = document.getElementById('oppdatering'); return !!e && !e.hidden; });
const ready = (page) => page.waitForSelector('html[data-ready="1"]').then(() => page.waitForTimeout(400));

// One published folder: the demo map built with the given version, and a server on a random port that reads the folder on every request.
async function site(version, { adresse = false } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-publ-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-publ-src-'));
  const requests = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); } // the browser asks for it; not a request of the page
    requests.push(u.pathname + u.search);
    // the flat build folder first (the hosted tests), then the folder as it is published (publiser/<sti>/…, the file:// test)
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1).replace(/\/$/, '/index.html');
    const file = [path.join(out, rel), path.join(out, 'publiser', rel)].find((f) => fs.existsSync(f) && !fs.statSync(f).isDirectory()) || path.join(out, rel);
    if (!file.startsWith(out) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nei'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const build = (v) => {
    const data = JSON.parse(fs.readFileSync(path.join(viewerDir, 'fixtures', `${CODE}.json`), 'utf8'));
    data.versjon = v;
    fs.writeFileSync(path.join(src, `${CODE}.json`), JSON.stringify(data));
    // --adresse= (empty) overrides the address in publisering.json: a test never reaches the real server
    execFileSync(process.execPath, ['build.mjs', `--out=${out}`, `--adresse=${adresse ? base : ''}`, '--offentlege=', path.join(src, `${CODE}.json`)], { cwd: viewerDir, stdio: 'pipe' });
  };
  build(version);
  // A newer edition on the server: either only the version file (the page is old), or the whole map
  const publish = (v, { onlyVersionFile = false } = {}) => {
    if (onlyVersionFile) {
      fs.writeFileSync(path.join(out, `${CODE}.versjon.json`), JSON.stringify({ kart: CODE, versjon: v, fil: `${CODE}.html` }));
      fs.writeFileSync(path.join(out, 'publiser', CODE.toLowerCase(), `${CODE}.versjon.json`), JSON.stringify({ kart: CODE, versjon: v, fil: 'index.html' }));
    }
    else build(v);
  };
  const close = async () => { await new Promise((r) => server.close(r)); fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(src, { recursive: true, force: true }); };
  return { base, out, requests, publish, close };
}

async function browserFor() {
  const { chromium } = await import('playwright-core');
  return chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
}
async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1400, height: 900 } });
  await ctx.addInitScript(TOUR_DONE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  return { ctx, page, errors };
}
// The service worker is running and has kept this page
const cachedPage = (page, url) => page.waitForFunction(async (u) => {
  if (!navigator.serviceWorker.controller && !(await navigator.serviceWorker.getRegistration())?.active) return false;
  return !!(await (await caches.open('fagkart')).match(u));
}, url, { timeout: 10000 });

test('the same version: no strip, and the version file is read once with nothing but its own address', { skip }, async () => {
  const s = await site('2026.2');
  const browser = await browserFor();
  const { page, errors } = await newPage(browser);
  try {
    await page.goto(`${s.base}${CODE}.html?vising=elev`);
    await ready(page);
    assert.equal(await hasStrip(page), false);
    assert.equal(await page.getAttribute('#oppdatering', 'role'), 'status');
    assert.deepEqual(s.requests.filter((r) => r.includes('versjon')), [`/${CODE}.versjon.json`], 'no query string');
    assert.ok(await page.evaluate((k) => Number(localStorage.getItem(k)) > 0, CHECK_KEY), 'the time of the check is kept');
    await page.reload();
    await ready(page);
    assert.equal(s.requests.filter((r) => r.includes('versjon')).length, 1, 'not again within the hour');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});

test('a newer version: the strip names it ("2026.10" is newer than "2026.2"), "Seinare" hides it, and it stays hidden in this session', { skip }, async () => {
  const s = await site('2026.2');
  s.publish('2026.10', { onlyVersionFile: true });
  const browser = await browserFor();
  const { page, errors } = await newPage(browser);
  try {
    await page.goto(`${s.base}${CODE}.html`);
    await ready(page);
    assert.equal(await hasStrip(page), true);
    const text = await page.textContent('#oppdatering');
    assert.match(text, /Ny versjon av kartet \(2026\.10\)\. Last sida på nytt\./);
    assert.deepEqual(await page.locator('#oppdatering .btn').allTextContents(), ['Last på nytt', 'Kva er nytt', 'Seinare']);
    const bar = await page.evaluate(() => { const a = document.getElementById('oppdatering').getBoundingClientRect(), t = document.querySelector('.top').getBoundingClientRect(); return { aBottom: a.bottom, tTop: t.top, tBottom: t.bottom, h: innerHeight, stage: document.getElementById('stage').getBoundingClientRect().bottom }; });
    assert.ok(bar.aBottom <= bar.tTop + 1, 'the strip is above the top bar, not on top of it');
    assert.ok(bar.stage <= bar.h + 1, 'the page still fits the window');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'stripe-desktop.png') });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, 'stripe-mobil.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll on a phone');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.click('#oppdatering >> text=Seinare');
    assert.equal(await hasStrip(page), false);
    await page.reload();
    await ready(page);
    assert.equal(await hasStrip(page), false, 'still hidden after a reload in the same session');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});

test('"Last på nytt": the service worker fetches the new page, the page reloads, and the strip is gone', { skip }, async () => {
  const s = await site('2026.2');
  const browser = await browserFor();
  const { page, errors } = await newPage(browser);
  try {
    const url = `${s.base}${CODE}.html`;
    await page.goto(url);
    await ready(page);
    await cachedPage(page, url);
    assert.match(await page.textContent('#meta'), /versjon 2026\.2$/);
    s.publish('2026.10'); // the whole map is new on the server
    await page.evaluate((k) => localStorage.removeItem(k), CHECK_KEY); // do not wait an hour
    await page.reload();
    await ready(page);
    assert.match(await page.textContent('#meta'), /versjon 2026\.2$/, 'the reload gave the kept copy (and fetched the new one in the background)');
    assert.equal(await hasStrip(page), true);
    await Promise.all([page.waitForNavigation(), page.click('#oppdatering >> text=Last på nytt')]);
    await ready(page);
    assert.match(await page.textContent('#meta'), /versjon 2026\.10$/, 'the new version');
    assert.equal(await hasStrip(page), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});

test('"Kva er nytt": the same reload, and the new page opens with the help box open (the mark is used up)', { skip }, async () => {
  const s = await site('2026.2');
  const browser = await browserFor();
  const { page, errors } = await newPage(browser);
  try {
    const url = `${s.base}${CODE}.html`;
    await page.goto(url);
    await ready(page);
    await cachedPage(page, url);
    s.publish('2026.10');
    await page.evaluate((k) => localStorage.removeItem(k), CHECK_KEY);
    await page.reload();
    await ready(page);
    assert.equal(await hasStrip(page), true);
    assert.equal(await page.isVisible('#helpBox'), false);
    await Promise.all([page.waitForNavigation(), page.click('#oppdatering >> text=Kva er nytt')]);
    await ready(page);
    assert.match(await page.textContent('#meta'), /versjon 2026\.10$/, 'the new version');
    assert.equal(await page.isVisible('#helpBox'), true, 'the help box is open');
    assert.equal(await page.getAttribute('#helpBtn', 'aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('fagkart.nytt')), null);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});

test('offline after the first visit: a new page opens (also with another query string), the console is clean, and no request goes out', { skip }, async () => {
  const s = await site('2026.2');
  const browser = await browserFor();
  const { ctx, page, errors } = await newPage(browser);
  try {
    const url = `${s.base}${CODE}.html`;
    await page.goto(url);
    await ready(page);
    await cachedPage(page, url);
    await ctx.setOffline(true);
    const again = await ctx.newPage();
    again.on('pageerror', (e) => errors.push(e.message));
    again.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
    await again.goto(`${url}?vising=elev`);
    await again.waitForSelector('html[data-ready="1"]');
    await again.waitForTimeout(500);
    assert.match(await again.textContent('#title'), /Demokart/);
    assert.equal(await hasStrip(again), false);
    await again.evaluate((k) => localStorage.removeItem(k), CHECK_KEY);
    await again.reload();
    await again.waitForSelector('html[data-ready="1"]');
    await again.waitForTimeout(500);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});

test('a downloaded copy (file://) without an address: no request at all', { skip }, async () => {
  const s = await site('2026.2'); // built with an empty address
  const browser = await browserFor();
  const { page, errors } = await newPage(browser);
  const outside = [];
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
  try {
    await page.goto(pathToFileURL(path.join(s.out, `${CODE}.html`)).href);
    await ready(page);
    await page.waitForTimeout(1200);
    assert.deepEqual(outside, []);
    assert.deepEqual(s.requests, []);
    assert.equal(await hasStrip(page), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});

test('a downloaded copy (file://) with an address: a newer version gives a link to the hosted map, the same version gives nothing', { skip }, async () => {
  const s = await site('2026.2', { adresse: true });
  const browser = await browserFor();
  const { page, errors } = await newPage(browser);
  try {
    const file = pathToFileURL(path.join(s.out, `${CODE}.html`)).href;
    await page.goto(file);
    await ready(page);
    await page.waitForTimeout(800);
    assert.equal(await hasStrip(page), false, 'same version');
    assert.deepEqual(s.requests, [`/${CODE.toLowerCase()}/${CODE}.versjon.json`], 'the map\'s own folder on the web');
    s.publish('2026.3', { onlyVersionFile: true });
    await page.evaluate((k) => localStorage.removeItem(k), CHECK_KEY);
    await page.reload();
    await ready(page);
    await page.waitForTimeout(800);
    assert.equal(await hasStrip(page), true);
    assert.match(await page.textContent('#oppdatering'), /Ny versjon av kartet \(2026\.3\)\./);
    const link = page.locator('#oppdatering a');
    assert.equal(await link.textContent(), 'Opne ny versjon');
    assert.equal(await link.getAttribute('href'), `${s.base}${CODE.toLowerCase()}/`);
    assert.deepEqual(await page.locator('#oppdatering .btn').allTextContents(), ['Opne ny versjon', 'Seinare']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});

test('host mode (?vising=faglogg): no strip, no service worker, no request for the version file', { skip }, async () => {
  const s = await site('2026.2');
  s.publish('2026.10', { onlyVersionFile: true });
  const browser = await browserFor();
  const { page, errors } = await newPage(browser);
  try {
    await page.goto(`${s.base}${CODE}.html?vising=faglogg`);
    await ready(page);
    await page.waitForTimeout(800);
    assert.equal(await hasStrip(page), false);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
    assert.deepEqual(s.requests.filter((r) => r.includes('versjon') || r.includes('sw.js')), []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.close(); }
});

test('the build: version file, service worker and front page with a link per map (all maps: --offentlege= is empty)', { skip: false }, async () => {
  const s = await site('2026.2');
  try {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.out, `${CODE}.versjon.json`), 'utf8')), { kart: CODE, versjon: '2026.2', fil: `${CODE}.html` });
    assert.match(fs.readFileSync(path.join(s.out, 'sw.js'), 'utf8'), /fagkart:oppdater/);
    const index = fs.readFileSync(path.join(s.out, 'index.html'), 'utf8');
    assert.match(index, /Demokart/);
    assert.match(index, new RegExp(`href="${CODE}\\.html\\?vising=elev"`));
    assert.match(index, new RegExp(`href="${CODE}\\.html">Opne kartet<`)); // the front page (see landing.test.mjs): the map, and the student view
    assert.match(index, /versjon 2026\.2/);
  } finally { await s.close(); }
});
