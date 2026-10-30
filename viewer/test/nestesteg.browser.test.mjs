// The layer "Neste steg" (src/lag/nestesteg.js) in the real page: the lists in "Fleire val", the switch "Vis på kartet" and the line in the card.
// Uses the demo map and the marks of the layer "Kva kan eg?". The rules themselves are tested in nestesteg.test.mjs.
// Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMap, skip } from './browser.mjs';

const MAP = 'fixtures/DEMO-01.json';
const P = 'DEMO-01/';
const base = (page) => page.url().split('?')[0];
const ready = (page) => page.waitForSelector('html[data-ready="1"]').then(() => page.waitForTimeout(250));

const select = (page, id) => page.evaluate((i) => window.__fk.select(i, { center: false }), P + id);
const evOn = async (p) => { if (await p.$('#evBtn:not([hidden])[aria-pressed="false"]')) { await p.click('#evBtn'); await p.waitForTimeout(150); } }; // "Kva kan eg?" on: the card has the buttons
const goto = async (page, query = '') => { await page.goto(base(page) + query); await ready(page); await evOn(page); };
const mark = async (page, id, v) => { await evOn(page); await select(page, id); await page.click(`#panel [data-ev="${v}"]`); };
const openMore = async (page) => { if ((await page.getAttribute('#moreBtn', 'aria-expanded')) !== 'true') await page.click('#moreBtn'); };
const SEC = '#side [data-layer="nestesteg"]';
const names = (page, key) => page.$$eval(`${SEC} [data-ns-list="${key}"] li`, (lis) => lis.map((li) => li.querySelector('button').textContent.trim()));
const notes = (page, key) => page.$$eval(`${SEC} [data-ns-list="${key}"] li`, (lis) => lis.map((li) => (li.querySelector('.ns-n') || {}).textContent));
const badges = (page) => page.evaluate(() => window.__cy.nodes('.ghost[role^="pill-"]').map((n) => n.data('label')));
const faded = (page) => page.evaluate(() => window.__cy.nodes('.fl').map((n) => n.id().replace('DEMO-01/', '')).sort());

test('the teacher view has no trace of the layer', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await select(page, 'varians');
    assert.equal(await page.$('#panel .ns-card'), null);
    assert.equal(await page.isHidden(SEC), true);
    assert.equal(await page.textContent('#stView'), '');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('without marks: the hint and the starting points, and a click on one selects it', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    await openMore(page);
    const text = await page.textContent(SEC);
    assert.match(text, /Slå på «Kva kan eg\?» og marker nokre omgrep \(ikkje enno · delvis · godt\), så får du forslag her\./);
    assert.match(text, /Startpunkt/);
    assert.doesNotMatch(text, /Svake punkt/);
    assert.equal((await names(page, 'ready')).length, 5);
    assert.match(text, /\d+ omgrep og metodar i faget er ikkje markerte enno/);
    assert.equal(await page.textContent('#stView'), ''); // the switch is off: nothing in the status
    await page.click(`${SEC} [data-ns-list="ready"] li button`);
    assert.match(await page.textContent('#panel h2, #panel .ptitle, #panel'), /Avvik|avvik/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('ten marks: the lists follow, "Vis på kartet" marks and fades, and the same with "Vis implisitte piler"', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    const marks = [['fk-gjennomsnitt', 'ikkje'], ['avvik', 'heilt'], ['spreiing', 'heilt'], ['kvadrert-avvik', 'delvis'], ['histogram', 'heilt'],
      ['standardnormal', 'ikkje'], ['klokkekurve', 'heilt'], ['fk-sumteikn', 'delvis'], ['rekne-sd', 'ikkje'], ['z-verdi', 'delvis']];
    for (const [id, v] of marks) await mark(page, id, v);
    await page.keyboard.press('Escape');
    await openMore(page);
    const text = await page.textContent(SEC);
    assert.doesNotMatch(text, /Marker nokre omgrep/);
    assert.match(text, /Klar til å lære/);
    // fk-gjennomsnitt is ikkje: avvik and spreiing lose their basis, but they are heilt (mastered) so they are not offered anyway;
    // varians needs kvadrert-avvik (delvis), so it is not ready; kvadrert-avvik needs fk-sumteikn (delvis) and fk-potens (unmarked, known)
    const klar = await names(page, 'ready');
    assert.ok(!klar.some((n) => /^Avvik$/.test(n)), klar.join('|'));
    const weak = await names(page, 'weak');
    assert.equal(weak.length, 6); // fk-gjennomsnitt, kvadrert-avvik, standardnormal, fk-sumteikn, rekne-sd, z-verdi
    const counts = await notes(page, 'weak');
    assert.match(counts[0], /^\d+ omgrep byggjer på dette$/);
    const nums = counts.map((c) => parseInt(c, 10) || 0);
    assert.deepEqual(nums, [...nums].sort((a, b) => b - a), 'most builds-on first');
    assert.match(await page.textContent(SEC), /\d+ omgrep og metodar i faget er ikkje markerte enno/);

    // the switch: ready nodes get "klar", weak points "svakt", the rest fades
    assert.deepEqual((await badges(page)).filter((b) => b === 'klar' || b === 'svakt'), []);
    await page.click(`${SEC} .switch`);
    const b = await badges(page);
    const nKlar = b.filter((x) => x === 'klar').length, nSvakt = b.filter((x) => x === 'svakt').length;
    assert.ok(nKlar > 0 && nSvakt > 0, b.join('|'));
    assert.equal(nKlar + nSvakt, klar.length + weak.filter((w) => !klar.includes(w)).length, 'one badge per listed node');
    assert.ok((await page.textContent('#stView')).split(', ').includes(`${klar.length} ${klar.length === 1 ? 'klar' : 'klare'}`), await page.textContent('#stView'));
    const fadedNodes = await faded(page);
    for (const id of ['avvik', 'spreiing', 'histogram', 'klokkekurve']) assert.ok(fadedNodes.includes(id), id + ' is heilt and fades');
    for (const id of ['fk-gjennomsnitt', 'kvadrert-avvik', 'standardnormal', 'fk-sumteikn', 'rekne-sd', 'z-verdi']) assert.ok(!fadedNodes.includes(id), id + ' is a weak point and stays');

    // the same answer with the implied edges shown
    const snapshot = async () => JSON.stringify([await names(page, 'ready'), await names(page, 'weak'), await notes(page, 'weak'), (await badges(page)).sort(), await faded(page)]);
    const without = await snapshot();
    // the switch is hidden in the student view: flip it the way the teacher view would
    await page.evaluate(() => { const cb = document.getElementById('swImpl'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await page.evaluate(() => document.getElementById('swImpl').checked), true);
    await page.waitForTimeout(300);
    assert.equal(await snapshot(), without);

    // switched off again: the map is plain
    await page.click(`${SEC} .switch`);
    assert.deepEqual((await badges(page)).filter((x) => x === 'klar' || x === 'svakt'), []);
    assert.doesNotMatch(await page.textContent('#stView'), /klar/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a node whose forkunnskap is marked ikkje is not offered; the card says what is missing and links to it', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    await select(page, 'avvik');
    assert.match(await page.textContent('#panel .ns-card'), /^Du har det du treng for å lære dette$/);
    await page.click('#panel [data-ev="delvis"]');
    assert.match(await page.textContent('#panel .ns-card'), /^Du har det du treng for å lære dette$/); // not mastered yet: still a step
    await mark(page, 'fk-gjennomsnitt', 'ikkje');
    await select(page, 'avvik');
    assert.match(await page.textContent('#panel .ns-miss summary'), /^Manglar: 1 føresetnad$/);
    await page.click('#panel .ns-miss summary');
    await page.click('#panel .ns-miss .linkbtn');
    assert.match(await page.textContent('#panel'), /Gjennomsnitt/);
    // varians: two direct prerequisites in the subject, none of them mastered
    await select(page, 'varians');
    assert.match(await page.textContent('#panel .ns-miss summary'), /^Manglar: 2 føresetnader$/);
    // a node that is heilt, and a competence goal, have no line
    await mark(page, 'histogram', 'heilt');
    assert.equal(await page.$('#panel .ns-card'), null);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#kmList .kmitem')][0]; b.click(); });
    assert.equal(await page.$('#panel .ns-card'), null);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('"Vis fleire" opens the rest of a long list', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    for (const id of ['avvik', 'spreiing', 'histogram', 'kvadrert-avvik', 'varians', 'standardavvik', 'kvifor-kvadrat', 'rekne-sd', 'normalfordeling', 'klokkekurve']) await mark(page, id, 'ikkje');
    await page.keyboard.press('Escape');
    await openMore(page);
    assert.equal((await names(page, 'weak')).length, 8);
    const more = `${SEC} [data-ns-more="weak"]`;
    assert.equal(await page.textContent(more), 'Vis fleire (2)');
    await page.click(more);
    assert.equal((await names(page, 'weak')).length, 10);
    assert.equal(await page.textContent(more), 'Vis færre');
    assert.equal((await names(page, 'weak'))[0].length > 0, true);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('on a phone the section fits the screen', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP, [], { viewport: { width: 390, height: 844 } });
  try {
    await goto(page, '?vising=elev');
    for (const [id, v] of [['avvik', 'heilt'], ['spreiing', 'delvis'], ['varians', 'ikkje']]) await mark(page, id, v);
    await openMore(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(over, false, 'no sideways scroll');
    const box = await page.locator(`${SEC} .switch`).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
