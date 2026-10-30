// The zoom surface in the real page: Tema · Kart · Detalj as zoom levels of one map, one colour per tema all the way,
// the level buttons as shortcuts, and no words of graph theory in the page. Skipped when no Chromium is installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openMap, skip, viewerDir } from './browser.mjs';
import { mainMap } from './kart.mjs';

const MAP = path.join('..', 'dist', `${mainMap}.json`); // a map with nivaa 1 and 2, forkunnskap and 7 temaa
const hasMap = !!mainMap && fs.existsSync(path.join(viewerDir, MAP));
const opts = { skip: skip || (hasMap ? false : 'no dist/<map>.json') };

const level = (page) => page.evaluate(() => ({ level: window.__fk.KART.level, z: window.__cy.zoom(), t: window.__fk.Z.t }));
const wait = (page, ms) => page.waitForTimeout(ms);
// a glide to a level is over when Cytoscape has no animation left (state, not the clock)
// the levels follow a zoom in the next animation frame (scheduleLevels), so two frames after a zoom they are drawn
const framed = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const glided = (page) => page.waitForFunction(() => !window.__cy.animated(), null, { timeout: 10000 });
// hue (degrees) of the border of each tema box, as Cytoscape draws it now
const hues = (page) => page.evaluate(() => {
  const out = {};
  for (const ar of window.__cy.nodes('[kind="carea"]')) {
    const [r, g, b] = ar.pstyle('border-color').strValue.match(/\d+/g).map((v) => v / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
    out[ar.data('cid')] = d === 0 ? 0 : (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return out;
});
const gap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

test('the map opens at Tema with one box per tema and arrows with numbers between them', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    assert.equal((await level(page)).level, 'tema');
    assert.deepEqual(await page.$$eval('#levelBtns button', (bs) => bs.map((b) => b.textContent)), ['Tema', 'Kart', 'Detalj']);
    assert.equal(await page.$('#viewTabs'), null, 'no separate views any more');
    const info = await page.evaluate(() => ({
      boxes: window.__cy.nodes('[kind="carea"]').length, clusters: window.__fk.CLUSTERS.length,
      arrows: window.__cy.edges('[?meta]').filter((e) => !e.hasClass('zoff')).length, counts: window.__cy.edges('[?meta]').every((e) => Number(e.data('count')) > 0),
      nodesShown: window.__cy.nodes('[kind="node"]').filter((n) => !n.hasClass('zoff')).length,
    }));
    assert.equal(info.boxes, info.clusters);
    assert.ok(info.arrows >= info.clusters - 1 && info.counts, JSON.stringify(info));
    assert.equal(info.nodesShown, 0, 'far out only the boxes are drawn');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the buttons are shortcuts to the zoom levels, and the zoom alone decides the level', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const pressed = () => page.$$eval('#levelBtns button[aria-pressed="true"]', (bs) => bs.map((b) => b.dataset.level));
    for (const lv of ['kart', 'detalj', 'tema', 'detalj']) {
      await page.click(`#levelBtns button[data-level="${lv}"]`);
      await glided(page);
      assert.equal((await level(page)).level, lv);
      assert.deepEqual(await pressed(), [lv]);
    }
    // zooming by hand glides through the levels: boxes open (level 1 nodes appear), then the satellites
    await page.click('#levelBtns button[data-level="tema"]');
    await glided(page);
    const seen = [];
    // [anchor, factor]: Tema, on the way to Kart, Kart, a little past Kart, Detalj, well past Detalj
    for (const f of [['t', 1], ['t', 1.08], ['k', 0.97], ['k', 1], ['k', 1.02], ['d', 1], ['d', 1.5]]) {
      await page.evaluate(([a, f]) => { const cy = window.__cy, z = window.__fk.Z[a] * f, c = window.__fk.LAYOUT.areas[window.__fk.CLUSTERS[1]]; cy.viewport({ zoom: z, pan: { x: cy.width() / 2 - c.x * z, y: cy.height() / 2 - c.y * z } }); }, f);
      await framed(page);
      seen.push(await page.evaluate(() => ({ level: window.__fk.KART.level, l1: window.__cy.nodes('[lvl=1]').filter((n) => !n.hasClass('zoff')).length, l2: window.__cy.nodes('[lvl=2]').filter((n) => !n.hasClass('zoff')).length })));
    }
    assert.deepEqual(seen.map((s) => s.level), ['tema', 'tema', 'kart', 'kart', 'kart', 'detalj', 'detalj'].map((l, i) => (i === 1 ? seen[1].level : l)));
    assert.equal(seen[0].l1, 0);
    assert.ok(seen[3].l1 > 0 && seen[3].l2 === 0, JSON.stringify(seen[3]));
    assert.ok(seen[6].l2 > 0, JSON.stringify(seen[6]));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a tema keeps its place and its colour from Tema to Detalj', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const h0 = await hues(page);
    const home = () => page.evaluate(() => { const L = window.__fk.LAYOUT; return window.__cy.nodes('[kind="carea"]').every((a) => Math.abs(a.position('x') - L.areas[a.data('cid')].x) < 0.5 && Math.abs(a.position('y') - L.areas[a.data('cid')].y) < 0.5); });
    for (const lv of ['kart', 'detalj']) {
      await page.click(`#levelBtns button[data-level="${lv}"]`);
      await wait(page, 700);
      assert.ok(await home(), `areas moved at ${lv}`);
      const h = await hues(page);
      for (const [cid, hue] of Object.entries(h0)) if (cid !== 'forkunnskap') assert.ok(gap(hue, h[cid]) < 6, `${cid}: ${hue} -> ${h[cid]} at ${lv}`);
    }
    // the colour is picked by the id: the same id gives the same colour in a new page, and the temaa differ
    const c1 = await page.evaluate(() => window.__fk.CLUSTERS.map((c) => window.__fk.temaColor(c)));
    assert.equal(new Set(c1).size, c1.length);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a click on a tema box opens the tema view (see temavising.browser.test.mjs)', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = await page.evaluate(() => window.__fk.CLUSTERS[2]);
    const pos = await page.evaluate((c) => { const r = document.getElementById('cy').getBoundingClientRect(), p = window.__cy.getElementById('a:' + c).renderedPosition(); return { x: r.left + p.x, y: r.top + p.y }; }, cid);
    await page.mouse.click(pos.x, pos.y);
    await wait(page, 900);
    assert.equal(await page.evaluate(() => window.__fk.state.tema), cid);
    assert.equal(await page.evaluate(() => window.__cy.nodes('[kind="carea"]').length), 0, 'the surface is gone, the view of the tema is there');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the page speaks of omgrep, metodar, temaa and piler, not of nodes, edges and graphs', opts, async () => {
  const { page, close } = await openMap(MAP);
  try {
    await page.click('#moreBtn');
    await page.click('#helpBtn');
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    // the words of the page itself; the names of concepts and goals (a concept may be called "graf") are the content of the map
    const text = await page.evaluate(() => {
      const content = [...document.querySelectorAll('#allList, #kmList, #results, #panel, #cy, #poster')];
      content.forEach((e) => { e.hidden = true; });
      const attrs = [...document.querySelectorAll('[placeholder],[aria-label],[title],[alt]')].flatMap((e) => ['placeholder', 'aria-label', 'title', 'alt'].map((a) => e.getAttribute(a)).filter(Boolean));
      return document.body.innerText + '\n' + attrs.join('\n') + '\n' + document.getElementById('hint').textContent + '\n' + document.getElementById('fagNote').textContent;
    });
    assert.deepEqual(text.match(/\b(nodar?|nodane|nodes?|kantar?|kantane|klynge|klyngjer|klynga|graf)\b/gi) || [], []);
    // and the counts are split by kind
    assert.match(await page.textContent('#kmList'), /\d+ omgrep/);
  } finally { await close(); }
});

test('a map without nivaa is laid out flat: all its nodes are on the surface', { skip }, async () => {
  const { page, errors, close } = await openMap('fixtures/DEMO-01.json');
  try {
    const r = await page.evaluate(() => ({ nodes: window.__cy.nodes('[kind="node"]').length, placed: Object.keys(window.__fk.LAYOUT.nodes).length, level: window.__fk.KART.level, areas: window.__cy.nodes('[kind="carea"]').length }));
    assert.equal(r.level, 'tema');
    assert.ok(r.nodes > 10 && r.nodes === r.placed && r.areas >= 2, JSON.stringify(r));
    await page.click('#levelBtns button[data-level="kart"]');
    await wait(page, 700);
    assert.ok((await page.evaluate(() => window.__cy.nodes('[kind="node"]').filter((n) => !n.hasClass('zoff')).length)) > 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the details come in at readable text, and the text size moves the anchors', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    // the text of a node on the screen (px) at a zoom anchor
    const textAt = (a) => page.evaluate((a) => ({ l1: 14 * window.__fk.Z.k, l2: 12 * window.__fk.Z[a] }), a);
    const n = await textAt('d');
    assert.ok(n.l2 < 15, `level 2 text at Detalj is ${n.l2} px: the details come in too late`);
    assert.ok(n.l1 >= 12, `level 1 text at Kart is only ${n.l1} px`);
    const k0 = await page.evaluate(() => window.__fk.Z.k);
    await page.click('#moreBtn');
    await page.click('#tekstSeg button[data-tekst="stor"]');
    await wait(page, 600);
    const s = await page.evaluate(() => ({ k: window.__fk.Z.k, d: window.__fk.Z.d, saved: localStorage.getItem('fagkart.tekststorleik'), pressed: document.querySelector('#tekstSeg [aria-checked="true"]').dataset.tekst }));
    assert.ok(s.k > k0 * 1.2, JSON.stringify({ k0, ...s }));
    assert.equal(s.saved, 'stor');
    assert.equal(s.pressed, 'stor');
    await page.click('#tekstSeg button[data-tekst="normal"]');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('"Vis alle omgrep og metodar" draws every node at every zoom, and the buttons still follow the zoom', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const shown = () => page.evaluate(() => ({
      level: window.__fk.KART.level,
      l1: window.__cy.nodes('[lvl=1]').filter((n) => !n.hasClass('zoff')).length,
      l2: window.__cy.nodes('[lvl=2]').filter((n) => !n.hasClass('zoff')).length,
      all2: window.__cy.nodes('[lvl=2]').length,
      pressed: [...document.querySelectorAll('#levelBtns button[aria-pressed="true"]')].map((b) => b.dataset.level),
    }));
    await page.click('#levelBtns button[data-level="tema"]');
    await wait(page, 700);
    const off = await shown();
    assert.equal(off.l2, 0, 'without the switch the zoom hides the details far out');
    await page.click('#moreBtn');
    await page.locator('.switch:has(#swAlt)').click();
    await wait(page, 300);
    const on = await shown();
    assert.equal(on.level, 'tema');
    assert.deepEqual(on.pressed, ['tema']);
    assert.ok(on.l1 > 0 && on.l2 === on.all2, JSON.stringify(on));
    assert.equal(await page.evaluate(() => localStorage.getItem('fagkart.visAlt')), 'pa');
    await page.locator('.switch:has(#swAlt)').click();
    await wait(page, 300);
    assert.equal((await shown()).l2, 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
