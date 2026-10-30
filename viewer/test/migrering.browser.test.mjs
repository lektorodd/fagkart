// The one-time move of the eigenvurdering from the key of the curriculum code (fagkart.MAT99-01.eigenvurdering) to the key of the map code
// (fagkart.DEMO-01.eigenvurdering), for a map whose two codes differ (S2 and MAT04-02). Uses a copy of the demo map with laereplan MAT99-01.
// Skipped when no Chromium is installed. Run with: node --test test/migrering.browser.test.mjs (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMap, skip, viewerDir } from './browser.mjs';

const OLD = 'fagkart.MAT99-01.eigenvurdering', NEW = 'fagkart.DEMO-01.eigenvurdering';
const VARIANS = 'DEMO-01/varians', AVVIK = 'DEMO-01/avvik', ANNAN = 'ANNAN-01/tal'; // ANNAN-01: a node of another map that shares the curriculum
const oldOverlay = { format: 'fagkart-overlegg/1', kart: 'MAT99-01', kartversjon: '0.1', namn: 'Mi eigenvurdering', type: 'eigenvurdering', skala: ['ikkje', 'delvis', 'heilt'],
  merke: { [VARIANS]: 'heilt', [AVVIK]: 'delvis', [ANNAN]: 'ikkje' }, oppdatert: '2026-10-01T10:00:00+02:00' };
// Runs before the page, once per browser context: the old key is there when the page starts
const seed = `(() => { try { if (localStorage.getItem('test.seeded')) return; localStorage.setItem('test.seeded', '1'); localStorage.setItem(${JSON.stringify(OLD)}, ${JSON.stringify(JSON.stringify(oldOverlay))}); } catch (e) {} })();`;

function variantMap() {
  const data = JSON.parse(fs.readFileSync(path.join(viewerDir, 'fixtures', 'DEMO-01.json'), 'utf8'));
  data.laereplan = 'MAT99-01';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-migrering-'));
  const file = path.join(dir, 'DEMO-01.json');
  fs.writeFileSync(file, JSON.stringify(data));
  return { file, drop: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const ready = (page) => page.waitForSelector('html[data-ready="1"]');
const get = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const evClasses = (page) => page.evaluate(() => Object.fromEntries(window.__cy.nodes('[kind="node"]').map((n) => [n.id(), ['ikkje', 'delvis', 'heilt'].find((v) => n.hasClass('ev-' + v))]).filter(([, v]) => v)));

test('the marks under the curriculum code move to the map code once; the old key stays; a key that exists is not overwritten', { skip }, async () => {
  const v = variantMap();
  const { page, close } = await openMap(v.file, [], { init: seed });
  try {
    const moved = JSON.parse(await get(page, NEW));
    assert.equal(moved.kart, 'DEMO-01');
    assert.deepEqual(moved.merke, { [VARIANS]: 'heilt', [AVVIK]: 'delvis' }); // the node of the other map stays behind
    assert.equal(moved.oppdatert, oldOverlay.oppdatert);
    assert.deepEqual(JSON.parse(await get(page, OLD)), oldOverlay); // untouched
    // the student view shows them
    await page.goto(page.url().split('?')[0] + '?vising=elev');
    await ready(page);
    await page.evaluate(() => window.__fk.setEv(true)); // "Kva kan eg?" on: the colours show
    assert.deepEqual(await evClasses(page), { [VARIANS]: 'heilt', [AVVIK]: 'delvis' });
    // a key that is there already is left as it is
    const own = JSON.stringify({ ...moved, merke: { [VARIANS]: 'ikkje' } });
    await page.evaluate(([k, o]) => localStorage.setItem(k, o), [NEW, own]);
    await page.reload();
    await ready(page);
    assert.equal(await get(page, NEW), own);
    assert.deepEqual(await evClasses(page), { [VARIANS]: 'ikkje' });
  } finally { await close(); v.drop(); }
});

test('no copy when the old key has no mark of this map, or when the two codes are equal', { skip }, async () => {
  const v = variantMap();
  const noMarks = `(() => { try { if (localStorage.getItem('test.seeded')) return; localStorage.setItem('test.seeded', '1'); localStorage.setItem(${JSON.stringify(OLD)}, ${JSON.stringify(JSON.stringify({ ...oldOverlay, merke: { [ANNAN]: 'ikkje' } }))}); } catch (e) {} })();`;
  const { page, close } = await openMap(v.file, [], { init: noMarks });
  try { assert.equal(await get(page, NEW), null); } finally { await close(); v.drop(); }
  // the demo map itself has the same code twice: an old key of the same name is the key, not a source
  const same = await openMap('fixtures/DEMO-01.json', [], { init: seed });
  try { assert.equal(await get(same.page, NEW), null); } finally { await same.close(); }
});

test('host mode (?vising=faglogg) copies nothing and writes nothing', { skip }, async () => {
  const v = variantMap();
  const first = await openMap(v.file);
  const url = first.page.url().split('?')[0];
  const ctx = await first.page.context().browser().newContext({ viewport: { width: 1200, height: 800 } });
  try {
    await ctx.addInitScript(seed);
    const page = await ctx.newPage();
    await page.goto(url + '?vising=faglogg');
    await ready(page);
    await page.waitForTimeout(300);
    assert.equal(await get(page, NEW), null);
    assert.deepEqual(JSON.parse(await get(page, OLD)), oldOverlay);
  } finally { await ctx.close(); await first.close(); v.drop(); }
});
