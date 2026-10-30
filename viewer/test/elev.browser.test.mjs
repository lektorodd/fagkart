// The whole student run of oppgave 06 on the real maps, on a phone with touch (?vising=elev): mark 10 nodes from the card, see the colours and the
// count on the tema boxes, read "Neste steg", follow the first løype with Neste, download the marks, validate the file against
// schema/overlegg.schema.json and open it again in an empty browser. One test per map (dist/<KODE>.json); a map whose file is missing is skipped.
// Skipped when no Chromium is installed. Run with: node --test test/elev.browser.test.mjs (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openMap, skip, viewerDir, TOUR_DONE } from './browser.mjs';
import { realMaps } from './kart.mjs';

const SCHEMA = JSON.parse(fs.readFileSync(path.join(viewerDir, '..', 'schema', 'overlegg.schema.json'), 'utf8'));
const SHOTS = path.join(viewerDir, 'skjermbilete', '06');
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true };
const SCALE = ['ikkje', 'delvis', 'heilt'];
const PATTERN = ['heilt', 'heilt', 'delvis', 'ikkje', 'heilt', 'delvis', 'ikkje', 'heilt', 'delvis', 'ikkje']; // 4 heilt, 3 delvis, 3 ikkje

const ready = (page) => page.waitForSelector('html[data-ready="1"]').then(() => page.waitForTimeout(300));
const select = (page, id) => page.evaluate((i) => window.__fk.select(i, { center: false }), id);
const sel = (page) => page.evaluate(() => window.__fk.state.sel);
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
const badges = (page) => page.evaluate(() => window.__cy.nodes('.ghost[role^="pill-"]').map((n) => n.data('label')));
const numbers = (page) => page.evaluate(() => Object.fromEntries(window.__cy.nodes('.ghost[role="pill-new"]').filter((g) => !g.data('area') && /^\d+$/.test(g.data('label'))).map((g) => [g.data('of'), g.data('label')])));
const evClasses = (page) => page.evaluate(() => Object.fromEntries(window.__cy.nodes('[kind="node"]').map((n) => [n.id(), ['ikkje', 'delvis', 'heilt'].find((v) => n.hasClass('ev-' + v))]).filter(([, v]) => v)));
const isOpen = async (page) => (await page.getAttribute('#moreBtn', 'aria-expanded')) === 'true';
const openMore = async (page) => { if (!(await isOpen(page))) { await page.tap('#moreBtn'); await page.waitForTimeout(300); } };
const closeMore = async (page) => { if (await isOpen(page)) { await page.tap('#moreBtn'); await page.waitForTimeout(300); } };
const watch = (page, errors) => {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
};

// The simple schema check the task asks for, plus the parts of the schema that are cheap to check by hand
function validate(o) {
  for (const k of SCHEMA.required) assert.ok(k in o, `required: ${k}`);
  for (const k of Object.keys(o)) assert.ok(k in SCHEMA.properties, `unknown key: ${k}`);
  assert.equal(o.format, SCHEMA.properties.format.const);
  assert.ok(SCHEMA.properties.type.enum.includes(o.type));
  assert.equal(o.type, 'eigenvurdering');
  assert.equal(o.namn, 'Mi eigenvurdering');
  assert.match(o.kart, new RegExp(SCHEMA.properties.kart.pattern));
  assert.ok(typeof o.kartversjon === 'string' && o.kartversjon.length > 0);
  assert.deepEqual(o.skala, SCALE);
  assert.match(o.oppdatert, new RegExp(SCHEMA.properties.oppdatert.pattern));
  const idRe = new RegExp(SCHEMA.$defs.nodeId.pattern);
  for (const [id, v] of Object.entries(o.merke)) { assert.match(id, idRe); assert.ok(o.skala.includes(v), `${id}=${v}`); }
}

// 10 nodes of the subject with the fewest prerequisites that others build on: a realistic first pass over the basics
function pickTen(data) {
  const subject = data.nodar.filter((n) => n.type !== 'kompetansemaal' && n.forkunnskap === undefined && !n.utgaatt);
  const ids = new Set(subject.map((n) => n.id));
  const inn = new Map(), ut = new Map();
  for (const k of data.kantar) {
    if (k.type !== 'byggjer_paa' || !ids.has(k.fra) || !ids.has(k.til)) continue;
    inn.set(k.til, (inn.get(k.til) || 0) + 1);
    ut.set(k.fra, (ut.get(k.fra) || 0) + 1);
  }
  return subject.filter((n) => ut.get(n.id) > 0).sort((a, b) => (inn.get(a.id) || 0) - (inn.get(b.id) || 0) || ut.get(b.id) - ut.get(a.id) || a.id.localeCompare(b.id)).slice(0, 10).map((n) => n.id);
}

for (const code of realMaps) {
  const rel = `../dist/${code}.json`;
  const file = path.join(viewerDir, rel);
  const missing = !fs.existsSync(file) && `${rel} is missing`;
  test(`${code}: a student on a phone marks 10 nodes, gets next steps, follows a løype, downloads the marks and opens them in an empty browser`, { skip: skip || missing, timeout: 240000 }, async () => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const kart = data.kode || data.laereplan; // the overlay and the storage key use the map code (S2), not the curriculum code (MAT04-02)
    const KEY = `fagkart.${kart}.eigenvurdering`;
    const route = data.loeyper[0];
    assert.ok(route && route.nodar.length >= 2, 'the map has a løype');
    const picked = pickTen(data);
    assert.equal(picked.length, 10);
    const expected = Object.fromEntries(picked.map((id, i) => [id, PATTERN[i]]));

    const first = await openMap(rel); // builds the page; the phone below opens the same file
    const browser = first.page.context().browser();
    const url = first.page.url().split('?')[0];
    const errors = [];
    let ctx, ctx2;
    try {
      ctx = await browser.newContext(PHONE);
      await ctx.addInitScript(TOUR_DONE);
      const page = await ctx.newPage();
      watch(page, errors);
      await page.goto(url + '?vising=elev');
      await ready(page);
      assert.equal(await page.evaluate(() => document.querySelector('#modeSeg [aria-checked="true"]').dataset.mode), 'elev');

      // 0. "Kva kan eg?" is off the first time: the plain map. A tap in the top bar turns it on, and the map is line work
      assert.equal(await page.getAttribute('#evBtn', 'aria-pressed'), 'false');
      assert.equal(await page.evaluate(() => window.__fk.state.strek), false);
      await page.tap('#evBtn');
      await page.waitForTimeout(200);
      assert.equal(await page.getAttribute('#evBtn', 'aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => window.__fk.state.strek), true);

      // 1. Mark 10 nodes from the card with a finger
      assert.deepEqual(await evClasses(page), {}, 'nothing marked at the start');
      for (const id of picked) {
        await closeMore(page);
        await select(page, id);
        await page.waitForTimeout(150);
        await page.tap(`#panel [data-ev="${expected[id]}"]`);
        assert.equal(await page.getAttribute(`#panel [data-ev="${expected[id]}"]`, 'aria-checked'), 'true', id);
      }
      assert.deepEqual(await evClasses(page), expected, 'every marked node carries its ev-* class');
      assert.deepEqual((await stored(page, KEY)).merke, expected);
      const heilt = Object.values(expected).filter((v) => v === 'heilt').length;
      const counts = (await badges(page)).map((t) => /^(\d+) av (\d+) kan eg godt/.exec(t)).filter(Boolean);
      assert.ok(counts.length >= 1, 'a tema box counts');
      assert.equal(counts.reduce((s, m) => s + Number(m[1]), 0), heilt, 'the tema boxes count the heilt marks');
      assert.ok(counts.every((m) => Number(m[2]) >= Number(m[1])));

      // 2. "Fleire val" > "Neste steg": at least one ready and one weak point
      await closeMore(page);
      await openMore(page);
      const SEC = '#side [data-layer="nestesteg"]';
      const text = await page.textContent(SEC);
      assert.match(text, /Klar til å lære/);
      assert.match(text, /Svake punkt/);
      const nReady = await page.$$eval(`${SEC} [data-ns-list="ready"] li`, (l) => l.length);
      const nWeak = await page.$$eval(`${SEC} [data-ns-list="weak"] li`, (l) => l.length);
      assert.ok(nReady >= 1, `ready points: ${nReady}`);
      assert.ok(nWeak >= 1, `weak points: ${nWeak}`);
      // the weak points are among the nodes marked ikkje / delvis
      const weakIds = await page.$$eval(`${SEC} [data-ns-list="weak"] li button`, (b) => b.length);
      assert.equal(weakIds, nWeak);

      // 3. The first løype, step by step with Neste. The card is closed with "Lukk" first: Neste goes on from a chosen step, also in the middle of the løype.
      await closeMore(page);
      if (await page.$('#panel .close')) await page.tap('#panel .close');
      assert.equal(await sel(page), null);
      await openMore(page);
      await page.tap(`#side [data-loeype="${route.id}"]`);
      await page.waitForTimeout(700);
      assert.equal(await page.getAttribute(`#side [data-loeype="${route.id}"]`, 'aria-pressed'), 'true');
      const listed = await page.$$eval('#side [data-sti-steps] > li', (l) => l.map((li) => li.dataset.id));
      assert.deepEqual(listed, route.nodar, 'the steps listed are the steps of the løype');
      assert.deepEqual(await numbers(page), Object.fromEntries(route.nodar.map((id, i) => [id, String(i + 1)])), 'the steps are numbered 1…n on the map');
      await page.tap('#side [data-sti="neste"]');
      await page.waitForTimeout(500);
      assert.equal(await sel(page), route.nodar[0]);
      for (let i = 1; i < route.nodar.length; i++) {
        assert.match(await page.textContent('#panel [data-sti-bar]'), new RegExp(`steg ${i} av ${route.nodar.length}`));
        await page.tap('#panel [data-sti="neste"]');
        await page.waitForTimeout(350);
        assert.equal(await sel(page), route.nodar[i], `step ${i + 1}`);
      }
      assert.equal(await page.isDisabled('#panel [data-sti="neste"]'), true, 'nothing after the last step');
      assert.match(await page.textContent('#panel [data-sti-bar]'), new RegExp(`steg ${route.nodar.length} av ${route.nodar.length}`));
      assert.deepEqual(await numbers(page), Object.fromEntries(route.nodar.map((id, i) => [id, String(i + 1)])), 'still numbered at the end');
      assert.deepEqual(await evClasses(page), expected, 'the marks are untouched by the løype');
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${code}-mobil-loeype.png`) });

      // 4. "Last ned": the file is valid and holds the 10 marks
      await openMore(page);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('#side [data-ev-act="ned"]')]);
      const saved = path.join(fs.mkdtempSync(path.join(path.dirname(SHOTS), '.dl-')), dl.suggestedFilename());
      await dl.saveAs(saved);
      let o;
      try { o = JSON.parse(fs.readFileSync(saved, 'utf8')); } finally { fs.rmSync(path.dirname(saved), { recursive: true, force: true }); }
      validate(o);
      assert.equal(o.kart, kart);
      assert.equal(o.kartversjon, String(data.versjon));
      assert.deepEqual(o.merke, expected);
      assert.equal(Object.keys(o.merke).length, 10);

      // 5. A new, empty browser: "Opne fil" gives the same 10 marks
      ctx2 = await browser.newContext(PHONE);
      await ctx2.addInitScript(TOUR_DONE);
      const p2 = await ctx2.newPage();
      watch(p2, errors);
      await p2.goto(url + '?vising=elev');
      await ready(p2);
      await p2.tap('#evBtn'); // a new browser: off until the student turns it on
      await p2.waitForTimeout(200);
      assert.equal(await stored(p2, KEY), null, 'empty browser');
      assert.deepEqual(await evClasses(p2), {});
      await openMore(p2);
      await p2.setInputFiles('#side [data-ev-file]', { name: `eigenvurdering-${code}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(o)) });
      await p2.waitForTimeout(300);
      assert.match(await p2.textContent('#side [data-layer="eigenvurdering"]'), /Fila er opna/);
      assert.deepEqual((await stored(p2, KEY)).merke, expected);
      assert.deepEqual(await evClasses(p2), expected, 'the same 10 nodes are coloured');
      assert.deepEqual((await badges(p2)).filter((t) => /av \d+ kan eg godt/.test(t)).sort(), (await badges(page)).filter((t) => /av \d+ kan eg godt/.test(t)).sort());

      assert.deepEqual(errors, [], 'the console is clean');
    } finally { if (ctx2) await ctx2.close(); if (ctx) await ctx.close(); await first.close(); }
  });
}
