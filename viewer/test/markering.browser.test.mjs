// The layer "Markering" (src/lag/markering.js) in the real page: the teacher view, a scale from a file or from "Ny markering", the keys,
// the note, sets with a frame on the map, the coverage table, "Lagre" straight to the opened file (File System Access API, mocked here) or as a
// download, the copy in localStorage, "Vis stort", and no network. Uses the demo map and the overlays in fixtures/overlegg/.
// Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openMap, skip, viewerDir } from './browser.mjs';

const MAP = 'fixtures/DEMO-01.json';
const KEY = 'fagkart.DEMO-01.markering';
const fixture = (name) => fs.readFileSync(path.join(viewerDir, 'fixtures', 'overlegg', name), 'utf8');
const EKSAMEN = fixture('DEMO-01-eksamen.json'), AARSPLAN = fixture('DEMO-01-aarsplan.json');
const D = (id) => `DEMO-01/${id}`;
const KM01_NODES = ['spreiing', 'histogram', 'kvadrert-avvik', 'varians', 'kvifor-kvadrat'].map(D); // serve km01 only
const base = (page) => page.url().split('?')[0];
const ready = (page) => page.waitForSelector('html[data-ready="1"]').then(() => page.waitForTimeout(250));
const select = (page, id) => page.evaluate((i) => window.__fk.select(i, { center: false }), id);
const overlay = (page) => page.evaluate(() => window.__fk.layers.get('markering').overlegg());
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const classes = (page, id) => page.evaluate((i) => window.__cy.getElementById(i).classes(), id);
const badges = (page) => page.evaluate(() => window.__cy.nodes('.ghost[role^="pill-"]').map((n) => n.data('label')));
const section = (page) => page.textContent('#side [data-layer="markering"]');
const openMore = async (page) => { if ((await page.getAttribute('#moreBtn', 'aria-expanded')) !== 'true') await page.click('#moreBtn'); };
const act = async (page, a) => { await openMore(page); await page.click(`#side [data-layer="markering"] [data-mk-act="${a}"]`); await page.waitForTimeout(120); };
const file = (text, name = 'fil.json') => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
const key = async (page, k) => { await page.keyboard.press(k); await page.waitForTimeout(60); };
// Focus away from any field so the keys reach the layer
const blur = (page) => page.evaluate(() => document.activeElement && document.activeElement.blur());

// The File System Access API as an in-memory file: window.__fs.text is what the file holds, window.__fs.writes counts the writes.
// showOpenFilePicker gives the handle of that file; showSaveFilePicker a handle named "lagra.json" that writes to the same place.
const FS_MOCK = `
  window.__fs = { text: '', writes: 0, names: [] };
  const mk = (name) => ({ kind: 'file', name,
    getFile: async () => new File([window.__fs.text], name, { type: 'application/json' }),
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    createWritable: async () => { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { window.__fs.text = buf; window.__fs.writes++; window.__fs.names.push(name); } }; } });
  window.showOpenFilePicker = async () => [mk('eksamen-DEMO-01.json')];
  window.showSaveFilePicker = async (o) => mk('lagra.json');
`;
const NO_FS = 'delete window.showOpenFilePicker; delete window.showSaveFilePicker; window.showOpenFilePicker = undefined; window.showSaveFilePicker = undefined;';

test('off until a file is opened or "Ny markering" is chosen, and only in the teacher view', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await openMore(page);
    assert.match(await section(page), /Ny markering/);
    assert.match(await section(page), /Opne fil/);
    assert.equal(await page.isHidden('#side [data-mk-act="lagre"]'), true, 'nothing to save yet');
    await select(page, KM01_NODES[0]);
    assert.equal(await page.$('#panel [data-mk-card]'), null, 'off: nothing in the card');
    await key(page, 'Escape');
    await key(page, 'Escape');
    // the student view has no section
    await page.goto(base(page) + '?vising=elev');
    await ready(page);
    assert.equal(await page.isHidden('#side [data-layer="markering"]'), true);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('eksamen: open the file, mark five nodes with the keys, make a set, save to the same file; open again and all is there; no network', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP, [], { init: FS_MOCK });
  try {
    const requests = [];
    const pageUrl = page.url();
    page.on('request', (r) => { if (!/^(blob|data):/.test(r.url()) && r.url() !== pageUrl) requests.push(r.url()); });
    await page.evaluate((t) => { window.__fs.text = t; }, EKSAMEN);
    await act(page, 'opne');
    assert.match(await section(page), /Opna «Eksamen DEMO-01, konstrukt»/);
    assert.match(await section(page), /«Lagre» skriv rett til eksamen-DEMO-01\.json/);
    assert.equal((await overlay(page)).merke[D('avvik')], 'del1');
    assert.ok((await classes(page, D('avvik'))).includes('mk-blue'), 'del 1 is blue on the map');
    assert.ok((await classes(page, D('rekne-sd'))).includes('mk-sett'), 'the first set is active: its frame');
    // the card: the four values as buttons, the note, "i sett"
    await select(page, D('rekne-sd'));
    assert.deepEqual(await page.$$eval('#panel [data-mk]', (bs) => bs.map((b) => b.textContent)), ['1Del 1 (utan hjelpemiddel)', '2Del 2', '3Ikkje eigna', '4Uavklart']);
    assert.equal(await page.getAttribute('#panel [data-mk="del2"]', 'aria-checked'), 'true');
    assert.equal(await page.inputValue('#panel [data-mk-notat]'), 'Demo: eit notat frå møtet.');
    assert.match(await page.textContent('#panel .mk-sets'), /I sett: Sett A, hausten 2027/);
    // a new set, active
    await openMore(page);
    await page.fill('#side [data-mk-settnamn]', 'Sett B');
    await page.click('#side [data-mk-act="lag-sett"]');
    assert.equal(await page.getAttribute('#side [data-mk-aktiv="Sett B"]', 'aria-pressed'), 'true');
    await page.keyboard.press('Escape'); // close "Fleire val"
    // five nodes with the keys: 1 2 3 4 1, and each in Sett B
    const want = ['del1', 'del2', 'ikkje-eigna', 'uavklart', 'del1'];
    for (const [i, id] of KM01_NODES.entries()) {
      await select(page, id);
      await blur(page);
      await key(page, ['1', '2', '3', '4', '1'][i]);
      await key(page, 's');
    }
    let o = await overlay(page);
    for (const [i, id] of KM01_NODES.entries()) assert.equal(o.merke[id], want[i], id);
    assert.deepEqual(o.omraade.find((s) => s.namn === 'Sett B').nodar, KM01_NODES);
    assert.ok((await classes(page, KM01_NODES[0])).includes('mk-sett'), 'the frame of the active set');
    assert.ok(!(await classes(page, D('avvik'))).includes('mk-sett'), 'Sett A is not active now');
    // 0 takes the mark away, a key sets (pressing the same again keeps it), n opens the note, the key goes into the note and not to the layer
    await select(page, D('z-verdi'));
    await blur(page);
    await key(page, '2'); await key(page, '2');
    assert.equal((await overlay(page)).merke[D('z-verdi')], 'del2');
    await key(page, '0');
    assert.equal((await overlay(page)).merke[D('z-verdi')], undefined);
    await key(page, '5'); // the scale has four values
    assert.equal((await overlay(page)).merke[D('z-verdi')], undefined);
    await key(page, 'n');
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-mk-notat')), true, 'n: the note has the focus');
    await page.keyboard.type('1 s n');
    assert.equal(await page.inputValue('#panel [data-mk-notat]'), '1 s n');
    o = await overlay(page);
    assert.equal(o.merke[D('z-verdi')], undefined, 'typing in the note sets no mark');
    assert.deepEqual(o.notat.find((n) => n.node === D('z-verdi')), { node: D('z-verdi'), tekst: '1 s n' });
    await key(page, 'Escape'); // leaves the note; the card stays
    assert.equal(await page.isVisible('#panel [data-mk-card]'), true);
    // the search box: the keys are text there
    await page.click('#q');
    await page.keyboard.type('1');
    assert.equal((await overlay(page)).merke[D('z-verdi')], undefined, 'typing in the search sets no mark');
    await page.fill('#q', '');
    await key(page, 'Escape');
    // the badge on the tema box
    await page.evaluate(() => window.__fk.goLevel('tema'));
    await page.waitForTimeout(400);
    assert.ok((await badges(page)).some((t) => /^3 del 1 · 2 del 2 · 1 ikkje eigna · 1 uavklart$/.test(t)), (await badges(page)).join(' | '));
    // save: straight to the opened file
    assert.match(await section(page), /Ulagra endringar/);
    await act(page, 'lagre');
    assert.match(await section(page), /Lagra i eksamen-DEMO-01\.json/);
    assert.match(await section(page), /Alt er lagra/);
    const written = JSON.parse(await page.evaluate(() => window.__fs.text));
    assert.deepEqual(await page.evaluate(() => window.__fs.names), ['eksamen-DEMO-01.json']);
    assert.equal(written.type, 'dekning');
    assert.deepEqual(written.skala_namn, JSON.parse(EKSAMEN).skala_namn);
    assert.equal(written.omraade.length, 2);
    assert.match(written.oppdatert, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    // reload: the copy in this browser, still the same
    await page.reload();
    await ready(page);
    assert.deepEqual(await overlay(page), written);
    assert.equal((await stored(page)).ulagra, false);
    // "Lukk", then open the saved file again: all is there
    await act(page, 'lukk');
    assert.equal(await overlay(page), null);
    assert.equal(await stored(page), null, 'closed: no copy kept');
    assert.deepEqual(await page.evaluate(() => window.__cy.nodes('[id ^= "DEMO-01/"]').filter((n) => /\bmk-/.test(n.classes().join(' '))).map((n) => n.id())), [], 'closed: no colours');
    await page.evaluate((t) => { window.__fs.text = t; }, JSON.stringify(written));
    await act(page, 'opne');
    const again = await overlay(page);
    for (const [i, id] of KM01_NODES.entries()) assert.equal(again.merke[id], want[i]);
    assert.deepEqual(again.omraade.map((s) => s.namn), ['Sett A, hausten 2027', 'Sett B']);
    assert.equal(again.notat.find((n) => n.node === D('z-verdi')).tekst, '1 s n');
    // "Lagre som": a new file, and "Lagre" goes there after
    await act(page, 'lagre-som');
    assert.match(await section(page), /Lagra i lagra\.json/);
    await select(page, D('avvik')); await blur(page); await key(page, '4');
    await act(page, 'lagre');
    assert.deepEqual(await page.evaluate(() => window.__fs.names), ['lagra.json', 'lagra.json'], 'since the reload: "Lagre som", then "Lagre" to the same file');
    assert.deepEqual(requests, [], 'no network');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the coverage table: counts per competence goal, "ingen" in red, the two exam lists, and the text to copy', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP, [], { init: FS_MOCK });
  try {
    await page.evaluate((t) => { window.__fs.text = t; }, EKSAMEN);
    await act(page, 'opne');
    const row = (km) => page.$$eval(`#side [data-mk-dekning] tr[data-km="${km}"] > *`, (cs) => cs.map((c) => c.textContent));
    // km01: avvik (del 1) and rekne-sd (del 2); km02 has no mark
    const r1 = await row(D('km01')), r2 = await row(D('km02'));
    assert.equal(r1[0], 'km01');
    assert.deepEqual(r1.slice(2), ['1', '1', '·', '·', '2']);
    assert.equal(r2[r2.length - 1], 'ingen');
    assert.equal(await page.getAttribute(`#side [data-mk-dekning] tr[data-km="${D('km02')}"] td:last-child`, 'class'), 'mk-none');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#side .mk-none')).color), await page.evaluate(() => {
      const s = document.createElement('span'); s.style.color = 'var(--lo-red)'; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c;
    }), '"ingen" is red');
    // rekne-sd is "bruke" and marked del 2: on the list; put it in a second set, and it is on the other list too
    assert.match(await page.textContent('#side [data-mk-del2]'), /\(1\)/);
    assert.match(await page.textContent('#side [data-mk-fleire]'), /\(0\)/);
    await page.fill('#side [data-mk-settnamn]', 'Sett B');
    await page.click('#side [data-mk-act="lag-sett"]');
    await page.keyboard.press('Escape');
    await select(page, D('rekne-sd')); await blur(page); await key(page, 's');
    await openMore(page);
    assert.match(await page.textContent('#side [data-mk-fleire]'), /\(1\).*Sett A, hausten 2027, Sett B/);
    // the card of a competence goal: the same numbers
    const km = (id) => page.evaluate((i) => document.querySelector(`#kmList [data-km="${i}"]`).click(), id); // the list sits in a closed section
    await km(D('km02'));
    assert.match(await page.textContent('#panel [data-mk-km]'), /Ingen er merkte/);
    await km(D('km01'));
    assert.match(await page.textContent('#panel [data-mk-km]'), /1 del 1 · 1 del 2/);
    // the table as text
    const text = await page.evaluate(() => window.__fk.layers.get('markering').dekningTekst());
    assert.match(text, /^Eksamen DEMO-01, konstrukt \(DEMO-01, versjon 0\.1\)\n/);
    assert.match(text, /\nKompetansemål\tNodar\tDel 1 \(utan hjelpemiddel\)\tDel 2\tIkkje eigna\tUavklart\tMerkte\n/);
    assert.match(text, /\nkm02 [^\n]*\t0\t0\t0\t0\tingen\n/);
    assert.match(text, /\nBruke, merkt del 2 men ikkje del 1 \(1\)\n- /);
    await openMore(page);
    await page.click('#side [data-mk-act="kopier"]');
    await page.waitForTimeout(150);
    assert.match(await section(page), /Tabellen er kopiert som tekst|Klarte ikkje kopiere/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('årsplan: "Ny markering" with three values, the keys, "ingen", the badge; download and open again without the File System Access API', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP, [], { init: NO_FS });
  try {
    const requests = [];
    const pageUrl = page.url();
    page.on('request', (r) => { if (!/^(blob|data):/.test(r.url()) && r.url() !== pageUrl) requests.push(r.url()); });
    await act(page, 'ny');
    await page.fill('#side [data-mk-nytt-namn]', 'Årsplan 2027–28');
    await page.click('#side [data-mk-skala="aarsplan"]');
    await act(page, 'lag');
    let o = await overlay(page);
    assert.equal(o.namn, 'Årsplan 2027–28');
    assert.deepEqual(o.skala, ['planlagt', 'undervist', 'vurdert']);
    await page.keyboard.press('Escape');
    await select(page, KM01_NODES[0]);
    assert.deepEqual(await page.$$eval('#panel [data-mk]', (bs) => bs.map((b) => b.dataset.mk)), ['planlagt', 'undervist', 'vurdert']);
    for (const [i, id] of KM01_NODES.slice(0, 3).entries()) { await select(page, id); await blur(page); await key(page, String(i + 1)); }
    await key(page, '4'); // no fourth value: nothing
    o = await overlay(page);
    assert.deepEqual(o.merke, { [KM01_NODES[0]]: 'planlagt', [KM01_NODES[1]]: 'undervist', [KM01_NODES[2]]: 'vurdert' });
    assert.ok((await classes(page, KM01_NODES[0])).includes('mk-warn'));
    assert.ok((await classes(page, KM01_NODES[2])).includes('mk-green'));
    // s without a set says so
    await key(page, 's');
    await openMore(page);
    assert.match(await section(page), /Ingen sett er aktivt/);
    assert.equal((await page.$$eval(`#side [data-mk-dekning] tr[data-km="${D('km02')}"] td:last-child`, (c) => c.map((x) => x.textContent)))[0], 'ingen');
    // one value in use on a tema: "1 av 7 planlagt"
    await page.keyboard.press('Escape');
    await select(page, KM01_NODES[1]); await blur(page); await key(page, '0');
    await select(page, KM01_NODES[2]); await blur(page); await key(page, '0');
    await page.evaluate(() => window.__fk.goLevel('tema'));
    await page.waitForTimeout(400);
    assert.ok((await badges(page)).some((t) => /^1 av \d+ planlagt$/.test(t)), (await badges(page)).join(' | '));
    // no File System Access API: "Lagre" downloads, "Opne fil" is the file input
    await openMore(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#side [data-mk-act="lagre"]')]);
    assert.equal(dl.suggestedFilename(), 'markering-DEMO-01-arsplan-2027-28.json');
    const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.deepEqual(saved.merke, { [KM01_NODES[0]]: 'planlagt' });
    assert.match(await section(page), /Lasta ned markering-DEMO-01-arsplan-2027-28\.json/);
    // the fixture: opening it while there are no unsaved changes replaces at once
    await page.setInputFiles('#side [data-mk-file]', file(AARSPLAN, 'aarsplan.json'));
    await page.waitForTimeout(150);
    assert.equal((await overlay(page)).namn, 'Årsplan DEMO-01');
    assert.equal(await page.getAttribute('#side [data-mk-aktiv="Periode 1"]', 'aria-pressed'), 'true');
    // a change, then another file: ask first
    await page.keyboard.press('Escape');
    await select(page, D('histogram')); await blur(page); await key(page, '1');
    await openMore(page);
    await page.setInputFiles('#side [data-mk-file]', file(JSON.stringify(saved), 'a.json'));
    await page.waitForTimeout(150);
    assert.match(await page.textContent('#side .ev-confirm'), /ulagra endringar i «Årsplan DEMO-01»/);
    await page.click('#side [data-mk-act="nei"]');
    assert.equal((await overlay(page)).namn, 'Årsplan DEMO-01', 'Avbryt keeps what is open');
    await page.setInputFiles('#side [data-mk-file]', file(JSON.stringify(saved), 'a.json'));
    await page.waitForTimeout(150);
    await page.click('#side [data-mk-act="ja"]');
    assert.deepEqual((await overlay(page)).merke, saved.merke);
    assert.deepEqual(requests, [], 'no network');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('own scale, sets (rename, active, delete), files that are refused, and "Vis stort"', { skip }, async () => {
  const { page, errors, close } = await openMap(MAP, [], { init: NO_FS });
  try {
    await act(page, 'ny');
    await page.click('#side [data-mk-skala="eiga"]');
    await page.fill('#side [data-mk-eiga]', 'Ja');
    await act(page, 'lag');
    assert.match(await section(page), /2–6 verdiar/);
    assert.equal(await overlay(page), null);
    await page.fill('#side [data-mk-eiga]', 'Ja, Nei, Kanskje');
    await act(page, 'lag');
    const o = await overlay(page);
    assert.deepEqual(o.skala, ['ja', 'nei', 'kanskje']);
    assert.deepEqual(o.skala_namn, { ja: 'Ja', nei: 'Nei', kanskje: 'Kanskje' });
    // sets: two, rename the first, the active one follows, delete asks
    for (const s of ['A', 'B']) { await page.fill('#side [data-mk-settnamn]', s); await page.click('#side [data-mk-act="lag-sett"]'); }
    await page.fill('#side [data-mk-settnamn]', 'A');
    await page.click('#side [data-mk-act="lag-sett"]');
    assert.match(await section(page), /Det finst alt eit sett som heiter «A»/);
    await page.click('#side [data-mk-aktiv="A"]');
    await page.fill('#side [data-mk-settnamn-for="A"]', 'Sett A');
    await page.press('#side [data-mk-settnamn-for="A"]', 'Enter');
    await page.waitForTimeout(100);
    assert.equal(await page.getAttribute('#side [data-mk-aktiv="Sett A"]', 'aria-pressed'), 'true');
    await page.click('#side [data-mk-slett="B"]');
    await page.click('#side [data-mk-act="ja"]');
    assert.deepEqual((await overlay(page)).omraade.map((s) => s.namn), ['Sett A']);
    await page.click('#side [data-mk-aktiv="Sett A"]'); // off again
    assert.equal(await page.getAttribute('#side [data-mk-aktiv="Sett A"]', 'aria-pressed'), 'false');
    // refused files leave everything as it was
    await act(page, 'lagre'); // nothing unsaved, so the next files open without asking
    const before = await overlay(page);
    const tries = [
      ['{', /ikkje gyldig JSON/],
      [JSON.stringify({ ...JSON.parse(EKSAMEN), kart: 'S2' }), /laga for kartet «S2»/],
      [JSON.stringify({ ...JSON.parse(EKSAMEN), type: 'eigenvurdering' }), /type «eigenvurdering»/],
      [JSON.stringify({ ...JSON.parse(EKSAMEN), skala: ['a'] }), /2–6 ulike verdiar/],
    ];
    for (const [text, re] of tries) {
      await page.setInputFiles('#side [data-mk-file]', file(text));
      await page.waitForTimeout(120);
      assert.match(await section(page), re);
      assert.deepEqual(await overlay(page), before);
    }
    // values not in the scale are dropped and said; ids the map does not have are kept
    await page.setInputFiles('#side [data-mk-file]', file(JSON.stringify({ ...JSON.parse(EKSAMEN), merke: { [D('avvik')]: 'del3', 'DEMO-01/finst-ikkje': 'del1' } })));
    await page.waitForTimeout(120);
    assert.match(await section(page), /1 markering med ukjend verdi eller ID vart forkasta/);
    assert.deepEqual((await overlay(page)).merke, { 'DEMO-01/finst-ikkje': 'del1' });
    // "Vis stort": text and badges 25 % larger, and back
    await select(page, D('avvik')); await blur(page); await key(page, '1');
    await page.evaluate(() => window.__fk.goLevel('tema'));
    await page.waitForTimeout(400);
    const badgeSize = () => page.evaluate(() => window.__cy.nodes('.ghost[role^="pill-"][?area]').map((n) => n.data('fs0'))[0]);
    assert.equal(await badgeSize(), 13);
    const tekst = await page.evaluate(() => window.__fk.state.tekst);
    await openMore(page);
    await page.check('#side [data-mk-stort]');
    await page.waitForTimeout(200);
    await select(page, D('spreiing'));
    await key(page, '2'); // the checkbox has the focus: the keys still work
    assert.equal((await overlay(page)).merke[D('spreiing')], 'del2');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-mk-stort')), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '20px');
    assert.equal(await page.evaluate(() => window.__fk.state.tekst), 'stor');
    assert.equal(await badgeSize(), 16);
    await openMore(page);
    await page.uncheck('#side [data-mk-stort]');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-mk-stort')), false);
    assert.equal(await page.evaluate(() => window.__fk.state.tekst), tekst);
    assert.equal(await badgeSize(), 13);
    // the keys are listed in the section
    assert.match(await page.textContent('#side [data-mk-sub-tastar]'), /fjernar markeringa.*opnar notatet.*aktive settet/s);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

// Screenshots for the PR: the map with a set and the coverage table (not a check). Set SKJERMBILETE=1 to write them.
test('screenshots: the map with a set, the coverage table', { skip: skip || (!process.env.SKJERMBILETE && 'set SKJERMBILETE=1') }, async () => {
  const { page, close } = await openMap(MAP, [], { init: FS_MOCK });
  try {
    const out = path.join(viewerDir, 'skjermbilete', '15d');
    fs.mkdirSync(out, { recursive: true });
    const o = JSON.parse(EKSAMEN);
    // km01 well covered, km02 not at all ("ingen"), one node in two sets
    Object.assign(o.merke, { [D('spreiing')]: 'del1', [D('histogram')]: 'del2', [D('kvadrert-avvik')]: 'del1', [D('varians')]: 'uavklart', [D('kvifor-kvadrat')]: 'ikkje-eigna' });
    o.omraade[0].nodar.push(D('spreiing'), D('varians'));
    o.omraade.push({ namn: 'Sett B, våren 2028', nodar: [D('varians'), D('histogram')] });
    await page.evaluate((t) => { window.__fs.text = t; }, JSON.stringify(o));
    await act(page, 'opne');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__fk.goLevel('kart'));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, 'kart-med-sett.png') });
    await select(page, D('rekne-sd'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, 'nodekort.png') });
    await page.keyboard.press('Escape');
    await openMore(page);
    await page.evaluate(() => document.querySelector('#side [data-mk-sub-dekning]').scrollIntoView());
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, 'dekning.png') });
  } finally { await close(); }
});
