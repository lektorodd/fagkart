// The walk-through for students (src/gjennomgang.js) in the real page: first time in the student view, done / skipped is remembered per page,
// not in the teacher view or host mode, started again from the help box, hidden elements are skipped, keys, and the bubble does not cover the element.
// Screenshots go to skjermbilete/12. Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openMap, skip, viewerDir } from './browser.mjs';

const MAP = 'fixtures/DEMO-01.json';
const KEY = 'fagkart.gjennomgang';
const SHOTS = path.join(viewerDir, 'skjermbilete', '12');
const base = (page) => page.url().split('?')[0];
const ready = (page) => page.waitForSelector('html[data-ready="1"]').then(() => page.waitForTimeout(250));
const open = (page) => page.evaluate(() => !!document.querySelector('.fktour'));
const count = (page) => page.textContent('.fktour-count');
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const tourPage = (opts = {}) => openMap(MAP, [], { ...opts, gjennomgang: true });
const goto = async (page, query) => { await page.goto(base(page) + query); await ready(page); await page.waitForTimeout(500); };
const shot = (page, name) => { fs.mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: path.join(SHOTS, name) }); };
// the bubble and the lit element must not overlap (the map itself is too big to leave free)
const overlap = (page, sel) => page.evaluate((s) => {
  const a = document.querySelector(s).getBoundingClientRect(), b = document.querySelector('.fktour-bubble').getBoundingClientRect();
  return !(b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom);
}, sel);
const inside = (page) => page.evaluate(() => { const b = document.querySelector('.fktour-bubble').getBoundingClientRect(); return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; });

test('first time in the student view: starts by itself, steps, "Ferdig" is remembered, and it does not come back after a reload', { skip }, async () => {
  const { page, errors, close } = await tourPage();
  try {
    assert.equal(await open(page), false, 'not in the teacher view');
    await goto(page, '?vising=elev');
    assert.equal(await open(page), true, 'starts by itself');
    assert.equal(await page.getAttribute('.fktour-bubble', 'role'), 'dialog');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.t), 'next', 'focus on "Neste"');
    const total = Number((await count(page)).match(/av (\d+)/)[1]);
    assert.ok(total >= 4 && total <= 5);
    assert.equal(await count(page), `1 av ${total}`);
    assert.equal(await page.isHidden('.fktour-bubble [data-t="prev"]'), true, 'no "Førre" at the start');
    assert.equal(await overlap(page, '#levelBtns'), false, 'step 1: the bubble does not cover the element');
    await page.waitForTimeout(400);
    await shot(page, 'desktop-steg1.png');
    await page.click('[data-t="next"]');
    assert.equal(await count(page), `2 av ${total}`);
    await page.click('[data-t="prev"]');
    assert.equal(await count(page), `1 av ${total}`);
    for (let i = 1; i < total; i++) await page.click('[data-t="next"]');
    assert.equal(await page.textContent('[data-t="next"]'), 'Ferdig');
    assert.equal(await stored(page), null, 'not stored before it is done');
    await page.click('[data-t="next"]');
    assert.equal(await open(page), false);
    assert.equal(await stored(page), 'ferdig');
    await page.reload();
    await ready(page);
    await page.waitForTimeout(600);
    assert.equal(await open(page), false, 'does not come back');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('"Hopp over" and Escape end it for good; arrow keys step; "Vis gjennomgangen" in the help box starts it again', { skip }, async () => {
  const { page, errors, close } = await tourPage();
  try {
    await goto(page, '?vising=elev');
    await page.keyboard.press('ArrowRight');
    assert.match(await count(page), /^2 av /);
    await page.keyboard.press('ArrowLeft');
    assert.match(await count(page), /^1 av /);
    await page.keyboard.press('Escape');
    assert.equal(await open(page), false, 'Escape = skip');
    assert.equal(await stored(page), 'ferdig');
    assert.equal(await page.isVisible('#helpBox'), false, 'Escape did not also do something to the page');
    await page.reload();
    await ready(page);
    await page.waitForTimeout(600);
    assert.equal(await open(page), false);
    await page.click('#helpBtn');
    assert.equal(await page.isVisible('#tourBtn'), true);
    await page.click('#tourBtn');
    assert.equal(await open(page), true, 'started again');
    assert.equal(await page.isVisible('#helpBox'), false);
    await page.click('[data-t="skip"]');
    assert.equal(await open(page), false, '"Hopp over"');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('not in the teacher view or host mode, and no button in the help box there', { skip }, async () => {
  const { page, errors, close } = await tourPage();
  try {
    await goto(page, '?vising=laerar');
    assert.equal(await open(page), false);
    await page.click('#helpBtn');
    assert.equal(await page.isHidden('#tourBtn'), true, 'no button for the teacher');
    await goto(page, '?vising=faglogg');
    assert.equal(await open(page), false);
    assert.equal(await stored(page), null);
    await goto(page, '?vising=elev');
    assert.equal(await open(page), true, 'but the student view gets it');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('storage blocked: it is shown, and does not nag again in the same visit', { skip }, async () => {
  const blocked = () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); };
  const { page, errors, close } = await tourPage({ init: blocked });
  try {
    await goto(page, '?vising=elev');
    assert.equal(await open(page), true, 'shown');
    await page.click('[data-t="skip"]');
    assert.equal(await open(page), false);
    await page.evaluate(() => window.__tour.start());
    await page.evaluate(() => window.__tour.finish());
    await page.reload();
    await ready(page);
    await page.waitForTimeout(600);
    assert.equal(await open(page), false, 'not again in the same visit');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a hidden element is skipped', { skip }, async () => {
  const { page, errors, close } = await tourPage();
  try {
    await goto(page, '?vising=elev');
    const withBtn = Number((await count(page)).match(/av (\d+)/)[1]);
    await page.evaluate(() => window.__tour.finish());
    await page.evaluate(() => { document.getElementById('evBtn').hidden = true; window.__tour.start(); });
    const without = Number((await count(page)).match(/av (\d+)/)[1]);
    assert.equal(without, withBtn - 1);
    const texts = [];
    for (let i = 0; i < without; i++) { texts.push(await page.textContent('.fktour-text')); if (i < without - 1) await page.click('[data-t="next"]'); }
    assert.ok(!texts.some((t) => /markere kva du kan/.test(t)), 'the step of the hidden button is not shown');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the tour blocks the page behind it, and dark mode works', { skip }, async () => {
  const { page, errors, close } = await tourPage({ colorScheme: 'dark' });
  try {
    await goto(page, '?vising=elev');
    await page.mouse.click(700, 500, { force: true });
    assert.equal(await open(page), true, 'a click on the map does not end it');
    assert.equal(await page.evaluate(() => !!window.__fk.state.sel), false, 'and does not choose anything');
    await page.waitForTimeout(400);
    await shot(page, 'desktop-morkt.png');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('on a phone (390×844, touch): every step fits on the screen without covering the element', { skip }, async () => {
  const first = await tourPage();
  let ctx = null;
  try {
    ctx = await first.page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(base(first.page) + '?vising=elev');
    await ready(page);
    await page.waitForTimeout(600);
    assert.equal(await open(page), true);
    const total = Number((await count(page)).match(/av (\d+)/)[1]);
    for (let i = 0; i < total; i++) {
      await page.waitForTimeout(400); // the spot and the bubble glide to their place
      assert.ok(await inside(page), `step ${i + 1}: the bubble is on the screen`);
      const [t, b] = await page.evaluate(() => ['.fktour-spot', '.fktour-bubble'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
      const big = (t[2] - t[0]) * (t[3] - t[1]) > 390 * 844 * 0.3; // the map itself is too big to leave free
      if (!big) assert.ok(b[2] <= t[0] || b[0] >= t[2] || b[3] <= t[1] || b[1] >= t[3], `step ${i + 1}: the bubble does not cover the element`);
      if (i === 0) await shot(page, 'mobil-steg1.png');
      if (i === 2) await shot(page, 'mobil-steg3.png');
      if (i < total - 1) await page.tap('[data-t="next"]');
    }
    await page.tap('[data-t="next"]');
    assert.equal(await open(page), false);
    assert.deepEqual(errors, []);
  } finally { if (ctx) await ctx.close(); await first.close(); }
});
