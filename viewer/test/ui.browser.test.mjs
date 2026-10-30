// The page as a person meets it: only the top bar and the map at the start, everything else behind "Fleire val", the card with closed
// sections, and no arrow through a box. Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openMap, skip, viewerDir } from './browser.mjs';
import { mainMap, realMaps } from './kart.mjs';

const MAP = path.join('..', 'dist', `${mainMap}.json`);
const hasMap = !!mainMap && fs.existsSync(path.join(viewerDir, MAP));
const opts = { skip: skip || (hasMap ? false : 'no dist/<map>.json') };
const FAG = hasMap ? JSON.parse(fs.readFileSync(path.join(viewerDir, MAP), 'utf8')).forkunnskapsfag : []; // the subjects (or roads, 1P-S1) the students come from: the buttons of "Fleire val"
const wait = (page, ms) => page.waitForTimeout(ms);
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && !e.hidden && r.width > 0 && r.height > 0; }, sel);
// one node with a misconception, so the card has a closed section to open
const pickNode = (page) => page.evaluate(() => {
  const d = JSON.parse(document.getElementById('fagkart-data').textContent);
  return d.nodar.find((n) => !n.forkunnskap && n.type !== 'kompetansemaal' && n.misoppfatning && n.tekst_laerar && n.tekst_elev).id;
});

test('at the start only the top bar and the map are there', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    assert.deepEqual(await page.evaluate(() => [...document.querySelector('.top').children].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => e.id || e.className.split(' ')[0])),
      ['brand', 'levelBtns', 'search', 'modeSeg', 'moreBtn']);
    for (const sel of ['#side', '#panel', '#helpBox', '#focusChip', '#backdrop']) assert.equal(await visible(page, sel), false, sel + ' is closed');
    assert.equal(await visible(page, '#cy'), true);
    assert.equal(await page.getAttribute('#moreBtn', 'aria-expanded'), 'false');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('"Fleire val" holds everything that was in the side panel, and closes again', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await page.click('#moreBtn');
    assert.equal(await visible(page, '#side'), true);
    assert.equal(await page.getAttribute('#moreBtn', 'aria-expanded'), 'true');
    const has = (sel) => page.$(`#side ${sel}`).then(Boolean);
    for (const sel of [...FAG.map((f) => `#fagSeg button[data-fag="${f}"]`), '#swFk', '#swImpl', '#chKlynge .chip', '#chType .chip', '#chKjerne .chip', '#kmList .kmitem', '#allList button', '#printBtn', '#allQ']) assert.ok(await has(sel), sel);
    // no explanation text under the switches
    assert.equal(await page.$$eval('#side .switch small', (e) => e.length), 0);
    assert.equal(await visible(page, '#fagNote'), false);
    // the print button is there to use
    assert.equal(await visible(page, '#printBtn'), true);
    await page.keyboard.press('Escape');
    assert.equal(await visible(page, '#side'), false);
    // a click on the map closes it as well
    await page.click('#moreBtn');
    await page.mouse.click(300, 600);
    await wait(page, 150);
    assert.equal(await visible(page, '#side'), false);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the choices in "Fleire val" still work: subject, implied arrows, filter, goals, the list of everything and Lærar | Elev', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await page.click('#moreBtn');
    // subject
    await page.click(`#fagSeg button[data-fag="${FAG[0]}"]`);
    assert.ok((await page.evaluate(() => window.__cy.nodes('.ghost[role^="pill-"]').length)) > 0, `badges for ${FAG[0]}`);
    assert.ok((await page.textContent('#stView')).startsWith(FAG[0].split('-')[0]), 'the status line names the subject');
    // implied arrows
    const arrows = () => page.evaluate(() => window.__cy.edges('[?kart]').filter((e) => !e.hasClass('hide')).length);
    const before = await arrows();
    await page.click('.switch:has(#swImpl)');
    assert.ok((await arrows()) > before, 'implied arrows show');
    await page.click('.switch:has(#swImpl)');
    // filter
    await page.evaluate(() => document.querySelector('#side details.sec:not(#visningSec)').open = true); // Filter
    await page.locator('#chType .chip').first().click();
    assert.match(await page.textContent('#stFilter'), /1 aktive/);
    assert.equal(await visible(page, '#moreDot'), true, 'a dot on the button while a choice is made');
    await page.click('#clearFilters');
    // the list of everything: filter it, choose one
    await page.evaluate(() => document.querySelectorAll('#side details.sec').forEach((d) => { d.open = true; }));
    const all = () => page.$$eval('#allList li[data-q]:not([hidden])', (l) => l.length);
    const n0 = await all();
    assert.ok(n0 > 50);
    await page.fill('#allQ', 'derivert');
    const n1 = await all();
    assert.ok(n1 >= 1 && n1 < n0, `${n1} of ${n0}`);
    await page.locator('#allList li:not([hidden]) button').first().click();
    await wait(page, 700);
    assert.ok(await page.evaluate(() => !!window.__fk.state.sel), 'a click in the list chooses the node');
    assert.equal(await visible(page, '#side'), false, 'and closes the drawer');
    assert.equal(await visible(page, '#panel'), true);
    // goals
    await page.keyboard.press('Escape');
    await page.click('#moreBtn');
    await page.locator('#kmList .kmitem').first().click();
    await wait(page, 500);
    assert.ok(await page.evaluate(() => !!window.__fk.state.km));
    assert.equal(await visible(page, '#focusChip'), true, 'the chosen goal is shown on the map');
    await page.click('#focusChipClear');
    assert.equal(await visible(page, '#focusChip'), false);
    // Lærar | Elev
    assert.equal(await page.getAttribute('#modeSeg button[data-mode="laerar"]', 'aria-checked'), 'true');
    await page.click('#modeSeg button[data-mode="elev"]');
    assert.equal(await page.evaluate(() => window.__fk.state.elev), true);
    assert.equal(await page.getAttribute('#modeSeg button[data-mode="elev"]', 'aria-checked'), 'true');
    await page.click('#modeSeg button[data-mode="laerar"]');
    assert.equal(await page.evaluate(() => window.__fk.state.elev), false);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the legend is a "?" in the corner of the map, with the arrows that are drawn now', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    assert.equal(await visible(page, '#hintbar'), false);
    assert.equal(await page.$('#hintbar'), null, 'no fixed text at the bottom of the map');
    await page.click('#helpBtn');
    assert.equal(await visible(page, '#helpBox'), true);
    const kinds = () => page.evaluate(() => [...document.querySelectorAll('#legend .legrow')].map((r) => r.dataset.et));
    assert.deepEqual(await kinds(), ['byggjer_paa']);
    assert.equal(await page.$('#legend input'), null, 'the legend has no switches');
    // "Vis andre koplingar" brings the other four arrows, on the map and in the legend
    await page.click('#moreBtn');
    await page.click('.switch:has(#swKopl)');
    assert.deepEqual(await kinds(), ['byggjer_paa', 'brukar', 'doeme_paa', 'representerast_som', 'forvekslast_med']);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the card: the explanation and the example first, the rest in closed sections that remember what was opened', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const id = await pickNode(page);
    await page.evaluate((nid) => window.__fk.select(nid, { center: false }), id);
    const panel = () => page.evaluate(() => ({
      title: document.querySelector('#panel h2').textContent,
      callouts: [...document.querySelectorAll('#panel > .callout .t')].map((e) => e.textContent),
      folds: [...document.querySelectorAll('#panel .fold')].map((d) => [d.dataset.fold, d.open]),
    }));
    let p = await panel();
    // "Lett å blande med" follows the example when the node has forvekslast med (koplingar.browser.test.mjs)
    const main = (c) => c.filter((t) => t !== 'Lett å blande med');
    assert.deepEqual(main(p.callouts), ['Forklaring til lærar', 'Døme']);
    assert.ok(p.folds.length >= 3 && p.folds.every(([, open]) => !open), JSON.stringify(p.folds));
    const keys = p.folds.map(([k]) => k);
    for (const k of ['elevtekst', 'misoppfatning', 'km', 'byggjer']) assert.ok(keys.includes(k), k + ' is a section');
    // the student's view: the student's text is the explanation, and the teacher's text is not there
    await page.click('#modeSeg button[data-mode="elev"]');
    p = await panel();
    assert.deepEqual(main(p.callouts), ['Forklaring', 'Døme']);
    assert.ok(!p.folds.some(([k]) => k === 'elevtekst'));
    await page.click('#modeSeg button[data-mode="laerar"]');
    // open one: it stays open on the next node and after a reload
    await page.click('#panel .fold[data-fold="misoppfatning"] > summary');
    const other = await page.evaluate((nid) => { const d = JSON.parse(document.getElementById('fagkart-data').textContent); return d.nodar.find((n) => n.id !== nid && !n.forkunnskap && n.type !== 'kompetansemaal' && n.misoppfatning).id; }, id);
    await page.evaluate((nid) => window.__fk.select(nid, { center: false }), other);
    assert.equal(await page.evaluate(() => document.querySelector('#panel .fold[data-fold="misoppfatning"]').open), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fagkart.opneSeksjonar')).includes('misoppfatning')), true);
    await page.reload();
    await page.waitForSelector('html[data-ready="1"]');
    await page.evaluate((nid) => window.__fk.select(nid, { center: false }), id);
    assert.equal(await page.evaluate(() => document.querySelector('#panel .fold[data-fold="misoppfatning"]').open), true, 'remembered after a reload');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the card works when the browser blocks localStorage', opts, async () => {
  const { page, errors, close } = await openMap(MAP, [], { init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); } });
  try {
    const id = await pickNode(page);
    await page.evaluate((nid) => window.__fk.select(nid, { center: false }), id);
    await page.click('#panel .fold[data-fold="misoppfatning"] > summary');
    assert.equal(await page.evaluate(() => document.querySelector('#panel .fold[data-fold="misoppfatning"]').open), true);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

// the arrows as drawn: no arrow goes through a box that is drawn
async function arrowsThroughBoxes(page) {
  return page.evaluate(() => {
    const cy = window.__cy, out = [];
    const rects = cy.nodes('[kind="node"]').filter((n) => !n.hasClass('zoff') && !n.hasClass('hide') && n.data('op') > 0.05).map((n) => { const p = n.position(), w = n.data('cw'), h = n.data('ch'); return { id: n.id(), x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2 }; });
    let drawn = 0;
    for (const e of cy.edges().filter((x) => x.data('kart') && !x.hasClass('zoff') && !x.hasClass('hide') && x.data('op') > 0.02)) {
      drawn++;
      const pts = e._private.rscratch.allpts;
      if (!e.data('rt') || !pts || pts.length < 4) { out.push(e.id() + ' has no route'); continue; }
      for (let i = 2; i + 1 < pts.length; i += 2) {
        const x1 = Math.min(pts[i - 2], pts[i]), x2 = Math.max(pts[i - 2], pts[i]), y1 = Math.min(pts[i - 1], pts[i + 1]), y2 = Math.max(pts[i - 1], pts[i + 1]);
        for (const r of rects) if (x1 < r.x2 - 1.5 && x2 > r.x1 + 1.5 && y1 < r.y2 - 1.5 && y2 > r.y1 + 1.5) out.push(`${e.id()} through ${r.id}`);
      }
    }
    return { drawn, bad: [...new Set(out)] };
  });
}
for (const [label, viewport] of [['wide', { width: 1400, height: 900 }], ['upright phone', { width: 390, height: 844 }]]) {
  for (const code of realMaps.slice(-2)) { // the two last maps
    test(`${code} (${label}): at Kart no arrow goes through a box, and at Detalj neither`, { skip: skip || (fs.existsSync(path.join(viewerDir, '..', 'dist', code + '.json')) ? false : 'no dist') }, async () => {
      const { page, errors, close } = await openMap(path.join('..', 'dist', code + '.json'), [], { viewport });
      try {
        for (const level of ['kart', 'detalj']) {
          await page.evaluate((lv) => window.__fk.goLevel(lv), level);
          await wait(page, 800);
          const r = await arrowsThroughBoxes(page);
          assert.ok(r.drawn > 30, `${level}: ${r.drawn} arrows`);
          assert.deepEqual(r.bad.slice(0, 5), [], level);
        }
        assert.deepEqual(errors, []);
      } finally { await close(); }
    });
  }
}

for (const code of realMaps) test(`${code}: Tema on an upright phone: the whole map is in the screen, no arrow goes through a box and no number sits on a box or on another number`, { skip: skip || (fs.existsSync(path.join(viewerDir, '..', 'dist', code + '.json')) ? false : 'no dist') }, async () => {
  const { page, errors, close } = await openMap(path.join('..', 'dist', code + '.json'), [], { viewport: { width: 390, height: 844 } });
  try {
    const r = await page.evaluate(() => {
      const cy = window.__cy, L = window.__fk.LAYOUT, st = document.getElementById('cy').getBoundingClientRect(), b = cy.nodes('[kind="carea"]').renderedBoundingBox();
      const boxes = Object.entries(window.__fk.TM).map(([cid, t]) => { const a = L.areas[cid]; return { cid, x1: a.x - t.cw / 2, x2: a.x + t.cw / 2, y1: a.y - t.ch / 2, y2: a.y + t.ch / 2 }; });
      const bad = [];
      for (const e of cy.edges('[?meta]').filter((x) => !x.hasClass('zoff'))) {
        const pts = e._private.rscratch.allpts;
        for (let i = 2; i + 1 < pts.length; i += 2) for (const bx of boxes) {
          if (Math.min(pts[i - 2], pts[i]) < bx.x2 - 1 && Math.max(pts[i - 2], pts[i]) > bx.x1 + 1 && Math.min(pts[i - 1], pts[i + 1]) < bx.y2 - 1 && Math.max(pts[i - 1], pts[i + 1]) > bx.y1 + 1) bad.push(`${e.id()} through ${bx.cid}`);
        }
      }
      const labs = cy.nodes('[kind="mlab"]').filter((x) => !x.hasClass('zoff')).toArray();
      labs.forEach((n, i) => {
        const p = n.position(), w = n.data('w'), h = n.data('h');
        for (const bx of boxes) if (p.x - w / 2 < bx.x2 && p.x + w / 2 > bx.x1 && p.y - h / 2 < bx.y2 && p.y + h / 2 > bx.y1) bad.push(`number ${n.id()} on ${bx.cid}`);
        for (const m of labs.slice(i + 1)) { const q = m.position(); if (Math.abs(p.x - q.x) < (w + m.data('w')) / 2 && Math.abs(p.y - q.y) < (h + m.data('h')) / 2) bad.push(`numbers ${n.id()} and ${m.id()} overlap`); }
      });
      return { inside: b.x1 >= -1 && b.y1 >= -1 && b.x2 <= st.width + 1 && b.y2 <= st.height + 1, upright: L.bounds.x2 - L.bounds.x1 < L.bounds.y2 - L.bounds.y1, bad: [...new Set(bad)] };
    });
    assert.equal(r.upright, true, 'the layout for a tall stage');
    assert.equal(r.inside, true, 'the whole map fits');
    assert.deepEqual(r.bad.slice(0, 5), []);
    // "Fleire val" is a sheet from the bottom on a phone
    await page.click('#moreBtn');
    const sheet = await page.evaluate(() => { const r = document.getElementById('side').getBoundingClientRect(); return { bottom: Math.round(r.bottom), width: Math.round(r.width), vh: window.innerHeight }; });
    assert.equal(sheet.bottom, sheet.vh);
    assert.equal(sheet.width, 390);
    assert.equal(await visible(page, '#backdrop'), true);
    await page.click('#moreClose');
    assert.equal(await visible(page, '#side'), false);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('no grid shines through the areas: the map is plain paper and the areas are solid', opts, async () => {
  const { page, close } = await openMap(MAP);
  try {
    await page.evaluate(() => window.__fk.goLevel('kart'));
    await wait(page, 800);
    const r = await page.evaluate(() => ({
      bg: getComputedStyle(document.getElementById('cy')).backgroundColor, bodyGrid: getComputedStyle(document.body).backgroundImage,
      ops: window.__cy.nodes('[kind="carea"]').map((a) => a.pstyle('background-opacity').value),
    }));
    assert.notEqual(r.bg, 'rgba(0, 0, 0, 0)');
    assert.equal(r.bodyGrid, 'none');
    assert.ok(r.ops.every((o) => o >= 0.99), JSON.stringify(r.ops));
  } finally { await close(); }
});
