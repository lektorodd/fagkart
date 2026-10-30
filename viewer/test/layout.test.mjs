// Tests for the build-time layout of the Kart view. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeLayout, computeLayouts, nodeSize, PORTRAIT_ASPECT } from '../layout.mjs';
import { textWidth, wrap } from '../metrics.mjs';
import { realMaps } from './kart.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', '..', 'dist');

const rect = (p) => ({ x1: p.x - p.w / 2, y1: p.y - p.h / 2, x2: p.x + p.w / 2, y2: p.y + p.h / 2 });
const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const inside = (r, a) => r.x1 >= a.x - a.w / 2 - 0.5 && r.x2 <= a.x + a.w / 2 + 0.5 && r.y1 >= a.y - a.h / 2 - 0.5 && r.y2 <= a.y + a.h / 2 + 0.5;

// A small invented map: klynge "forkunnskap", "a" and "b" (the project), level 1 and 2 nodes.
function tiny() {
  const mk = (id, klynge, nivaa, extra = {}) => ({ id: 'T/' + id, type: 'omgrep', namn: id.replace(/-/g, ' '), klynge, nivaa, ...extra });
  const nodar = [
    mk('tal', 'forkunnskap', 1, { forkunnskap: { '1P': 'ja' } }),
    mk('brok', 'forkunnskap', 2, { forkunnskap: { '1P': 'ja' } }),
    mk('mengde', 'a', 1), mk('snitt', 'a', 1), mk('union', 'a', 1), mk('venndiagram', 'a', 2), mk('krysstabell', 'a', 2), mk('regel-for-snitt', 'a', 2),
    mk('prosjekt', 'b', 1), mk('planlegge', 'b', 2),
  ];
  const E = (fra, til, type = 'byggjer_paa') => ({ fra: 'T/' + fra, til: 'T/' + til, type });
  return {
    format: 'fagkart/1', laereplan: 'T-01', namn: 'Test', klyngjer: [{ id: 'a', namn: 'A' }, { id: 'b', namn: 'B' }, { id: 'forkunnskap', namn: 'Forkunnskap' }],
    nodar,
    kantar: [E('mengde', 'tal'), E('snitt', 'mengde'), E('union', 'mengde'), E('venndiagram', 'snitt'), E('krysstabell', 'snitt'), E('regel-for-snitt', 'venndiagram'), E('prosjekt', 'snitt'), E('planlegge', 'prosjekt'), E('tal', 'brok')],
    oversiktskantar: [E('mengde', 'tal'), E('snitt', 'mengde'), E('union', 'mengde'), E('prosjekt', 'snitt'), E('union', 'snitt', 'forvekslast_med')],
  };
}

test('wrap breaks at the width and measures the widest line', () => {
  const m = wrap('Betinga sannsyn og uavhengnad', 14, 100);
  assert.ok(m.lines.length >= 2);
  for (const l of m.lines) assert.ok(textWidth(l, 14) <= 100 || !l.includes(' '), l);
  assert.equal(m.w, Math.ceil(Math.max(...m.lines.map((l) => textWidth(l, 14)))));
  assert.ok(textWidth('Æ ø å', 14) > 0);
  assert.ok(textWidth('abc', 28) > textWidth('abc', 14) * 1.99);
});

test('level 2 nodes are smaller than level 1 nodes with the same name', () => {
  const a = nodeSize('Standardavvik for eit datasett', 1), b = nodeSize('Standardavvik for eit datasett', 2);
  assert.ok(b.w * b.h < a.w * a.h);
});

test('layout of a small map: every node is placed, nothing overlaps, satellites stay in their area', async () => {
  const d = tiny();
  const L = await computeLayout(d);
  assert.deepEqual(L.problems, []);
  assert.equal(Object.keys(L.nodes).length, d.nodar.length);
  const ids = Object.keys(L.nodes);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(!hit(rect(L.nodes[ids[i]]), rect(L.nodes[ids[j]])), `${ids[i]} / ${ids[j]}`);
  for (const n of d.nodar) assert.ok(inside(rect(L.nodes[n.id]), L.areas[n.klynge]), n.id + ' is outside ' + n.klynge);
  const cl = Object.keys(L.areas);
  for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) assert.ok(!hit(rect(L.areas[cl[i]]), rect(L.areas[cl[j]])), `${cl[i]} / ${cl[j]}`);
});

test('forkunnskap is the leftmost klynge and the project the rightmost', async () => {
  const L = await computeLayout(tiny());
  const x = (c) => L.areas[c].x;
  assert.ok(x('forkunnskap') < x('a') && x('a') < x('b'), JSON.stringify(Object.fromEntries(Object.keys(L.areas).map((c) => [c, x(c)]))));
});

test('a satellite is placed near its anchor, the level 1 node that builds on it or that it builds on', async () => {
  const L = await computeLayout(tiny());
  const d = (a, b) => Math.hypot(L.nodes[a].x - L.nodes[b].x, L.nodes[a].y - L.nodes[b].y);
  assert.ok(d('T/venndiagram', 'T/snitt') < 120, 'venndiagram builds on snitt');
  assert.ok(d('T/krysstabell', 'T/snitt') < 120, 'krysstabell builds on snitt');
  assert.ok(d('T/planlegge', 'T/prosjekt') < 120, 'planlegge builds on prosjekt');
  assert.ok(d('T/brok', 'T/tal') < 120, 'tal builds on brok');
});

test('the layout is the same every time', async () => {
  const a = JSON.stringify(await computeLayout(tiny())), b = JSON.stringify(await computeLayout(tiny()));
  assert.equal(a, b);
});

test('a node with pos keeps its position, the others still do not overlap each other', async () => {
  const d = tiny();
  d.nodar.find((n) => n.id === 'T/snitt').pos = { x: 5000, y: -300 };
  d.nodar.find((n) => n.id === 'T/krysstabell').pos = { x: -2000, y: 40 };
  const L = await computeLayout(d);
  assert.deepEqual([L.nodes['T/snitt'].x, L.nodes['T/snitt'].y], [5000, -300]);
  assert.deepEqual([L.nodes['T/krysstabell'].x, L.nodes['T/krysstabell'].y], [-2000, 40]);
  assert.ok(inside(rect(L.nodes['T/snitt']), L.areas.a), 'the area grows to hold a node placed by hand');
});

for (const code of realMaps) test(`${code}: the real map lays out without problems`, async (t) => {
  const f = path.join(dist, code + '.json');
  if (!fs.existsSync(f)) return t.skip(`dist/${code}.json is missing (run scripts/bygg.py)`);
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const L = await computeLayout(d);
  assert.deepEqual(L.problems, []);
  const nodes = d.nodar.filter((n) => n.type !== 'kompetansemaal');
  assert.equal(Object.keys(L.nodes).length, nodes.length);
  for (const n of nodes) assert.ok(inside(rect(L.nodes[n.id]), L.areas[n.forkunnskap ? 'forkunnskap' : n.klynge]), n.id);
  const xs = Object.entries(L.areas).map(([c, a]) => [c, a.x]).sort((p, q) => p[1] - q[1]);
  assert.equal(xs[0][0], 'forkunnskap', 'forkunnskap first from the left');
  if (L.areas.prosjekt) assert.equal(L.areas.prosjekt.x + L.areas.prosjekt.w / 2, Math.max(...Object.values(L.areas).map((a) => a.x + a.w / 2)), 'the project reaches furthest right');
  // prerequisites to the left: no overview edge between klynger goes from a klynge in a later column back to an earlier one
  const col = new Map(); L.cols.forEach((c, i) => c.forEach((k) => col.set(k, i)));
  const by = new Map(d.nodar.map((n) => [n.id, n]));
  const grp = (id) => (by.get(id).forkunnskap ? 'forkunnskap' : by.get(id).klynge);
  for (const e of d.oversiktskantar) {
    if (e.type !== 'byggjer_paa' || grp(e.fra) === grp(e.til)) continue;
    assert.ok(col.get(grp(e.til)) <= col.get(grp(e.fra)), `${grp(e.fra)} builds on ${grp(e.til)}, which must not be to its right`);
  }
  const W = L.bounds.x2 - L.bounds.x1, H = L.bounds.y2 - L.bounds.y1;
  assert.ok(W / H > 1.3 && W / H < 2.2, `the map is wider than tall (${Math.round(W)} x ${Math.round(H)})`);
  assert.equal(JSON.stringify(await computeLayout(d)), JSON.stringify(L), 'same result twice');
});

// ---- the second layout: the same map without the forkunnskap cluster ("Vis forkunnskapar" off) ----
const isFk = (n) => !!n.forkunnskap;
const real = (d) => d.nodar.filter((n) => !n.utgaatt && n.type !== 'kompetansemaal');
const noOverlap = (L) => {
  const ids = Object.keys(L.nodes);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(!hit(rect(L.nodes[ids[i]]), rect(L.nodes[ids[j]])), `${ids[i]} / ${ids[j]}`);
  const cl = Object.keys(L.areas);
  for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) assert.ok(!hit(rect(L.areas[cl[i]]), rect(L.areas[cl[j]])), `${cl[i]} / ${cl[j]}`);
};

test('without forkunnskap: no forkunnskap node, no forkunnskap area, nothing overlaps, everything inside its area', async () => {
  const d = tiny();
  const L = await computeLayout(d, { withoutForkunnskap: true });
  assert.deepEqual(L.problems, []);
  const keep = d.nodar.filter((n) => !isFk(n));
  assert.deepEqual(Object.keys(L.nodes).sort(), keep.map((n) => n.id).sort());
  for (const n of d.nodar.filter(isFk)) assert.ok(!(n.id in L.nodes), n.id + ' must not be in the layout');
  assert.ok(!('forkunnskap' in L.areas) && !L.cols.flat().includes('forkunnskap') && !L.order.includes('forkunnskap'));
  noOverlap(L);
  for (const n of keep) assert.ok(inside(rect(L.nodes[n.id]), L.areas[n.klynge]), n.id + ' is outside ' + n.klynge);
  const full = await computeLayout(d);
  assert.ok(L.bounds.x2 - L.bounds.x1 < full.bounds.x2 - full.bounds.x1, 'the map is narrower without the forkunnskap column');
});

test('without forkunnskap: the layout is the same every time, and the full layout is not changed by it', async () => {
  const a = JSON.stringify(await computeLayout(tiny(), { withoutForkunnskap: true })), b = JSON.stringify(await computeLayout(tiny(), { withoutForkunnskap: true }));
  assert.equal(a, b);
  assert.equal(JSON.stringify(await computeLayout(tiny())), JSON.stringify(await computeLayout(tiny(), {})), 'no option = the old layout');
});

test('a node with pos keeps its position in both layouts', async () => {
  const d = tiny();
  d.nodar.find((n) => n.id === 'T/snitt').pos = { x: 5000, y: -300 };
  d.nodar.find((n) => n.id === 'T/brok').pos = { x: -900, y: 20 }; // a forkunnskap node: only in the full layout
  const { utanForkunnskap: utan, ...full } = await computeLayouts(d);
  assert.deepEqual([full.nodes['T/snitt'].x, full.nodes['T/snitt'].y], [5000, -300]);
  assert.deepEqual([utan.nodes['T/snitt'].x, utan.nodes['T/snitt'].y], [5000, -300]);
  assert.deepEqual([full.nodes['T/brok'].x, full.nodes['T/brok'].y], [-900, 20]);
  assert.ok(!('T/brok' in utan.nodes));
  assert.ok(inside(rect(utan.nodes['T/snitt']), utan.areas.a), 'the area grows to hold a node placed by hand');
});

test('computeLayouts: full layout plus utanForkunnskap; null when the map has no forkunnskap', async () => {
  const d = tiny();
  const { utanForkunnskap, smal, ...full } = await computeLayouts(d);
  assert.equal(JSON.stringify(full), JSON.stringify(await computeLayout(d)));
  assert.equal(JSON.stringify(utanForkunnskap), JSON.stringify(await computeLayout(d, { withoutForkunnskap: true })));
  // the pair for a tall stage (a phone held upright): the same map packed for another shape
  const tall = (x) => (x.bounds.x2 - x.bounds.x1) / (x.bounds.y2 - x.bounds.y1);
  assert.equal(JSON.stringify(smal.utanForkunnskap), JSON.stringify(await computeLayout(d, { aspect: PORTRAIT_ASPECT, withoutForkunnskap: true })));
  assert.ok(tall(smal) < tall(full), `${tall(smal).toFixed(2)} is not taller than ${tall(full).toFixed(2)}`);
  const plain = tiny();
  plain.nodar = plain.nodar.filter((n) => !isFk(n));
  plain.kantar = plain.kantar.filter((k) => plain.nodar.some((n) => n.id === k.fra) && plain.nodar.some((n) => n.id === k.til));
  plain.oversiktskantar = plain.oversiktskantar.filter((k) => plain.nodar.some((n) => n.id === k.fra) && plain.nodar.some((n) => n.id === k.til));
  assert.equal((await computeLayouts(plain)).utanForkunnskap, null);
});

for (const code of realMaps) {
  test(`${code}: the layout without forkunnskap is clean, deterministic and no wider or taller than the full one`, async (t) => {
    const f = path.join(dist, code + '.json');
    if (!fs.existsSync(f)) return t.skip(`dist/${code}.json is missing (run scripts/bygg.py)`);
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const full = await computeLayout(d);
    const L = await computeLayout(d, { withoutForkunnskap: true });
    assert.deepEqual(L.problems, []);
    const keep = real(d).filter((n) => !isFk(n));
    assert.deepEqual(Object.keys(L.nodes).sort(), keep.map((n) => n.id).sort(), 'every node but the forkunnskap ones');
    assert.ok(!Object.keys(L.nodes).some((id) => isFk(d.nodar.find((n) => n.id === id))));
    assert.ok(!('forkunnskap' in L.areas));
    noOverlap(L);
    for (const n of keep) if (!n.pos) assert.ok(inside(rect(L.nodes[n.id]), L.areas[n.klynge]), n.id);
    // no looser than the full one, by the measure the packing minimises (the longer of the width and the height times the shape of the stage)
    const W = (x) => x.bounds.x2 - x.bounds.x1, H = (x) => x.bounds.y2 - x.bounds.y1, loose = (x) => Math.max(W(x), H(x) * 1.75);
    assert.ok(loose(L) <= loose(full) + 1, `${Math.round(W(L))} x ${Math.round(H(L))} against ${Math.round(W(full))} x ${Math.round(H(full))}`);
    // the same rules: prerequisites to the left, the project reaches furthest right
    const col = new Map(); L.cols.forEach((c, i) => c.forEach((k) => col.set(k, i)));
    const by = new Map(d.nodar.map((n) => [n.id, n]));
    const grp = (id) => (by.get(id).forkunnskap ? 'forkunnskap' : by.get(id).klynge);
    for (const e of d.oversiktskantar) {
      if (e.type !== 'byggjer_paa' || grp(e.fra) === grp(e.til) || !col.has(grp(e.fra)) || !col.has(grp(e.til))) continue;
      assert.ok(col.get(grp(e.til)) <= col.get(grp(e.fra)), `${grp(e.fra)} builds on ${grp(e.til)}, which must not be to its right`);
    }
    assert.equal(JSON.stringify(await computeLayout(d, { withoutForkunnskap: true })), JSON.stringify(L), 'same result twice');
  });
}

test('the build: every map gets both layouts; a map without nivaa gets a flat layout', (t) => {
  if (!realMaps.length) return t.skip('dist/*.json missing');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-build-'));
  try {
    // a copy of a real map as it was before it had nivaa: laid out flat
    const bare = JSON.parse(fs.readFileSync(path.join(dist, realMaps[0] + '.json'), 'utf8'));
    bare.laereplan = 'BARE-01';
    for (const n of bare.nodar) delete n.nivaa;
    delete bare.oversiktskantar;
    fs.writeFileSync(path.join(tmp, 'BARE-01.json'), JSON.stringify(bare));
    execFileSync('node', [path.join(here, '..', 'build.mjs'), `--out=${tmp}`, ...realMaps.map((c) => path.join(dist, c + '.json')), path.join(tmp, 'BARE-01.json')], { stdio: 'pipe' });
    const html = (code) => fs.readFileSync(path.join(tmp, code + '.html'), 'utf8');
    const lay = (code) => html(code).match(/id="fagkart-layout">([\s\S]*?)<\/script>/)[1];
    const flat = JSON.parse(lay('BARE-01'));
    assert.equal(Object.keys(flat.nodes).length, bare.nodar.filter((n) => n.type !== 'kompetansemaal').length);
    assert.ok(Object.values(flat.nodes).every((p) => p.l === 1));
    for (const code of realMaps) {
      const m = JSON.parse(lay(code));
      assert.equal(m.version, 2);
      assert.ok(Object.keys(m.nodes).length > 90);
      assert.ok(m.utanForkunnskap && !('forkunnskap' in m.utanForkunnskap.areas), code + ' carries the layout without forkunnskap');
      assert.ok(Object.keys(m.utanForkunnskap.nodes).length < Object.keys(m.nodes).length);
      assert.match(html(code), /id="swFk"/, 'the switch is in the page');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a map without nivaa is laid out flat: every node level 1, positioned by its byggjer_paa edges', async () => {
  const demo = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'DEMO-01.json'), 'utf8'));
  const L = await computeLayout(demo);
  const placed = demo.nodar.filter((n) => !n.utgaatt && n.type !== 'kompetansemaal');
  assert.equal(L.problems.length, 0, L.problems.join('; '));
  assert.equal(Object.keys(L.nodes).length, placed.length);
  assert.ok(Object.values(L.nodes).every((p) => p.l === 1));
  for (const n of placed) {
    const p = L.nodes[n.id], a = L.areas[n.forkunnskap ? 'forkunnskap' : n.klynge];
    assert.ok(a && inside(rect(p), a), n.id);
  }
});
