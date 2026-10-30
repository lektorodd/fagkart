// The layer "Kva kan eg?" (src/lag/eigenvurdering.js) in the real page: the student link (?vising=elev), the three buttons in the card, the colours,
// the count on the tema box, storage, "Last ned" / "Opne fil" and what a file may and may not do. Uses the demo map.
// Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openMap, skip, viewerDir, TOUR_DONE } from './browser.mjs';

const MAP = 'fixtures/DEMO-01.json';
const KEY = 'fagkart.DEMO-01.eigenvurdering';
const VARIANS = 'DEMO-01/varians', AVVIK = 'DEMO-01/avvik', KM01 = 'DEMO-01/km01';
const base = (page) => page.url().split('?')[0];
const ready = (page) => page.waitForSelector('html[data-ready="1"]').then(() => page.waitForTimeout(250));
const evOn = async (p) => { if (await p.$('#evBtn:not([hidden])[aria-pressed="false"]')) { await p.click('#evBtn'); await p.waitForTimeout(150); } }; // "Kva kan eg?" on: the card has the buttons
const goto0 = async (page) => { await page.goto(base(page)); await ready(page); };
const goto = async (page, query = '') => { await page.goto(base(page) + query); await ready(page); await evOn(page); };
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const select = (page, id) => page.evaluate((i) => window.__fk.select(i, { center: false }), id);
const mark = async (page, id, v) => { await evOn(page); await select(page, id); await page.click(`#panel [data-ev="${v}"]`); };
const fill = (page, id) => page.evaluate((i) => window.__cy.getElementById(i).pstyle('background-color').strValue, id);
const badges = (page) => page.evaluate(() => window.__cy.nodes('.ghost[role^="pill-"]').map((n) => n.data('label')));
const section = (page) => page.textContent('#side [data-layer="eigenvurdering"]');
const openMore = async (page) => { if ((await page.getAttribute('#moreBtn', 'aria-expanded')) !== 'true') await page.click('#moreBtn'); };
const file = (obj, name = 'fil.json') => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });
const overlay = (merke, extra = {}) => ({ format: 'fagkart-overlegg/1', kart: 'DEMO-01', kartversjon: '0.1', namn: 'Mi eigenvurdering', type: 'eigenvurdering', skala: ['ikkje', 'delvis', 'heilt'], merke, ...extra });
// a new browser context: an empty browser, nothing stored
async function emptyBrowser(page, query = '') {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(TOUR_DONE);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  await p.goto(base(page) + query);
  await ready(p);
  await evOn(p);
  return { p, errors, ctx };
}
async function openFile(page, f) {
  await openMore(page);
  await page.setInputFiles('#side [data-ev-file]', f);
  await page.waitForTimeout(150);
}

test('"Kva kan eg?" in the top bar: off the first time, on gives line work and the colours, off the plain map; the marks stay; remembered per map', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const strek = () => page.evaluate(() => window.__fk.state.strek);
    const pressed = () => page.getAttribute('#evBtn', 'aria-pressed');
    const evClasses = () => page.evaluate(() => window.__cy.nodes('[id ^= "DEMO-01/"]').filter((n) => /\bev-/.test(n.classes().join(' '))).map((n) => n.id()));
    assert.equal(await page.isHidden('#evBtn'), true, 'not in the teacher view');
    await page.evaluate(([k, o]) => localStorage.setItem(k, JSON.stringify(o)), [KEY, overlay({ [VARIANS]: 'heilt' })]);
    await page.goto(base(page) + '?vising=elev');
    await ready(page);
    assert.equal(await page.isVisible('#evBtn'), true);
    assert.equal(await pressed(), 'false', 'off the first time');
    assert.equal(await strek(), false);
    assert.deepEqual(await evClasses(), [], 'off: no colours of ours');
    await select(page, VARIANS);
    assert.equal(await page.$('#panel [data-ev]'), null, 'off: no buttons in the card');
    assert.ok(!(await badges(page)).some((t) => /godt/.test(t)), 'off: no count on the tema box');
    await page.click('#evBtn');
    await page.waitForTimeout(150);
    assert.equal(await pressed(), 'true');
    assert.equal(await strek(), true, 'on: line work');
    assert.deepEqual(await evClasses(), [VARIANS]);
    assert.equal(await page.getAttribute('#panel [data-ev="heilt"]', 'aria-checked'), 'true', 'on: the buttons, with the mark');
    assert.ok((await badges(page)).some((t) => /1 av \d+ kan eg godt/.test(t)));
    await page.reload();
    await ready(page);
    assert.equal(await pressed(), 'true', 'remembered');
    assert.equal(await strek(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('fagkart.DEMO-01.evvising')), 'pa');
    await goto0(page); // without the student link: the stored choice, the teacher view
    assert.equal(await page.isVisible('#modeSeg'), true);
    assert.equal(await strek(), false, 'the teacher view is the plain map');
    assert.equal(await page.isHidden('#evBtn'), true);
    await page.click('#modeSeg [data-mode="elev"]');
    assert.equal(await strek(), true);
    await page.click('#evBtn');
    await page.waitForTimeout(150);
    assert.equal(await strek(), false);
    assert.deepEqual(await evClasses(), []);
    assert.deepEqual((await stored(page)).merke, { [VARIANS]: 'heilt' }, 'off and on again leaves the marks as they were');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the student view puts its own sections first, hints while nothing is marked, shows the version, and reminds about a copy from 10 marks', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const order = () => page.evaluate(() => [...document.querySelectorAll('#side > details.sec')].map((d) => d.dataset.layer || d.id));
    // teacher view: "Visning" first and open, the student sections after the built-in ones
    assert.equal((await order())[0], 'visningSec');
    assert.equal(await page.evaluate(() => document.getElementById('visningSec').open), true);
    assert.match(await page.textContent('#moreVersjon'), /^DEMO-01 · versjon \S+$/);
    assert.equal(await page.textContent('#helpVersjon'), await page.textContent('#moreVersjon'));
    await goto(page, '?vising=elev'); // evOn turns "Kva kan eg?" on
    assert.deepEqual((await order()).slice(0, 4), ['eigenvurdering', 'nestesteg', 'stiar', 'visningSec']);
    assert.equal(await page.evaluate(() => document.getElementById('visningSec').open), false);
    assert.equal(await page.isHidden('#swImplRow'), true);
    assert.equal(await page.isVisible('#evHint'), true, 'on and nothing marked: the hint over the map');
    await select(page, VARIANS);
    assert.equal(await page.isHidden('#evHint'), true, 'the card is open: no hint');
    await page.click('#panel [data-ev="heilt"]');
    assert.match(await page.textContent('#panel .ev-note'), /ligg berre i denne nettlesaren/);
    assert.equal(await page.$('#panel .ev-remind'), null, 'one mark: no reminder yet');
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden('#evHint'), true, 'something is marked: no hint');
    await openMore(page);
    assert.match(await section(page), /Slettar du nettlesardata, forsvinn dei/);
    assert.match(await page.textContent('#side [data-ev-act="ned"]'), /Lagre kopi \(fil\)/);
    assert.match(await page.textContent('#side [data-ev-act="opne"]'), /Hent frå fil/);
    // ten marks: the reminder, in the section and in the card; "Lagre kopi" clears it and the stamp of the copy shows
    const ids = await page.evaluate(() => window.__cy.nodes('[kind="node"]').map((n) => n.id()).filter((id) => id.startsWith('DEMO-01/')).slice(0, 12));
    await page.keyboard.press('Escape');
    for (const id of ids.filter((id) => id !== VARIANS).slice(0, 9)) await mark(page, id, 'delvis');
    assert.equal(Object.keys((await stored(page)).merke).length, 10);
    assert.match(await page.textContent('#panel .ev-remind'), /Du har 10 markeringar som berre ligg i denne nettlesaren/);
    await openMore(page);
    assert.match(await page.textContent('#side .ev-remindbox'), /Du har 10 markeringar/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#side .ev-remindbox [data-ev-act="kopi"]')]);
    assert.match(dl.suggestedFilename(), /^eigenvurdering-DEMO-01-\d{4}-\d\d-\d\d\.json$/);
    await page.waitForTimeout(150);
    assert.equal(await page.textContent('#side .ev-remindbox'), '', 'saved: no reminder');
    assert.match(await section(page), /Kopi lagra \d\d\.\d\d\.\d{4} kl\./);
    const copy = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), 'fagkart.DEMO-01.evkopi');
    assert.equal(copy.tal, 10);
    await goto(page, '?vising=elev'); // remembered
    await openMore(page);
    assert.equal(await page.textContent('#side .ev-remindbox'), '');
    // the copy is old: the reminder is back
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ naar: '2026-01-01T10:00:00+01:00', tal: 10 })), 'fagkart.DEMO-01.evkopi');
    await goto(page, '?vising=elev');
    await openMore(page);
    assert.match(await page.textContent('#side .ev-remindbox'), /Du har 10 markeringar/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('?vising=elev opens the student view, ?vising=laerar the teacher view, and the choice is remembered', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const checked = () => page.evaluate(() => document.querySelector('#modeSeg [aria-checked="true"]').dataset.mode);
    assert.equal(await checked(), 'laerar'); // nothing asked for, nothing remembered
    await goto(page, '?vising=elev');
    assert.equal(await checked(), 'elev');
    assert.equal(await page.isHidden('#modeSeg'), true, 'the student link has no "Lærar | Elev" switch');
    await select(page, VARIANS);
    assert.doesNotMatch(await page.textContent('#panel'), /Elevvising er på/, 'nor the line that says so');
    await goto(page); // no parameter: the stored choice is still the teacher view, the link did not store anything
    assert.equal(await checked(), 'laerar');
    await page.click('#modeSeg [data-mode="elev"]');
    await goto(page);
    assert.equal(await checked(), 'elev'); // the click is remembered
    await goto(page, '?vising=laerar');
    assert.equal(await checked(), 'laerar'); // the URL wins over the remembered choice
    assert.equal(await page.isVisible('#modeSeg'), true);
    await goto(page, '?vising=noko-anna');
    assert.equal(await checked(), 'elev'); // an unknown value is ignored: the remembered choice holds
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the teacher view has no trace of the layer', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await select(page, VARIANS);
    assert.equal(await page.$('#panel .ev-card'), null);
    assert.equal(await page.isHidden('#side [data-layer="eigenvurdering"]'), true);
    assert.equal(await page.evaluate(() => window.__cy.nodes('[class*="ev-"]').length), 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a mark from the card colours the node, counts on the tema box, lasts through a reload and goes away with a second click', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    const plain = await fill(page, VARIANS);
    await select(page, VARIANS);
    const buttons = await page.$$('#panel .ev-card [role="radio"]');
    assert.deepEqual(await Promise.all(buttons.map((b) => b.textContent())), ['Ikkje enno', 'Delvis', 'Godt']);
    for (const b of buttons) assert.ok((await b.boundingBox()).height >= 44, 'tall enough for a finger');
    assert.equal(await page.$('#panel .ev-card [aria-checked="true"]'), null); // unmarked is unknown, nothing is chosen

    await page.click('#panel [data-ev="heilt"]');
    assert.equal(await page.getAttribute('#panel [data-ev="heilt"]', 'aria-checked'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.ev), 'heilt'); // the focus stays on the button
    const heilt = await fill(page, VARIANS);
    assert.notEqual(heilt, plain);
    assert.ok((await badges(page)).includes('1 av 8 kan eg godt'), (await badges(page)).join('|'));
    await page.click('#panel [data-ev="delvis"]');
    const delvis = await fill(page, VARIANS);
    await page.click('#panel [data-ev="ikkje"]');
    const ikkje = await fill(page, VARIANS);
    assert.equal(new Set([plain, heilt, delvis, ikkje]).size, 4, 'four different fills');
    assert.ok((await badges(page)).includes('0 av 8 kan eg godt')); // something in the tema is marked

    await page.click('#panel [data-ev="heilt"]');
    const o = await stored(page);
    assert.deepEqual(o.merke, { [VARIANS]: 'heilt' });
    assert.equal(o.namn, 'Mi eigenvurdering');
    assert.equal(o.type, 'eigenvurdering');
    assert.equal(o.kart, 'DEMO-01');
    assert.equal(o.kartversjon, '0.1');
    assert.match(o.oppdatert, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);

    await goto(page, '?vising=elev'); // a new visit
    assert.equal(await fill(page, VARIANS), heilt);
    assert.ok((await badges(page)).includes('1 av 8 kan eg godt'));
    await select(page, VARIANS);
    assert.equal(await page.getAttribute('#panel [data-ev="heilt"]', 'aria-checked'), 'true');
    await openMore(page);
    assert.match(await section(page), /1\s*kan eg godt/);
    assert.match(await section(page), /Sist endra \d\d\.\d\d\.\d{4} kl\./);
    assert.match(await page.textContent('#stView'), /1 godt/);
    await page.keyboard.press('Escape'); // "Fleire val" covers the card on a wide screen

    await page.click('#panel [data-ev="heilt"]'); // the same button once more
    assert.equal(await fill(page, VARIANS), plain);
    assert.deepEqual((await stored(page)).merke, {});
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('no mark on a competence goal, a count on its card, and grey neighbours in the tema view stay grey', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    await mark(page, VARIANS, 'heilt');
    await mark(page, AVVIK, 'delvis');
    await page.evaluate((i) => { const b = [...document.querySelectorAll('#kmList .kmitem')].find((x) => x.dataset.km === i); b.click(); }, KM01);
    assert.equal(await page.$('#panel .ev-card'), null);
    assert.match(await page.textContent('#panel .ev-km'), /1 av \d+ kan eg godt/);
    // a neighbour of another tema, grey in the tema view, gets no colour even when it is marked
    await mark(page, 'DEMO-01/normalfordeling', 'heilt');
    await page.evaluate(() => window.__fk.openTema('beskrivande'));
    await page.waitForTimeout(900);
    const grey = await page.evaluate(() => window.__cy.nodes('.grey').map((n) => [n.id(), n.hasClass('ev-heilt') || n.hasClass('ev-delvis') || n.hasClass('ev-ikkje')]));
    assert.ok(grey.length > 0, 'the tema has grey neighbours');
    assert.ok(grey.every(([, has]) => !has), JSON.stringify(grey));
    assert.match(await fill(page, VARIANS), /^rgb/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('"Last ned" gives a file that fits the schema and "Opne fil" in an empty browser gives the same map', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  let other = null;
  try {
    await goto(page, '?vising=elev');
    await mark(page, VARIANS, 'heilt');
    await mark(page, AVVIK, 'delvis');
    await mark(page, 'DEMO-01/spreiing', 'ikkje');
    const colours = Object.fromEntries(await Promise.all([VARIANS, AVVIK, 'DEMO-01/spreiing'].map(async (i) => [i, await fill(page, i)])));
    await openMore(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#side [data-ev-act="ned"]')]);
    assert.match(dl.suggestedFilename(), /^eigenvurdering-DEMO-01-\d{4}-\d\d-\d\d\.json$/);
    const saved = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-ev-')), dl.suggestedFilename());
    await dl.saveAs(saved);
    const o = JSON.parse(fs.readFileSync(saved, 'utf8'));
    assert.deepEqual(o, { ...(await stored(page)) }); // the file is the stored object
    assert.deepEqual(Object.keys(o), ['format', 'kart', 'kartversjon', 'namn', 'type', 'skala', 'merke', 'oppdatert']);
    // validates against schema/overlegg.schema.json (python: jsonschema is what the lint uses)
    execFileSync('python3', ['-c', 'import json,sys,jsonschema; jsonschema.Draft202012Validator(json.load(open(sys.argv[1]))).validate(json.load(open(sys.argv[2])))',
      path.join(viewerDir, '..', 'schema', 'overlegg.schema.json'), saved], { stdio: 'pipe' });

    other = await emptyBrowser(page, '?vising=elev'); // nothing stored here
    assert.equal(await stored(other.p), null);
    await openFile(other.p, { name: path.basename(saved), mimeType: 'application/json', buffer: fs.readFileSync(saved) });
    assert.deepEqual((await stored(other.p)).merke, o.merke);
    for (const [id, c] of Object.entries(colours)) assert.equal(await fill(other.p, id), c, id);
    assert.match(await section(other.p), /Fila er opna/);
    assert.deepEqual(other.errors, []);
    assert.deepEqual(errors, []);
  } finally { if (other) await other.ctx.close(); await close(); }
});

test('a file for the wrong map or of the wrong kind is turned down and changes nothing', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    await mark(page, VARIANS, 'heilt');
    const before = await stored(page);
    const reject = async (f, re) => {
      await openFile(page, f);
      assert.match(await page.textContent('#side [data-layer="eigenvurdering"] .ev-msg'), re);
      assert.equal(await page.$('#side .ev-confirm button'), null, 'no question: nothing to replace');
      assert.deepEqual(await stored(page), before);
    };
    await reject(file(overlay({ [VARIANS]: 'ikkje' }, { kart: 'XYZ-99' })), /XYZ-99.*DEMO-01/);
    await reject(file(overlay({ [VARIANS]: 'ikkje' }, { type: 'dekning' })), /dekning/);
    await reject(file(overlay({ [VARIANS]: 'ikkje' }, { format: 'fagkart/1' })), /ikkje ei fil/);
    await reject(file('{ikkje json'), /gyldig JSON/);
    await reject(file(overlay([['x']])), /merke/);
    await reject(file(overlay('heilt')), /merke/);
    await reject(file({ ...overlay({ [VARIANS]: 'ikkje' }), merke: undefined }), /merke/); // no merke at all: not an empty file
    await reject(file(overlay({ [VARIANS]: 'ikkje' }, { skala: ['ja', 'nei'] })), /skala/);
    await reject(file(overlay({ [VARIANS]: 'ikkje' }, { skala: ['heilt', 'delvis', 'ikkje'] })), /skala/); // the order is part of it
    await reject(file({ ...overlay({ [VARIANS]: 'ikkje' }), skala: undefined }), /skala/);
    assert.equal(await fill(page, VARIANS) === await fill(page, 'DEMO-01/spreiing'), false); // the mark still shows
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a file with an unknown node id is taken in and shown as orphans, which come back on download; bad values are dropped', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  let other = null;
  try {
    other = await emptyBrowser(page, '?vising=elev');
    const p = other.p;
    // old file: no type, other map version, an id the map does not have, a value outside the scale, an id that is no node id
    await openFile(p, file(overlay({ [VARIANS]: 'heilt', 'DEMO-01/gammalt-omgrep': 'delvis', [AVVIK]: 'nesten', 'ikkje-id': 'heilt' }, { type: undefined, kartversjon: '0.0', oppdatert: '2026-10-23T14:02:00+02:00' })));
    const text = await section(p);
    assert.match(text, /Fila er laga for versjon 0\.0 av kartet/);
    assert.match(text, /Markeringar på omgrep som ikkje finst i denne versjonen \(1\)/);
    assert.match(text, /2 markeringar med ukjend verdi eller ID vart forkasta/);
    assert.match(text, /Sist endra 23\.10\.2026 kl\. \d\d\.\d\d/);
    assert.match(text, /Markeringane er frå versjon 0\.0 av kartet \(no: 0\.1\)/);
    assert.deepEqual((await stored(p)).merke, { [VARIANS]: 'heilt', 'DEMO-01/gammalt-omgrep': 'delvis' });
    assert.equal(await stored(p).then((o) => o.kartversjon), '0.0');
    // the orphan is in the file that is downloaded
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#side [data-ev-act="ned"]')]);
    const out = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal(out.merke['DEMO-01/gammalt-omgrep'], 'delvis');
    assert.equal(out.kartversjon, '0.0');
    assert.equal(out.namn, 'Mi eigenvurdering');
    // a new mark stamps the present version and keeps the orphan
    await mark(p, AVVIK, 'ikkje');
    const o = await stored(p);
    assert.equal(o.kartversjon, '0.1');
    assert.equal(o.merke['DEMO-01/gammalt-omgrep'], 'delvis');
    assert.equal(o.merke[AVVIK], 'ikkje');
    assert.deepEqual(other.errors, []);
    assert.deepEqual(errors, []);
  } finally { if (other) await other.ctx.close(); await close(); }
});

test('a file over marks you already have asks first; "Tøm alle" asks too', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    await mark(page, VARIANS, 'heilt');
    await openFile(page, file(overlay({ [AVVIK]: 'ikkje' })));
    const confirm = '#side .ev-confirm';
    assert.match(await page.textContent(confirm), /Du har alt 1 markering her/);
    assert.deepEqual((await stored(page)).merke, { [VARIANS]: 'heilt' }); // nothing has happened yet
    await page.click(`${confirm} [data-ev-act="nei"]`);
    assert.equal(await page.isHidden(confirm), true);
    assert.deepEqual((await stored(page)).merke, { [VARIANS]: 'heilt' });

    await openFile(page, file(overlay({ [AVVIK]: 'ikkje' })));
    await page.click(`${confirm} [data-ev-act="ja"]`);
    assert.deepEqual((await stored(page)).merke, { [AVVIK]: 'ikkje' });

    await page.click('#side [data-ev-act="tom"]');
    assert.match(await page.textContent(confirm), /Tøme alle 1 markeringane/);
    await page.click(`${confirm} [data-ev-act="nei"]`);
    assert.equal(Object.keys((await stored(page)).merke).length, 1);
    await page.click('#side [data-ev-act="tom"]');
    await page.click(`${confirm} [data-ev-act="ja"]`);
    assert.deepEqual((await stored(page)).merke, {});
    assert.equal(await page.isDisabled('#side [data-ev-act="tom"]'), true);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('with storage blocked the marks stay in memory and the page says so', { skip }, async () => {
  const blocked = () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); };
  const { page, errors, close } = await openMap(MAP, [], { init: blocked });
  try {
    await page.goto(base(page) + '?vising=elev'); // the walk-through shows when nothing can be stored (test/gjennomgang.browser.test.mjs): end it first
    await ready(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__tour.finish());
    await evOn(page);
    await mark(page, VARIANS, 'heilt');
    assert.match(await page.textContent('#panel'), /Markeringane blir ikkje lagra i denne nettlesaren\. Last ned fila før du lukkar sida\./);
    await openMore(page);
    assert.match(await section(page), /Markeringane blir ikkje lagra i denne nettlesaren\. Last ned fila før du lukkar sida\./);
    assert.match(await fill(page, VARIANS), /^rgb/);
    assert.ok((await badges(page)).includes('1 av 8 kan eg godt'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#side [data-ev-act="ned"]')]);
    assert.deepEqual(JSON.parse(fs.readFileSync(await dl.path(), 'utf8')).merke, { [VARIANS]: 'heilt' });
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('when storage works the page does not warn', { skip }, async () => {
  const { page, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    await mark(page, VARIANS, 'heilt');
    assert.doesNotMatch(await page.textContent('#panel'), /ikkje lagra/);
    assert.equal(await page.isHidden('#side .ev-warn'), true);
  } finally { await close(); }
});

test('no network and nothing in the URL', { skip }, async () => {
  const { page, close } = await openMap(MAP);
  try {
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await goto(page, '?vising=elev');
    requests.length = 0;
    await mark(page, VARIANS, 'heilt');
    await openMore(page);
    await Promise.all([page.waitForEvent('download'), page.click('#side [data-ev-act="ned"]')]);
    assert.deepEqual(requests.filter((u) => !u.startsWith('blob:') && !u.startsWith('file:')), []);
    assert.equal(page.url().includes('heilt'), false);
    assert.equal(new URL(page.url()).search, '?vising=elev');
  } finally { await close(); }
});

test('two pages of the same browser (the itslearning frame and a tab of its own) do not overwrite each other', { skip }, async () => {
  const { page: first, errors, close } = await openMap(MAP);
  let ctx = null;
  try {
    ctx = await first.context().browser().newContext({ viewport: { width: 1400, height: 900 } }); // one browser, two pages
    await ctx.addInitScript(TOUR_DONE);
    const errs = [];
    const open = async () => {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(base(first) + '?vising=elev');
      await ready(p);
      await evOn(p);
      return p;
    };
    const a = await open(), b = await open(); // both have read the (empty) storage
    await mark(a, VARIANS, 'heilt');
    // the other page takes the mark in by itself (storage event); wait for it rather than for a fixed time, which a busy test run may outlast
    await b.waitForFunction((id) => window.__cy.getElementById(id).hasClass('ev-heilt'), VARIANS, { timeout: 5000 });
    assert.notEqual(await fill(b, VARIANS), await fill(b, 'DEMO-01/spreiing'), 'the other page took the mark in at once (storage event)');
    await mark(b, AVVIK, 'delvis');
    assert.deepEqual((await stored(a)).merke, { [VARIANS]: 'heilt', [AVVIK]: 'delvis' });
    // a page that has not heard anything still reads before it writes: the mark of the other page is not lost
    await b.evaluate((k) => { const o = JSON.parse(localStorage.getItem(k)); o.merke['DEMO-01/spreiing'] = 'ikkje'; localStorage.setItem(k, JSON.stringify(o)); }, KEY);
    await mark(a, 'DEMO-01/histogram', 'heilt');
    assert.deepEqual((await stored(a)).merke, { [VARIANS]: 'heilt', [AVVIK]: 'delvis', 'DEMO-01/spreiing': 'ikkje', 'DEMO-01/histogram': 'heilt' });
    assert.deepEqual(errs, []);
    assert.deepEqual(errors, []);
  } finally { if (ctx) await ctx.close(); await close(); }
});

test('stored text that cannot be read is kept under a backup key and the section says so', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    await page.evaluate((k) => localStorage.setItem(k, '{trasig'), KEY);
    await goto(page, '?vising=elev');
    await openMore(page);
    assert.match(await section(page), /Lagra markeringar kunne ikkje lesast/);
    assert.equal(await page.evaluate((k) => localStorage.getItem(k + '.defekt'), KEY), '{trasig');
    await page.keyboard.press('Escape');
    await mark(page, VARIANS, 'heilt'); // the student can go on; the broken text stays where it was put
    assert.equal(await page.evaluate((k) => localStorage.getItem(k + '.defekt'), KEY), '{trasig');
    assert.deepEqual((await stored(page)).merke, { [VARIANS]: 'heilt' });
    // a valid object of another map (wrong kart) is just as unreadable
    await page.evaluate(([k, o]) => localStorage.setItem(k, o), [KEY, JSON.stringify(overlay({}, { kart: 'S2' }))]);
    await goto(page, '?vising=elev');
    await openMore(page);
    assert.match(await section(page), /Lagra markeringar kunne ikkje lesast/);
    assert.equal(await page.evaluate((k) => localStorage.getItem(k + '.defekt'), KEY), '{trasig'); // the first one is kept
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a marked forkunnskap node is not faded, and the tema box shows the holes and the marks together', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await goto(page, '?vising=elev');
    await page.evaluate(() => document.querySelector('#fagSeg [data-fag="1P"]').click());
    const fk = await page.evaluate(() => {
      const d = JSON.parse(document.getElementById('fagkart-data').textContent);
      return d.nodar.find((n) => n.forkunnskap && n.forkunnskap['1P'] === 'ja').id; // covered by 1P: the forkunnskap layer fades it
    });
    const opacity = () => page.evaluate((i) => window.__cy.getElementById(i).pstyle('opacity').value, fk);
    assert.equal(await opacity(), 0.55);
    const before = (await badges(page)).filter((t) => /hol/.test(t));
    assert.equal(before.length, 1, before.join('|'));
    await mark(page, fk, 'delvis');
    assert.equal(await opacity(), 1);
    const after = (await badges(page)).filter((t) => /hol/.test(t));
    assert.equal(after.length, 1);
    assert.match(after[0], new RegExp('^' + before[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · 0 av \\d+ kan eg godt$'));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
