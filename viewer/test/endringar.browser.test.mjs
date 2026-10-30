// "Kva er nytt" in the help box (src/endringar.js, app.js renderNytt): the lists with names that choose the node, the student view without field names,
// older versions folded, and the box open after the strip's "Kva er nytt" (sessionStorage fagkart.nytt). The demo map has a hand-written log
// (fixtures/DEMO-01.endringar.json). Screenshots of the real S2 map go to skjermbilete/16. Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMap, skip, viewerDir } from './browser.mjs';

const DEMO = path.join('fixtures', 'DEMO-01.json');
const S2 = path.join('..', 'dist', 'S2.json');
const SHOTS = path.join(viewerDir, 'skjermbilete', '16');
// The lists of 2026.2 are computed from the git tags S2-2026.1 and S2-2026.2 (scripts/endringar.py), so a tree without those tags (the open export, after its own bygg.py) has only the summaries
const logS2 = (() => { try { return JSON.parse(fs.readFileSync(path.join(viewerDir, '..', 'dist', 'S2.endringar.json'), 'utf8')); } catch (e) { return null; } })();
const hasS2 = fs.existsSync(path.join(viewerDir, S2)) && !!logS2 && logS2.versjonar.some((v) => v.versjon === '2026.2' && v.utrekna);
const open = async (page) => { await page.click('#helpBtn'); await page.waitForSelector('#helpBox:not([hidden])'); };
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const reopen = async (page, query) => { await page.goto(page.url().split('?')[0] + query); await page.waitForSelector('html[data-ready="1"]'); await page.waitForTimeout(300); };

test('the help box lists what is new, changed and deleted, with names that choose the node', { skip }, async () => {
  const { page, errors, close } = await openMap(DEMO);
  try {
    assert.equal(await page.isVisible('#nytt'), false, 'the box is in the closed help box');
    await open(page);
    assert.equal(await page.isVisible('#nytt'), true);
    assert.equal(await page.textContent('#nytt h3'), 'Kva er nytt i 0.1');
    assert.match(await page.textContent('#nytt .nytt-samandrag'), /Fordelingane har fått/);
    assert.match(await page.textContent('#nytt .note'), /29\. oktober 2026 · etter 2 innspel/);
    assert.deepEqual(await texts(page, '#nytt > .nytt-v h5'), ['Nytt (2)', 'Endra (2)', 'Sletta (1)']);
    // teacher view: the names of the changed fields stand after the name
    const rows = await texts(page, '#nytt > .nytt-v .nytt-liste li');
    assert.ok(rows.some((t) => /σ2/.test(t) && /forklaring til eleven, døme/.test(t)), rows.join(' | '));
    assert.ok(rows.some((t) => /nivå, forkjennskap/.test(t)));
    assert.ok(rows.some((t) => /Variasjonsbreidd/.test(t)));
    assert.equal((await texts(page, '#nytt > .nytt-v .note')).pop(), '2 nye piler · 1 fjerna');
    // a name in the map is a button; a deleted node is plain text
    assert.equal((await page.$$('#nytt > .nytt-v .nytt-liste button.linkbtn')).length, 4);
    assert.equal((await page.$$('#nytt > .nytt-v ul.nytt-liste:last-of-type button')).length, 0, 'the deleted node is not a button');
    // older versions are folded
    assert.equal(await page.getAttribute('#nytt details', 'open'), null);
    assert.equal(await page.textContent('#nytt details summary'), 'Tidlegare versjonar');
    assert.equal(await page.isVisible('#nytt details h4'), false);
    await page.click('#nytt details summary');
    assert.equal(await page.textContent('#nytt details h4'), 'Kva er nytt i 0.0');
    // a click on a name chooses the node (and the help box gets out of the way)
    await page.click('#nytt > .nytt-v .nytt-liste button:has-text("σ")');
    assert.equal(await page.evaluate(() => window.__fk.state.sel), 'DEMO-01/varians');
    assert.equal(await page.isVisible('#helpBox'), false);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the student view has the same lists but no names of fields', { skip }, async () => {
  const { page, errors, close } = await openMap(DEMO);
  try {
    await reopen(page, '?vising=elev');
    await open(page);
    assert.deepEqual(await texts(page, '#nytt > .nytt-v h5'), ['Nytt (2)', 'Endra (2)', 'Sletta (1)']);
    const text = await page.textContent('#nytt > .nytt-v');
    for (const f of ['forklaring til eleven', 'døme', 'forkjennskap', 'nivå,']) assert.ok(!text.includes(f), `no "${f}" in the student view`);
    assert.equal((await page.$$('#nytt > .nytt-v .nytt-liste .note')).length, 0);
    assert.match(text, /Varians/);
    assert.equal((await texts(page, '#nytt > .nytt-v .note')).pop(), '2 nye piler · 1 fjerna');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the teacher view comes back with the field names when the view is switched', { skip }, async () => {
  const { page, errors, close } = await openMap(DEMO);
  try {
    await page.click('#modeSeg button[data-mode="elev"]');
    await open(page);
    assert.equal((await page.$$('#nytt > .nytt-v .nytt-liste .note')).length, 0);
    await page.click('#helpBtn');
    await page.click('#modeSeg button[data-mode="laerar"]');
    await open(page);
    assert.ok((await page.$$('#nytt > .nytt-v .nytt-liste .note')).length > 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('sessionStorage fagkart.nytt opens the help box once and is removed', { skip }, async () => {
  const { page, errors, close } = await openMap(DEMO);
  try {
    assert.equal(await page.isVisible('#helpBox'), false);
    await page.evaluate(() => sessionStorage.setItem('fagkart.nytt', '1'));
    await page.reload();
    await page.waitForSelector('html[data-ready="1"]');
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible('#helpBox'), true);
    assert.equal(await page.getAttribute('#helpBtn', 'aria-expanded'), 'true');
    assert.equal(await page.isVisible('#nytt h3'), true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('fagkart.nytt')), null);
    await page.reload(); // the mark is used up: the next load starts with the box closed
    await page.waitForSelector('html[data-ready="1"]');
    assert.equal(await page.isVisible('#helpBox'), false);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a map without a log has no box', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-utan-logg-'));
  fs.copyFileSync(path.join(viewerDir, DEMO), path.join(dir, 'DEMO-01.json')); // the map alone, no DEMO-01.endringar.json beside it
  const { page, errors, close } = await openMap(path.join(dir, 'DEMO-01.json'));
  try {
    await open(page);
    assert.equal(await page.isVisible('#nytt'), false);
    assert.equal(await page.textContent('#fagkart-endringar'), 'null');
    assert.deepEqual(errors, []);
  } finally { await close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const [name, viewport] of [['skrivebord', { width: 1400, height: 900 }], ['mobil', { width: 390, height: 844 }]]) {
  test(`screenshot of the help box with "Kva er nytt" (S2, ${name})`, { skip: skip || (hasS2 ? false : 'no dist/S2.json with the computed version log of 2026.2 (needs the git tags S2-2026.1 and S2-2026.2)') }, async () => {
    const { page, errors, close } = await openMap(S2, [], { viewport });
    try {
      await open(page);
      const box = await page.textContent('#nytt h3');
      assert.match(box, /^Kva er nytt i \d{4}\.\d+$/); // the newest version of the map, whatever it is now
      // 2026.2 is the version the lists are known for (12 new nodes, among them Eulers metode): the top box, or one of the earlier versions
      const v = await page.evaluateHandle(() => { const all = [...document.querySelectorAll('#nytt .nytt-v')]; const el = all.find((d) => /2026\.2/.test(d.querySelector('h3, h4').textContent)); const det = el && el.closest('details'); if (det) det.open = true; return el; });
      assert.ok(await v.evaluate((el) => !!el), 'the box for 2026.2');
      const nye = (await v.evaluate((el) => [...el.querySelectorAll('li')].map((li) => li.textContent))).slice(0, 12); // the 12 new nodes come first, the last ones in the fold
      assert.ok(nye.some((t) => /Eulers metode/.test(t)) && nye.some((t) => /Velje modelltype/.test(t)) && nye.some((t) => /Gjennomsnittsverdi/.test(t)), nye.join(' | '));
      // the long list of changed nodes is folded after eight rows
      assert.equal(await v.evaluate((el) => el.querySelectorAll(':scope > ul.nytt-liste').length), 2, 'Nytt and Endra; nothing is deleted');
      assert.equal(await v.evaluate((el) => el.querySelector(':scope > ul.nytt-liste').querySelectorAll('li').length), 8);
      assert.match(await v.evaluate((el) => el.querySelector('details.nytt-fleire summary').textContent), /^Vis \d+ til$/);
      await page.evaluate(() => { document.getElementById('helpBox').scrollTop = Math.max(0, document.getElementById('nytt').offsetTop - 8); });
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `kva-er-nytt-${name}.png`) });
      assert.deepEqual(errors, []);
    } finally { await close(); }
  });
}
