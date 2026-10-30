// The layer "koplingar" (src/lag/koplingar.js) in the real page: the map draws only byggjer på until "Vis andre koplingar" is on,
// the legend shows the arrows that are drawn, "Lett å blande med" stands in the card, and dekkjer is never drawn.
// Built from dist/S2.json; skipped when it or Chromium is missing. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openMap, skip, viewerDir } from './browser.mjs';

const MAP = path.join('..', 'dist', 'S2.json');
const opts = { skip: skip || (fs.existsSync(path.join(viewerDir, MAP)) ? false : 'no dist/S2.json') };
const OTHER = ['brukar', 'doeme_paa', 'representerast_som', 'forvekslast_med'];
const STUDENT = "try { localStorage.setItem('fagkart.vising', 'elev'); } catch (e) {}";

// the arrows that are drawn, by type (the zoom levels aside: hide is what the layers say)
const drawn = (page) => page.evaluate(() => {
  const out = {};
  window.__cy.edges('[!meta]').filter((e) => !e.hasClass('hide')).forEach((e) => { out[e.data('type')] = (out[e.data('type')] || 0) + 1; });
  return out;
});
const legend = (page) => page.evaluate(() => [...document.querySelectorAll('#legend .legrow')].map((r) => r.dataset.et));
const ready = async (page) => { await page.waitForSelector('html[data-ready="1"]'); await page.waitForTimeout(300); };

test('student view: only byggjer på on the map until the switch is on, and the choice is remembered', opts, async () => {
  const { page, errors, close } = await openMap(MAP, [], { init: STUDENT });
  try {
    assert.equal(await page.evaluate(() => window.__fk.state.elev), true);
    await page.evaluate(() => window.__fk.goLevel('kart'));
    let d = await drawn(page);
    assert.ok(d.byggjer_paa > 0);
    for (const t of [...OTHER, 'dekkjer']) assert.equal(d[t] || 0, 0, t);
    assert.deepEqual(await legend(page), ['byggjer_paa']);
    // the switch is in "Visning" in the student view too
    await page.click('#moreBtn');
    await page.evaluate(() => { document.getElementById('visningSec').open = true; });
    assert.equal(await page.isVisible('#swKoplRow'), true);
    await page.click('.switch:has(#swKopl)');
    d = await drawn(page);
    for (const t of OTHER) assert.ok(d[t] > 0, t);
    assert.equal(d.dekkjer || 0, 0);
    assert.deepEqual(await legend(page), ['byggjer_paa', ...OTHER]);
    assert.equal(await page.evaluate(() => localStorage.getItem('fagkart.koplingar')), 'pa');
    await page.reload();
    await ready(page);
    assert.equal(await page.evaluate(() => window.__fk.state.showKoplingar), true);
    assert.equal(await page.isChecked('#swKopl'), true);
    for (const t of OTHER) assert.ok((await drawn(page))[t] > 0, t + ' after a reload');
    assert.equal((await legend(page)).length, 5);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('"Lett å blande med" stands in the card without opening a section', opts, async () => {
  const { page, errors, close } = await openMap(MAP, [], { init: STUDENT });
  try {
    await page.evaluate(() => window.__fk.select('S2/gjennomsnitt-standardavvik-data', { center: false }));
    const card = () => page.evaluate(() => {
      const c = [...document.querySelectorAll('#panel > .callout')].find((e) => e.querySelector('.t').textContent === 'Lett å blande med');
      return {
        callouts: [...document.querySelectorAll('#panel > .callout .t')].map((e) => e.textContent),
        links: c ? [...c.querySelectorAll('.links li')].length : 0,
        open: [...document.querySelectorAll('#panel .fold')].filter((f) => f.open).length,
        other: document.querySelector('#panel .fold[data-fold="koplingar"]')?.textContent || '',
      };
    });
    let c = await card();
    assert.deepEqual(c.callouts.slice(-2), ['Døme', 'Lett å blande med']);
    assert.equal(c.links, 3);
    assert.equal(c.open, 0);
    assert.doesNotMatch(c.other, /Forvekslast med/);
    // the same in the teacher view
    await page.click('#modeSeg button[data-mode="laerar"]');
    await page.evaluate(() => window.__fk.select('S2/gjennomsnitt-standardavvik-data', { center: false }));
    c = await card();
    assert.equal(c.links, 3);
    // a node without forvekslast med has no box
    const plain = await page.evaluate(() => {
      const d = JSON.parse(document.getElementById('fagkart-data').textContent);
      const conf = new Set((d.kantar || []).filter((k) => k.type === 'forvekslast_med').flatMap((k) => [k.fra, k.til]));
      return d.nodar.find((n) => !n.utgaatt && n.type !== 'kompetansemaal' && !conf.has(n.id)).id;
    });
    await page.evaluate((id) => window.__fk.select(id, { center: false }), plain);
    assert.ok(!(await card()).callouts.includes('Lett å blande med'));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('no dekkjer arrow, and a chosen kompetansemål still marks its nodes', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await page.evaluate(() => window.__fk.goLevel('kart'));
    await page.click('#moreBtn');
    await page.click('.switch:has(#swKopl)');
    const km = await page.evaluate(() => document.querySelector('#kmList .kmitem').dataset.km);
    await page.evaluate(() => document.querySelector('#kmList .kmitem').click());
    await page.waitForTimeout(300);
    const r = await page.evaluate((k) => {
      const ns = window.__cy.nodes('[kind="node"]').filter((n) => !n.hasClass('hide'));
      const serve = ns.filter((n) => (n.data('km') || []).includes(k));
      return { dekkjer: window.__cy.edges('[type="dekkjer"]').filter((e) => !e.hasClass('hide')).length, serve: serve.length, lit: serve.filter((n) => !n.hasClass('dim')).length, dim: ns.filter((n) => n.hasClass('dim')).length };
    }, km);
    assert.equal(r.dekkjer, 0);
    assert.ok(r.serve > 0 && r.lit === r.serve, JSON.stringify(r));
    assert.ok(r.dim > 0, 'the other nodes are dimmed');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('host mode (Faglogg): off at the start and not stored', opts, async () => {
  const { page, errors, close } = await openMap(MAP, [], { init: "try { localStorage.setItem('fagkart.koplingar', 'pa'); } catch (e) {}" });
  try {
    assert.equal(await page.evaluate(() => window.__fk.state.showKoplingar), true, 'the stored choice outside host mode');
    await page.goto(page.url().split('?')[0] + '?vising=faglogg');
    await ready(page);
    assert.equal(await page.evaluate(() => window.__fk.state.showKoplingar), false);
    assert.equal((await drawn(page)).forvekslast_med || 0, 0);
    const flip = (on) => page.evaluate((v) => { const cb = document.getElementById('swKopl'); cb.checked = v; cb.dispatchEvent(new Event('change', { bubbles: true })); }, on);
    await page.evaluate(() => localStorage.setItem('fagkart.koplingar', 'urørt'));
    await flip(true);
    assert.ok((await drawn(page)).forvekslast_med > 0);
    await flip(false);
    assert.equal(await page.evaluate(() => localStorage.getItem('fagkart.koplingar')), 'urørt', 'host mode writes nothing');
    assert.deepEqual(errors.filter((e) => !/postMessage|parent/i.test(e)), []);
  } finally { await close(); }
});
