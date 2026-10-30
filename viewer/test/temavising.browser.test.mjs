// The tema view in the real page: one tema at a time, with the grey nodes of other temaa, and the way back to the zoom surface.
// Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openMap, skip, viewerDir } from './browser.mjs';
import { mainMap } from './kart.mjs';

const MAP = path.join('..', 'dist', `${mainMap}.json`); // nivaa 1 and 2, forkunnskap, 7 temaa
const hasMap = !!mainMap && fs.existsSync(path.join(viewerDir, MAP));
const opts = { skip: skip || (hasMap ? false : 'no dist/<map>.json') };
const wait = (page, ms) => page.waitForTimeout(ms);
// Wait for the state, not for the clock: the opening and leaving of a tema are over when the stage is back at full strength
// (no inline opacity), no Cytoscape animation runs, and the view is in the tema view (cid) or on the surface (null).
const settled = (page, cid) => page.waitForFunction((c) => {
  const fk = window.__fk;
  return fk.state.tema === c && document.getElementById('cy').style.opacity === '' && !window.__cy.animated();
}, cid, { timeout: 10000 });

const info = (page) => page.evaluate(() => {
  const cy = window.__cy, fk = window.__fk;
  const nodes = cy.nodes('[kind="node"]');
  return {
    tema: fk.state.tema, sel: fk.state.sel, km: fk.state.km, level: fk.KART.level,
    own: nodes.filter((n) => !n.data('grey')).map((n) => n.id()).sort(), grey: nodes.filter((n) => n.data('grey')).map((n) => n.id()).sort(),
    areas: cy.nodes('[kind="carea"]').length, frames: cy.nodes('[kind="tframe"]').length,
    edges: cy.edges().map((e) => ({ id: e.id(), source: e.data('source'), target: e.data('target'), type: e.data('type'), grey: !!e.data('greyedge'), hidden: e.hasClass('hide') })),
    pressed: [...document.querySelectorAll('#levelBtns button[aria-pressed="true"]')].map((b) => b.dataset.level),
    bar: !document.getElementById('temaBar').hidden, barName: document.getElementById('temaName').textContent, opacity: document.getElementById('cy').style.opacity,
  };
});
// A real click on an element of the map
async function click(page, id) {
  const pos = await page.evaluate((nid) => { const r = document.getElementById('cy').getBoundingClientRect(), p = window.__cy.getElementById(nid).renderedPosition(); return { x: r.left + p.x, y: r.top + p.y }; }, id);
  await page.mouse.click(pos.x, pos.y);
}
const open = async (page, cid) => { await page.evaluate((c) => window.__fk.openTema(c), cid); await settled(page, cid); };
// the temaa of the map in the order of the page; the forkunnskap tema is first
const temaer = (page) => page.evaluate(() => window.__fk.CLUSTERS.slice());

test('a click on a tema box opens the tema: only its nodes, the grey ones around it, and the arrows between them', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await click(page, 'a:' + cid);
    await settled(page, cid);
    const v = await info(page), data = await page.evaluate(() => JSON.parse(document.getElementById('fagkart-data').textContent));
    assert.equal(v.tema, cid);
    assert.equal(v.areas, 0, 'the surface is gone');
    assert.equal(v.frames, 1);
    assert.ok(v.bar && v.barName.length > 2 && v.opacity === '', 'the bar is there and the stage is back at full strength');
    assert.deepEqual(v.pressed, [], 'no level button is pressed in the tema view');
    // every node of the tema, level 1 and 2, and no other node of it
    const group = (n) => (n.forkunnskap ? 'forkunnskap' : n.klynge);
    const own = data.nodar.filter((n) => !n.utgaatt && n.type !== 'kompetansemaal' && group(n) === cid).map((n) => n.id).sort();
    assert.deepEqual(v.own, own);
    assert.ok(await page.evaluate(() => window.__cy.nodes('[kind="node"][lvl=2]').filter((n) => !n.data('grey')).length > 0), 'level 2 is in the view');
    // the grey ones are tied to the tema by an explicit byggjer_paa arrow, and nothing else is there
    const byId = new Map(data.nodar.map((n) => [n.id, n]));
    const ownSet = new Set(own), greySet = new Set(v.grey);
    assert.ok(v.grey.length > 0);
    for (const g of v.grey) assert.ok(!ownSet.has(g) && group(byId.get(g)) !== cid);
    for (const g of v.grey) assert.ok(data.kantar.some((k) => k.type === 'byggjer_paa' && !k.implisitt && ((k.fra === g && ownSet.has(k.til)) || (k.til === g && ownSet.has(k.fra)))), g + ' is tied to the tema');
    for (const e of v.edges) {
      assert.ok((ownSet.has(e.source) || greySet.has(e.source)) && (ownSet.has(e.target) || greySet.has(e.target)), `${e.id} ties nodes outside the view`);
      if (greySet.has(e.source) || greySet.has(e.target)) assert.ok(e.grey && e.type === 'byggjer_paa' && !(greySet.has(e.source) && greySet.has(e.target)), e.id + ' is a grey arrow');
    }
    assert.ok(v.edges.some((e) => e.grey) && v.edges.some((e) => !e.grey));
    // the grey nodes carry the name of their tema under them, and the frame has the colour of the tema
    const caps = await page.evaluate(() => window.__cy.nodes('.ghost[role="cap"]').length);
    assert.equal(caps, v.grey.length);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the tema view has the same colour as the box, and the grey nodes are quiet and small', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    const box = await page.evaluate((c) => window.__fk.temaColor(c), cid);
    await open(page, cid);
    const r = await page.evaluate(() => {
      const cy = window.__cy, hex = (s) => '#' + s.match(/\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('');
      const grey = cy.nodes('.grey')[0], own = cy.nodes('[kind="node"][lvl=1]').filter((n) => !n.data('grey'))[0];
      const fr = cy.nodes('[kind="tframe"]')[0];
      return { line: hex(fr.pstyle('border-color').strValue), greyW: grey.data('w0'), ownW: own.data('w0'), greyFont: grey.pstyle('font-size').pfValue, ownFont: own.pstyle('font-size').pfValue };
    });
    // the line of the frame is the colour of the tema in a paler shade: the same hue as the box
    const hue = (c) => { const [R, G, B] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255), mx = Math.max(R, G, B), d = mx - Math.min(R, G, B); return d === 0 ? 0 : (mx === R ? ((G - B) / d + 6) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4) * 60; };
    const gap = Math.abs(hue(r.line) - hue(box)) % 360;
    assert.ok(Math.min(gap, 360 - gap) < 8, `${r.line} against ${box}`);
    assert.ok(r.greyFont < r.ownFont && r.ownFont >= 14, JSON.stringify(r));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a click on a grey node opens the tema it belongs to, with the node chosen', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await open(page, cid);
    const g = await page.evaluate(() => { const n = window.__cy.nodes('.grey')[0]; return { id: n.id(), grp: n.data('grp') }; });
    await click(page, g.id);
    await wait(page, 800);
    const v = await info(page);
    assert.equal(v.tema, g.grp);
    assert.equal(v.sel, g.id);
    assert.ok(v.own.includes(g.id) && !v.grey.includes(g.id), 'the node is a big one now');
    assert.match(await page.textContent('#panel h2'), /\S/);
    assert.equal(await page.evaluate(() => document.getElementById('panel').classList.contains('open')), true);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('"Alle tema", Escape (when nothing is chosen) and the level buttons go back to the surface', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    const back = async (how, level) => {
      await open(page, cid);
      assert.equal((await info(page)).tema, cid);
      await how();
      await settled(page, null);
      const v = await info(page);
      assert.equal(v.tema, null);
      assert.ok(!v.bar && v.areas > 0 && v.frames === 0, JSON.stringify({ bar: v.bar, areas: v.areas }));
      assert.equal(v.level, level);
      assert.deepEqual(v.pressed, [level]);
    };
    await back(() => page.click('#temaBack'), 'tema');
    await back(() => page.keyboard.press('Escape'), 'tema');
    await back(() => page.click('#levelBtns button[data-level="tema"]'), 'tema');
    await back(() => page.click('#levelBtns button[data-level="kart"]'), 'kart');
    await back(() => page.click('#levelBtns button[data-level="detalj"]'), 'detalj');
    // the surface stands on the tema we came from: Kart and Detalj show it, not some other place
    await open(page, cid);
    await page.click('#levelBtns button[data-level="kart"]');
    await settled(page, null);
    const a = await page.evaluate((c) => { const p = window.__cy.getElementById('a:' + c).renderedPosition(); return { dx: p.x - window.__cy.width() / 2, dy: p.y - window.__cy.height() / 2 }; }, cid);
    assert.ok(Math.abs(a.dx) < 60 && Math.abs(a.dy) < 60, JSON.stringify(a));
    // Escape with a node chosen only lets go of the node; the second Escape leaves
    await open(page, cid);
    const own = (await info(page)).own[0];
    await page.evaluate((id) => window.__fk.select(id, { center: false }), own);
    await wait(page, 300);
    await page.keyboard.press('Escape');
    await wait(page, 300);
    let v = await info(page);
    assert.equal(v.tema, cid);
    assert.equal(v.sel, null);
    await page.keyboard.press('Escape');
    await settled(page, null);
    assert.equal((await info(page)).tema, null);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the name of a tema on the surface opens the tema, and so do the temaa in the cards', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await page.click('#levelBtns button[data-level="kart"]');
    await wait(page, 700);
    // the band at the top of an area, where its name is
    const band = await page.evaluate((c) => {
      const cy = window.__cy, a = window.__fk.LAYOUT.areas[c], r = document.getElementById('cy').getBoundingClientRect();
      const x = a.x, y = a.y - a.h / 2 + a.band / 2;
      cy.viewport({ zoom: window.__fk.Z.k, pan: { x: cy.width() / 2 - a.x * window.__fk.Z.k, y: cy.height() / 2 - a.y * window.__fk.Z.k } });
      const z = cy.zoom(), p = cy.pan();
      return { x: r.left + x * z + p.x, y: r.top + y * z + p.y };
    }, cid);
    await wait(page, 200);
    await page.mouse.click(band.x, band.y);
    await wait(page, 900);
    assert.equal((await info(page)).tema, cid);
    // a node card names its tema as a button; it opens that tema (here: another one, sideways)
    const other = (await temaer(page)).find((c) => c !== 'forkunnskap' && c !== cid);
    const node = await page.evaluate((c) => window.__cy.nodes('[kind="node"]').filter((n) => n.data('grey') && n.data('grp') === c)[0]?.id(), other);
    const pick = node || (await page.evaluate(() => window.__cy.nodes('.grey')[0].id()));
    await page.evaluate((id) => window.__fk.select(id, { center: false }), pick); // a grey node chosen by a link: its tema opens
    await wait(page, 900);
    const v = await info(page);
    assert.ok(v.tema && v.sel === pick && v.own.includes(pick));
    const pill = await page.$('#panel .linkpill');
    assert.ok(pill, 'the card names the tema of the node');
    assert.equal(await pill.textContent(), await page.evaluate(() => document.getElementById('temaName').textContent));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('search: a node of the tema is chosen where it is, a node outside it takes you back to the surface', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await open(page, cid);
    const names = await page.evaluate((c) => {
      const d = JSON.parse(document.getElementById('fagkart-data').textContent), g = (n) => (n.forkunnskap ? 'forkunnskap' : n.klynge);
      const pick = (f) => d.nodar.find((n) => !n.utgaatt && n.type !== 'kompetansemaal' && f(n));
      const a = pick((n) => g(n) === c), b = pick((n) => g(n) !== c && g(n) !== 'forkunnskap');
      return { a: a.id, an: window.__cy.getElementById(a.id).data('label').split('\n')[0], b: b.id, bn: b.namn };
    }, cid);
    await page.fill('#q', names.an);
    await page.keyboard.press('Enter');
    await wait(page, 600);
    let v = await info(page);
    assert.equal(v.tema, cid, 'a node of the tema: the tema stays');
    assert.equal(v.sel, names.a);
    await page.keyboard.press('Escape');
    await page.fill('#q', names.bn);
    await page.keyboard.press('Enter');
    await wait(page, 1300);
    v = await info(page);
    assert.equal(v.tema, null, 'a node outside the tema: the surface');
    assert.equal(v.sel, names.b);
    assert.ok(v.areas > 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the layers work in the tema view: 1P holes and badges, filter, implied arrows, a chosen node and a competence goal, the student view', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const fag = await page.evaluate(() => JSON.parse(document.getElementById('fagkart-data').textContent).forkunnskapsfag[0]);
    const cids = await temaer(page), cid = cids.find((c) => c !== 'forkunnskap');
    // the forkunnskap tema: holes of the subject
    await open(page, 'forkunnskap');
    await page.click('#moreBtn');
    await page.click(`#fagSeg button[data-fag="${fag}"]`);
    await page.click('#moreBtn');
    await wait(page, 300);
    const holes = await page.evaluate(() => ({ nei: window.__cy.nodes('.hole-nei').length, delvis: window.__cy.nodes('.hole-delvis').length, greyMarked: window.__cy.nodes('.grey.hole-nei, .grey.hole-delvis').length }));
    assert.ok(holes.nei + holes.delvis > 0, JSON.stringify(holes));
    // a normal tema: "nytt for" on the nodes, none on the grey ones
    await open(page, cid);
    const marks = await page.evaluate(() => {
      const cy = window.__cy, badge = (n) => cy.nodes(`.ghost[role^="pill-"]`).filter((g) => g.data('of') === n.id()).length;
      return { own: cy.nodes('[kind="node"]').filter((n) => !n.data('grey') && badge(n)).length, grey: cy.nodes('.grey').filter((n) => badge(n) || n.hasClass('hole-nei') || n.hasClass('hole-delvis')).length };
    });
    assert.ok(marks.own > 0 && marks.grey === 0, JSON.stringify(marks));
    await page.click('#moreBtn');
    await page.click('#fagSeg button[data-fag="alle"]');
    // filter: what does not match is faded, the grey ones are not
    await page.evaluate(() => { for (const d of document.querySelectorAll('#side details.sec')) d.open = true; });
    await page.locator('#chType .chip').first().click();
    await wait(page, 300);
    const f = await page.evaluate(() => ({ faded: window.__cy.nodes('.fl').length, greyFaded: window.__cy.nodes('.grey.fl').length, opacity: window.__cy.nodes('.fl')[0] && window.__cy.nodes('.fl')[0].pstyle('opacity').value }));
    assert.equal(f.greyFaded, 0);
    if (f.faded) assert.ok(f.opacity < 0.3, JSON.stringify(f));
    await page.locator('#clearFilters').click();
    // implied arrows and the other arrows (not byggjer på): hidden until their switches are on
    const count = () => page.evaluate(() => window.__cy.edges().filter((e) => !e.hasClass('hide')).length);
    const total = await page.evaluate(() => window.__cy.edges().length), shown = await count();
    assert.equal(await page.evaluate(() => window.__cy.edges('[?impl]').filter((e) => !e.hasClass('hide')).length), 0);
    assert.equal(await page.evaluate(() => window.__cy.edges('[type!="byggjer_paa"]').filter((e) => !e.hasClass('hide')).length), 0);
    if (total > shown) {
      for (const sw of ['#swImpl', '#swKopl']) await page.locator(`.switch:has(${sw})`).click();
      await wait(page, 200);
      assert.equal(await count(), total);
      for (const sw of ['#swImpl', '#swKopl']) await page.locator(`.switch:has(${sw})`).click();
    }
    await page.click('#moreBtn');
    // the student view keeps the tema; a chosen node shows its arrows and dims the rest
    await page.click('#modeSeg button[data-mode="elev"]');
    const own = (await info(page)).own[0];
    await page.evaluate((id) => window.__fk.select(id, { center: false }), own);
    await wait(page, 400);
    const sel = await page.evaluate(() => ({ nbr: window.__cy.edges('.nbr').length, dim: window.__cy.nodes('[kind="node"]').filter((n) => n.hasClass('dim')).length, tema: window.__fk.state.tema }));
    assert.ok(sel.nbr > 0 && sel.dim > 0 && sel.tema === cid, JSON.stringify(sel));
    await page.click('#modeSeg button[data-mode="laerar"]');
    // a competence goal of the tema: its nodes are lit, the rest dims, the view stays; a goal outside it takes you to the surface
    await page.keyboard.press('Escape');
    const goals = await page.evaluate((c) => [...document.querySelectorAll('#temaGoals .kmchip')].map((b) => b.textContent), cid);
    assert.ok(goals.length > 0, 'the goals of the tema are in the bar');
    await page.locator('#temaGoals .kmchip').first().click();
    await wait(page, 300);
    const km = await page.evaluate(() => ({ km: window.__fk.state.km, tema: window.__fk.state.tema, lit: window.__cy.nodes('[kind="node"]').filter((n) => !n.hasClass('dim') && !n.data('grey')).length, pressed: document.querySelector('#temaGoals .kmchip[aria-pressed="true"]') !== null }));
    assert.ok(km.km && km.tema === cid && km.lit > 0 && km.pressed, JSON.stringify(km));
    await page.locator('#temaGoals .kmchip').first().click(); // pressed again: let go
    await wait(page, 200);
    assert.equal(await page.evaluate(() => window.__fk.state.km), null);
    const foreign = await page.evaluate((c) => { const d = JSON.parse(document.getElementById('fagkart-data').textContent); const covered = new Set(d.nodar.filter((n) => !n.utgaatt && n.klynge === c).flatMap((n) => n.km || [])); return d.nodar.find((n) => n.type === 'kompetansemaal' && !covered.has(n.id)).id; }, cid);
    await page.evaluate((id) => window.__fk.select(id), foreign);
    await wait(page, 1200);
    const out = await info(page);
    assert.equal(out.tema, null);
    assert.equal(out.km, foreign);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('ctx.tema: a layer sees which tema is open, or null on the surface', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    await page.evaluate(() => {
      window.__seen = [];
      window.fagkart.registerLayer({
        id: 'probe', label: 'Probe', priority: 'markering',
        nodeStyle: (n, ctx, el) => { window.__seen.push([ctx.tema, el.grey, ctx.level]); return null; },
        status: (ctx) => (ctx.tema ? 'tema ' + ctx.tema : null),
      });
    });
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    assert.equal(await page.evaluate(() => window.__seen.every(([t, g]) => t === null && g === false)), true);
    await open(page, cid);
    await page.evaluate(() => { window.__seen = []; window.__fk.state.q = ''; });
    await page.evaluate(() => window.__fk.select(window.__cy.nodes('[kind="node"]').filter((n) => !n.data('grey'))[0].id(), { center: false }));
    const seen = await page.evaluate(() => window.__seen);
    assert.ok(seen.length > 0 && seen.every(([t]) => t === cid), 'every call sees the tema');
    assert.ok(seen.some(([, g]) => g === true) && seen.some(([, g]) => g === false), 'the grey nodes are told apart');
    assert.ok(seen.every(([, , l]) => l === 'detalj'), 'level 1 and 2 are both in the view');
    assert.match(await page.textContent('#stView'), new RegExp('tema ' + cid));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await wait(page, 900);
    await page.evaluate(() => { window.__seen = []; window.__fk.select(window.__cy.nodes('[kind="node"]')[0].id(), { center: false }); });
    assert.equal(await page.evaluate(() => window.__seen.every(([t]) => t === null)), true);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('prefers-reduced-motion: the tema view opens and closes at once, without a fade', opts, async () => {
  const { page, errors, close } = await openMap(MAP, [], { reducedMotion: 'reduce' });
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await page.evaluate((c) => window.__fk.openTema(c), cid);
    await wait(page, 60);
    let v = await info(page);
    assert.equal(v.tema, cid);
    assert.equal(v.opacity, '');
    await page.evaluate(() => window.__fk.leaveTema());
    await wait(page, 60);
    v = await info(page);
    assert.equal(v.tema, null);
    assert.equal(v.opacity, '');
    assert.ok(v.areas > 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the forkunnskap switch in the tema view: the grey forkunnskap nodes go, and the forkunnskap tema itself closes', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await open(page, cid);
    const before = await info(page);
    assert.ok(await page.evaluate(() => window.__cy.nodes('.grey[?fk]').length) > 0, 'forkunnskap nodes are around the tema');
    await page.evaluate(() => window.__fk.setShowFk(false));
    await wait(page, 500);
    const off = await info(page);
    assert.equal(off.tema, cid);
    assert.ok(off.grey.length < before.grey.length && !(await page.evaluate(() => window.__cy.nodes('[?fk]').length)));
    await page.evaluate(() => window.__fk.setShowFk(true));
    await wait(page, 500);
    assert.deepEqual((await info(page)).grey, before.grey, 'on again: the same view');
    await open(page, 'forkunnskap');
    await page.evaluate(() => window.__fk.setShowFk(false));
    await wait(page, 700);
    const v = await info(page);
    assert.equal(v.tema, null);
    assert.ok(v.areas > 0);
    await page.evaluate(() => window.__fk.setShowFk(true)); // leave the stored choice as it was
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('on a phone held upright: the same view, the whole tema in reach, nothing wider than the screen', opts, async () => {
  const { page, errors, close } = await openMap(MAP, [], { viewport: { width: 390, height: 844 } });
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await open(page, cid);
    const v = await info(page);
    assert.equal(v.tema, cid);
    assert.ok(v.bar && v.grey.length > 0);
    const r = await page.evaluate(() => {
      const L = window.__fk.temaLayout(window.__fk.state.tema), first = Object.values(L.nodes).filter((n) => n.role === 'own').sort((a, b) => a.y - b.y)[0];
      return { overflow: document.documentElement.scrollWidth > window.innerWidth, upright: (L.bounds.y2 - L.bounds.y1) > (L.bounds.x2 - L.bounds.x1) * 0.9, z: window.__cy.zoom(), firstY: first.y };
    });
    assert.ok(!r.overflow && r.upright && r.z >= 0.3, JSON.stringify(r));
    // the layout is the upright one: prerequisites at the top
    const dir = await page.evaluate(() => { const L = window.__fk.temaLayout(window.__fk.state.tema); const g = Object.values(L.nodes).filter((n) => n.role === 'before'), o = Object.values(L.nodes).filter((n) => n.role === 'own'); return g.length ? Math.max(...g.map((n) => n.y)) < Math.min(...o.map((n) => n.y)) : true; });
    assert.ok(dir, 'what the tema builds on is above it');
    await page.click('#temaBack');
    await wait(page, 900);
    assert.equal((await info(page)).tema, null);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('dark mode: the frame, the grey nodes and the bar follow the colours of the page', opts, async () => {
  const { page, errors, close } = await openMap(MAP, [], { colorScheme: 'dark' });
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await open(page, cid);
    const c = await page.evaluate(() => {
      const lum = (s) => { const [r, g, b] = s.match(/[\d.]+/g).map(Number), k = s.startsWith('color(') ? 1 : 255; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / k; }; // rgb(...) or color(srgb ...)
      const cy = window.__cy;
      return { frame: lum(cy.nodes('[kind="tframe"]')[0].pstyle('background-color').strValue), grey: lum(cy.nodes('.grey')[0].pstyle('background-color').strValue), bar: lum(getComputedStyle(document.getElementById('temaBar')).backgroundColor) };
    });
    assert.ok(c.frame < 0.5 && c.grey < 0.5 && c.bar < 0.5, JSON.stringify(c));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the tema view speaks of omgrep, metodar, temaa and piler, not of nodes, edges and graphs', opts, async () => {
  const { page, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await open(page, cid);
    await page.click('#helpBtn');
    const text = await page.evaluate(() => {
      const attrs = [...document.querySelectorAll('#temaBar [title],#temaBar [aria-label],#temaBar,[id=helpBox]')].flatMap((e) => ['title', 'aria-label'].map((a) => e.getAttribute(a)).filter(Boolean));
      return document.getElementById('temaBar').innerText + '\n' + document.getElementById('hint').textContent + '\n' + attrs.join('\n');
    });
    assert.match(text, /Alle tema/);
    assert.deepEqual(text.match(/\b(nodar?|nodane|nodes?|kantar?|kantane|klynge|klyngjer|klynga|graf)\b/gi) || [], []);
  } finally { await close(); }
});

test('the poster is made from the zoom surface, also while a tema is open, and the tema comes back after printing', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await open(page, cid);
    assert.equal(await page.evaluate(() => window.__fk.preparePoster()), true);
    assert.equal((await info(page)).tema, null);
    assert.match(await page.evaluate(() => document.getElementById('posterImg').src), /^data:image\/png/);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await wait(page, 900);
    assert.equal((await info(page)).tema, cid);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a map without nivaa (all nodes level 1) has the tema view too', { skip }, async () => {
  const { page, errors, close } = await openMap('fixtures/DEMO-01.json');
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await open(page, cid);
    const v = await info(page);
    assert.equal(v.tema, cid);
    assert.ok(v.own.length > 1 && v.edges.length > 0);
    assert.ok(await page.evaluate(() => window.__cy.nodes('[kind="node"]').every((n) => n.data('lvl') === 1)));
    await page.keyboard.press('Escape');
    await wait(page, 900);
    assert.equal((await info(page)).tema, null);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a level button pressed while a tema is opening cancels the opening', opts, async () => {
  const { page, errors, close } = await openMap(MAP);
  try {
    const cid = (await temaer(page)).find((c) => c !== 'forkunnskap');
    await page.evaluate((c) => window.__fk.openTema(c), cid);
    await wait(page, 30);
    await page.click('#levelBtns button[data-level="kart"]');
    await wait(page, 1000);
    const v = await info(page);
    assert.equal(v.tema, null);
    assert.equal(v.level, 'kart');
    assert.equal(v.opacity, '');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
