// The layer "Stiar" (src/lag/stiar.js) in the real page: the prerequisite chain in the card, "Vis på kartet" / "Fjern sti" on the zoom surface
// and in the tema view, the løyper of the map with Førre / Neste on a phone (touch), the marks of the student on the steps, and a map without løyper.
// Uses the demo map. Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMap, skip, viewerDir, TOUR_DONE } from './browser.mjs';
import { makeGraph, prerequisiteChain } from '../src/graph.js';

const MAP = 'fixtures/DEMO-01.json';
const DATA = JSON.parse(fs.readFileSync(path.join(viewerDir, MAP), 'utf8'));
const KEY = 'fagkart.DEMO-01.eigenvurdering';
const SD = 'DEMO-01/standardavvik', VARIANS = 'DEMO-01/varians', GJ = 'DEMO-01/fk-gjennomsnitt', AVVIK = 'DEMO-01/avvik', SPREIING = 'DEMO-01/spreiing';
const ROUTE = DATA.loeyper.find((l) => l.id === 'spreiing-til-sd');
const CHAIN = prerequisiteChain(makeGraph(DATA.nodar.map((n) => n.id), DATA.kantar), SD); // what the card must list, in this order

const base = (page) => page.url().split('?')[0];
const ready = (page) => page.waitForSelector('html[data-ready="1"]').then(() => page.waitForTimeout(250));
const goto = async (page, query = '') => { await page.goto(base(page) + query); await ready(page); };
const select = (page, id) => page.evaluate((i) => window.__fk.select(i, { center: false }), id);
const openMore = async (page) => { if ((await page.getAttribute('#moreBtn', 'aria-expanded')) !== 'true') await page.click('#moreBtn'); };
const openFold = async (page) => { if (!(await page.$('#panel .fold[data-fold="stiar-foer"][open]'))) await page.click('#panel .fold[data-fold="stiar-foer"] summary'); };
// the numbers on the nodes: { id: '3' } from the badges of the real nodes (the badges of the tema boxes are left out)
const numbers = (page) => page.evaluate(() => Object.fromEntries(window.__cy.nodes('.ghost[role="pill-new"]').filter((g) => !g.data('area') && /^\d+$/.test(g.data('label'))).map((g) => [g.data('of'), g.data('label')])));
const faded = (page) => page.evaluate(() => window.__cy.nodes('[kind="node"].fl').map((n) => n.id()).sort());
const stepList = (page, list) => page.evaluate((s) => [...document.querySelectorAll(s + ' > li')].map((li) => li.dataset.id), list);
const evOn = async (p) => { if (await p.$('#evBtn:not([hidden])[aria-pressed="false"]')) { await p.click('#evBtn'); await p.waitForTimeout(150); } }; // "Kva kan eg?" on: the card has the buttons
const mark = async (page, id, v) => { await evOn(page); await select(page, id); await page.click(`#panel [data-ev="${v}"]`); };
const sel = (page) => page.evaluate(() => window.__fk.state.sel);
const name = (id) => DATA.nodar.find((n) => n.id === id).namn;

test('the card lists what to know first, in the order of prerequisiteChain, with a tag on forkunnskap', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    assert.ok(CHAIN.length >= 5, 'the demo node has several levels of prerequisites');
    await select(page, SD);
    assert.equal(await page.textContent('#panel .fold[data-fold="stiar-foer"] summary'), `Kva må eg kunne før dette?${CHAIN.length}`);
    assert.equal(await page.$('#panel .fold[data-fold="stiar-foer"][open]'), null, 'closed until opened');
    await openFold(page);
    assert.deepEqual(await stepList(page, '#panel [data-sti-chain]'), CHAIN);
    // the forkunnskap steps carry the grey tag, the others do not
    const tags = await page.evaluate(() => [...document.querySelectorAll('#panel [data-sti-chain] > li')].map((li) => !!li.querySelector('.sti-tag')));
    assert.deepEqual(tags, CHAIN.map((id) => DATA.nodar.find((n) => n.id === id).forkunnskap !== undefined));
    assert.ok(tags.some(Boolean) && tags.some((t) => !t));
    // a node without prerequisites has no section
    await select(page, GJ);
    assert.equal(await page.$('#panel .fold[data-fold="stiar-foer"]'), null);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('"Vis på kartet" numbers the chain and fades the rest, it stays while other nodes are chosen, and "Fjern sti" takes it away', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    assert.deepEqual(await numbers(page), {});
    assert.deepEqual(await faded(page), [], 'no path, nothing faded');
    await select(page, SD);
    await openFold(page);
    await page.click('#panel [data-sti="vis"]');
    const n = await numbers(page);
    const expected = Object.fromEntries([...CHAIN, SD].map((id, i) => [id, String(i + 1)]));
    assert.deepEqual(n, expected, 'the steps 1…n and the node itself as n+1');
    const members = new Set([...CHAIN, SD]);
    const all = await page.evaluate(() => window.__cy.nodes('[kind="node"]').map((x) => x.id()));
    assert.deepEqual(await faded(page), all.filter((id) => !members.has(id)).sort(), 'everything but the path fades');
    assert.match(await page.textContent('#stView'), /føresetnadskjede/);
    assert.match(await page.textContent('#panel [data-sti-bar]'), /Føresetnader for «Standardavvik/);

    // other nodes can be chosen: the path stays
    await select(page, VARIANS);
    assert.deepEqual(await numbers(page), expected);
    assert.ok(await page.$('#panel [data-sti-bar] [data-sti="fjern"]'), 'the way out is in the card');
    await openMore(page);
    assert.ok(await page.$('#side [data-layer="stiar"] [data-sti="fjern"]'), 'and in "Fleire val"');
    assert.match(await page.textContent('#side [data-sti-active]'), /Aktiv sti/);
    await page.click('#side [data-sti-active] [data-sti="fjern"]');
    assert.deepEqual(await numbers(page), {});
    assert.deepEqual(await faded(page), []);
    assert.equal(await page.$('#panel [data-sti-bar]'), null);

    // and from the card
    await select(page, SD);
    await openFold(page);
    await page.click('#panel [data-sti="vis"]');
    assert.equal(Object.keys(await numbers(page)).length, CHAIN.length + 1);
    await page.click('#panel [data-sti-bar] [data-sti="fjern"]');
    assert.deepEqual(await numbers(page), {});
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('in the tema view the steps of the tema are numbered, grey neighbours stay quiet, and the list in the card is whole', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await page.evaluate(() => window.__fk.openTema('beskrivande'));
    await page.waitForTimeout(1000);
    await select(page, SD);
    await openFold(page);
    assert.deepEqual(await stepList(page, '#panel [data-sti-chain]'), CHAIN, 'the list holds the steps outside the tema as well');
    await page.click('#panel [data-sti="vis"]');
    await page.waitForTimeout(500);
    const n = await numbers(page);
    const grey = await page.evaluate(() => window.__cy.nodes('.grey').map((x) => x.id()));
    assert.ok(grey.length > 0);
    const inTema = await page.evaluate(() => window.__cy.nodes('[kind="node"]').filter((x) => !x.hasClass('grey')).map((x) => x.id()));
    for (const id of grey) assert.equal(n[id], undefined, `no number on the grey ${id}`);
    for (const id of inTema) {
      const k = [...CHAIN, SD].indexOf(id);
      if (k >= 0) assert.equal(n[id], String(k + 1), id);
      else assert.ok((await faded(page)).includes(id), `${id} fades`);
    }
    assert.ok(Object.keys(n).length >= 3);
    await page.click('#panel [data-sti-bar] [data-sti="fjern"]');
    assert.deepEqual(await numbers(page), {});
    assert.deepEqual(await faded(page), []);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a løype is chosen in "Fleire val" and followed with Førre / Neste on a phone with touch', { skip }, async () => {
  const first = await openMap(MAP);
  let ctx;
  try {
    ctx = await first.page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(TOUR_DONE);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(base(first.page) + '?vising=elev');
    await ready(page);
    await page.tap('#moreBtn');
    const text = await page.textContent('#side [data-layer="stiar"]');
    for (const l of DATA.loeyper) assert.ok(text.includes(l.namn) && text.includes(l.skildring), l.id);
    assert.match(text, /For 1P · 5 steg/);
    assert.match(text, /\b5 steg/);
    assert.equal(await page.$('#side [data-sti-steps]'), null, 'no løype, no steps');
    await page.tap('#side [data-loeype="spreiing-til-sd"]');
    await page.waitForTimeout(700);
    assert.equal(await page.getAttribute('#side [data-loeype="spreiing-til-sd"]', 'aria-pressed'), 'true');
    assert.equal(await page.getAttribute('#side [data-loeype="normalfordeling-kort"]', 'aria-pressed'), 'false');
    assert.deepEqual(await stepList(page, '#side [data-sti-steps]'), ROUTE.nodar);
    assert.deepEqual(await numbers(page), Object.fromEntries(ROUTE.nodar.map((id, i) => [id, String(i + 1)])));
    assert.match(await page.textContent('#stView'), /Frå gjennomsnitt til standardavvik/);
    assert.equal(await page.isDisabled('#side [data-sti="forrige"]'), true, 'nothing before the first step');

    // Neste in "Fleire val" chooses the first step; from there the card carries the buttons
    await page.tap('#side [data-sti="neste"]');
    await page.waitForTimeout(500);
    assert.equal(await sel(page), ROUTE.nodar[0]);
    for (let i = 1; i < ROUTE.nodar.length; i++) {
      assert.match(await page.textContent('#panel [data-sti-bar]'), new RegExp(`steg ${i} av ${ROUTE.nodar.length}`));
      assert.ok((await (await page.$('#panel [data-sti="neste"]')).boundingBox()).height >= 44, 'a finger fits');
      await page.tap('#panel [data-sti="neste"]');
      await page.waitForTimeout(350);
      assert.equal(await sel(page), ROUTE.nodar[i]);
    }
    assert.equal(await page.isDisabled('#panel [data-sti="neste"]'), true, 'nothing after the last step');
    await page.tap('#panel [data-sti="forrige"]');
    await page.waitForTimeout(350);
    assert.equal(await sel(page), ROUTE.nodar[ROUTE.nodar.length - 2]);
    // the path stays while the student chooses a node of the map that is not a step
    await select(page, 'DEMO-01/histogram');
    assert.equal(Object.keys(await numbers(page)).length >= 3, true);
    assert.equal(await page.isDisabled('#panel [data-sti="neste"]'), false, 'Neste goes on from the step chosen last');
    await page.tap('#panel [data-sti="fjern"]');
    assert.deepEqual(await numbers(page), {});
    assert.deepEqual(await faded(page), []);
    assert.equal(await page.$('#panel [data-sti-bar]'), null);
    assert.deepEqual(errors, []);
  } finally { if (ctx) await ctx.close(); await first.close(); }
});

test('the other løype replaces the first, and the same one again takes it away', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await openMore(page);
    await page.click('#side [data-loeype="spreiing-til-sd"]');
    await page.click('#side [data-loeype="normalfordeling-kort"]');
    const other = DATA.loeyper.find((l) => l.id === 'normalfordeling-kort');
    const n = await numbers(page);
    assert.equal(n[other.nodar[0]], '1');
    assert.equal(n[ROUTE.nodar[2]], undefined);
    await page.click('#side [data-loeype="normalfordeling-kort"]');
    assert.deepEqual(await numbers(page), {});
    assert.deepEqual(await faded(page), []);
    // a chain replaces a løype
    await page.click('#side [data-loeype="spreiing-til-sd"]');
    await select(page, SD);
    await openFold(page);
    await page.click('#panel [data-sti="vis"]');
    assert.equal(await page.getAttribute('#side [data-loeype="spreiing-til-sd"]', 'aria-pressed'), 'false');
    assert.equal(Object.keys(await numbers(page)).length, CHAIN.length + 1);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the student view shows the mark of each step as a coloured dot, the teacher view has no dots', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    await mark(page, AVVIK, 'heilt');
    await mark(page, SPREIING, 'delvis');
    await mark(page, VARIANS, 'ikkje');
    await select(page, SD);
    await openFold(page);
    const dots = () => page.evaluate(() => [...document.querySelectorAll('#panel [data-sti-chain] > li')].map((li) => (li.querySelector('.sti-dot') || { className: '' }).className.replace('sti-dot ', '')));
    const d = await dots();
    assert.equal(d.length, CHAIN.length);
    CHAIN.forEach((id, i) => assert.equal(d[i], { [AVVIK]: 'sti-heilt', [SPREIING]: 'sti-delvis', [VARIANS]: 'sti-ikkje' }[id] || 'sti-ingen', id));
    // the same in the løype
    await openMore(page);
    await page.click('#side [data-loeype="spreiing-til-sd"]');
    const rd = await page.evaluate(() => [...document.querySelectorAll('#side [data-sti-steps] > li')].map((li) => li.querySelector('.sti-dot').className.replace('sti-dot ', '')));
    assert.deepEqual(rd, ROUTE.nodar.map((id) => ({ [AVVIK]: 'sti-heilt', [SPREIING]: 'sti-delvis', [VARIANS]: 'sti-ikkje' }[id] || 'sti-ingen')));
    const tones = await page.evaluate(() => ['sti-heilt', 'sti-delvis', 'sti-ikkje'].map((c) => getComputedStyle(document.querySelector('.' + c)).backgroundColor));
    assert.equal(new Set(tones).size, 3, 'three different colours');
    // changing a mark updates the list at once
    await mark(page, AVVIK, 'ikkje');
    await openMore(page);
    assert.equal((await page.evaluate(() => document.querySelectorAll('#side [data-sti-steps] .sti-heilt').length)), 0);

    await goto(page, '?vising=laerar');
    assert.equal((await page.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k)).merke).length, KEY)) > 0, true, 'the marks are still stored');
    await select(page, SD);
    await openFold(page);
    assert.equal(await page.$$eval('#panel .sti-dot', (e) => e.length), 0);
    assert.equal((await stepList(page, '#panel [data-sti-chain]')).length, CHAIN.length, 'the list itself is the same');
    await openMore(page);
    await page.click('#side [data-loeype="spreiing-til-sd"]');
    assert.equal(await page.$$eval('#side .sti-dot', (e) => e.length), 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a chosen step does not dim the other steps of the path (keep), while the rest is dimmed', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await openMore(page);
    await page.click('#side [data-loeype="spreiing-til-sd"]');
    await select(page, ROUTE.nodar[0]);
    const dimmed = await page.evaluate(() => window.__cy.nodes('[kind="node"].dim').map((n) => n.id()));
    for (const id of ROUTE.nodar) assert.ok(!dimmed.includes(id), id + ' is a step and must stay open');
    assert.ok(dimmed.length > 0, 'the nodes off the path are dimmed by the selection');
    // without a path the selection dims everything but the neighbours again (the drawer closed with the selection)
    await openMore(page);
    await page.click('#side [data-loeype="spreiing-til-sd"]');
    await select(page, ROUTE.nodar[0]);
    const again = await page.evaluate(() => window.__cy.nodes('[kind="node"].dim').map((n) => n.id()));
    assert.ok(ROUTE.nodar.some((id) => again.includes(id)), 'a far step is dimmed once the path is gone');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a map without løyper says so', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-utanloeyper-'));
  const file = path.join(dir, 'DEMO-01.json');
  const { loeyper, ...rest } = DATA;
  fs.writeFileSync(file, JSON.stringify(rest));
  const { page, errors, close } = await openMap(file);
  try {
    await openMore(page);
    assert.match(await page.textContent('#side [data-layer="stiar"]'), /Dette kartet har ingen løyper enno\./);
    assert.equal(await page.$('#side [data-loeype]'), null);
    // the chain still works
    await page.keyboard.press('Escape');
    await select(page, SD);
    assert.ok(await page.$('#panel .fold[data-fold="stiar-foer"]'));
    assert.deepEqual(errors, []);
  } finally { await close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
