// Tests for the tema view without a browser: which nodes and arrows it holds (temaMembers) and its build-time layout (temalayout.mjs).
// Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { temaMembers } from '../src/kartkantar.js';
import { computeTemaLayouts, greySize, ownSize } from '../temalayout.mjs';
import { PORTRAIT_ASPECT } from '../layout.mjs';
import { realMaps } from './kart.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', '..', 'dist');

// A small invented map: the tema "a" builds on the forkunnskap node tal and on x of tema "c"; the project "b" builds on it; "c" only ties to "a" through x.
function tiny() {
  const mk = (id, klynge, nivaa, extra = {}) => ({ id: 'T/' + id, type: 'omgrep', namn: id.replace(/-/g, ' '), klynge, nivaa, ...extra });
  const E = (fra, til, type = 'byggjer_paa', extra = {}) => ({ fra: 'T/' + fra, til: 'T/' + til, type, ...extra });
  return {
    format: 'fagkart/1', laereplan: 'T-01', namn: 'Test', klyngjer: [{ id: 'a', namn: 'Mengder' }, { id: 'b', namn: 'Prosjekt' }, { id: 'c', namn: 'Tema med eit mykje lenger namn enn dei andre' }, { id: 'forkunnskap', namn: 'Forkunnskap' }],
    nodar: [
      mk('tal', 'forkunnskap', 1, { forkunnskap: { '1P': 'ja' } }), mk('brok', 'forkunnskap', 2, { forkunnskap: { '1P': 'ja' } }),
      mk('mengde', 'a', 1), mk('snitt', 'a', 1), mk('union', 'a', 1), mk('venndiagram', 'a', 2), mk('krysstabell', 'a', 2),
      mk('x', 'c', 1), mk('y', 'c', 1), mk('prosjekt', 'b', 1), mk('planlegge', 'b', 2), mk('gammal', 'a', 1, { utgaatt: true }),
      { id: 'T/km1', type: 'kompetansemaal', namn: 'km1', tekst: 'Eit mål', klynge: 'a' },
    ],
    kantar: [
      E('mengde', 'tal'), E('snitt', 'mengde'), E('union', 'mengde'), E('venndiagram', 'snitt'), E('krysstabell', 'snitt'), E('prosjekt', 'snitt'), E('planlegge', 'prosjekt'),
      E('tal', 'brok'), E('snitt', 'x'), E('x', 'y'), E('union', 'tal', 'byggjer_paa', { implisitt: true }), E('union', 'snitt', 'forvekslast_med'),
      E('venndiagram', 'prosjekt', 'brukar'), E('mengde', 'km1', 'dekkjer'), E('snitt', 'gammal'), E('prosjekt', 'y', 'brukar'),
    ],
    oversiktskantar: [E('mengde', 'tal'), E('snitt', 'mengde')],
  };
}

test('temaMembers: the nodes of the tema, the grey ones on the side they belong to, and only the arrows of the view', () => {
  const d = tiny(), M = temaMembers(d, 'a');
  assert.deepEqual(M.own.sort(), ['T/krysstabell', 'T/mengde', 'T/snitt', 'T/union', 'T/venndiagram']);
  assert.deepEqual(M.before.sort(), ['T/tal', 'T/x'], 'what the tema builds on');
  assert.deepEqual(M.after, ['T/prosjekt'], 'what builds on the tema');
  // arrow ids are positions among the arrows between nodes that exist (the outdated node is left out), the same ids as on the surface
  const want = { e0: true, e1: false, e2: false, e3: false, e4: false, e5: true, e8: true, e10: true, e11: false };
  assert.deepEqual(Object.fromEntries(M.edges.map((e) => [e.key, e.grey])), want,
    'no arrow to a competence goal or an outdated node, none between two grey nodes, none from a grey node by another kind than byggjer_paa (the implied one counts)');
  assert.equal(d.kantar[10].implisitt, true);
});

test('temaMembers: an implied arrow alone does not make a node grey, and forkunnskap goes away with the switch', () => {
  const d = tiny();
  d.kantar = d.kantar.filter((k) => !(k.fra === 'T/mengde' && k.til === 'T/tal')); // tal is now tied to a only by the implied arrow union > tal
  assert.ok(!temaMembers(d, 'a').before.includes('T/tal'));
  const full = temaMembers(tiny(), 'a'), noFk = temaMembers(tiny(), 'a', { withoutForkunnskap: true });
  assert.ok(full.before.includes('T/tal') && !noFk.before.includes('T/tal'));
  assert.deepEqual(temaMembers(tiny(), 'forkunnskap', { withoutForkunnskap: true }).own, [], 'the forkunnskap tema does not exist without forkunnskap');
  // a node on both sides goes to the one where it has more arrows
  const e = tiny();
  e.kantar.push({ fra: 'T/prosjekt', til: 'T/mengde', type: 'byggjer_paa' }, { fra: 'T/union', til: 'T/prosjekt', type: 'byggjer_paa' }, { fra: 'T/krysstabell', til: 'T/prosjekt', type: 'byggjer_paa' });
  const both = temaMembers(e, 'a');
  assert.ok(both.before.includes('T/prosjekt') !== both.after.includes('T/prosjekt'), 'on one side only');
  assert.ok(both.before.includes('T/prosjekt'), '2 arrows as a prerequisite against 2 as a dependent: the prerequisite side wins a tie');
});

const rect = (p) => ({ x1: p.x - p.w / 2, y1: p.y - p.h / 2, x2: p.x + p.w / 2, y2: p.y + p.h / 2 });
const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
// No stretch of the arrow goes into the inside of a box (the border itself, where it starts and ends, does not count)
function through(pts, r, m) {
  for (let i = 1; i < pts.length; i++) {
    const x1 = Math.min(pts[i - 1][0], pts[i][0]), x2 = Math.max(pts[i - 1][0], pts[i][0]), y1 = Math.min(pts[i - 1][1], pts[i][1]), y2 = Math.max(pts[i - 1][1], pts[i][1]);
    if (x1 < r.x2 - m && x2 > r.x1 + m && y1 < r.y2 - m && y2 > r.y1 + m) return true;
  }
  return false;
}
// What every layout of the view must keep: nothing overlaps, the grey nodes are outside the frame on their side, every arrow has a route that
// keeps clear of all the boxes and starts and ends on the border of its own two
function check(d, cid, T, opts, wide) {
  const M = temaMembers(d, cid, opts), where = `${cid} ${wide ? 'wide' : 'upright'}`;
  assert.deepEqual(Object.keys(T.nodes).sort(), [...M.own, ...M.before, ...M.after].sort(), where + ': every node of the view, and no other');
  const ids = Object.keys(T.nodes), f = rect(T.frame);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(!hit(rect(T.nodes[ids[i]]), rect(T.nodes[ids[j]])), `${where}: ${ids[i]} / ${ids[j]}`);
  for (const id of M.own) { const r = rect(T.nodes[id]); assert.ok(r.x1 >= f.x1 && r.x2 <= f.x2 && r.y1 >= f.y1 + T.frame.band - 1 && r.y2 <= f.y2, `${where}: ${id} is inside the frame, under its name`); assert.equal(T.nodes[id].role, 'own'); }
  for (const [list, role, sign] of [[M.before, 'before', -1], [M.after, 'after', 1]]) {
    for (const id of list) {
      const r = rect(T.nodes[id]);
      assert.equal(T.nodes[id].role, role);
      assert.ok(!hit(r, f), `${where}: ${id} is outside the frame`);
      if (wide) assert.ok(sign < 0 ? r.x2 <= f.x1 : r.x1 >= f.x2, `${where}: ${id} is on its side`);
      else assert.ok(sign < 0 ? r.y2 <= f.y1 : r.y1 >= f.y2, `${where}: ${id} is on its side`);
      assert.ok(T.nodes[id].cap.length >= 1 && T.nodes[id].cap.length <= 2, `${where}: the name of its tema under it`);
    }
  }
  const b = T.bounds;
  for (const id of ids) { const r = rect(T.nodes[id]); assert.ok(r.x1 >= b.x1 - 1 && r.x2 <= b.x2 + 1 && r.y1 >= b.y1 - 1 && r.y2 <= b.y2 + 1, `${where}: ${id} is inside the bounds`); }
  assert.deepEqual(Object.keys(T.routes).sort(), M.edges.map((e) => e.key).sort(), where + ': a route for every arrow');
  for (const e of M.edges) {
    const pts = T.routes[e.key], a = rect(T.nodes[e.k.fra]), c = rect(T.nodes[e.k.til]);
    const onBorder = (p, r) => p[0] >= r.x1 - 1 && p[0] <= r.x2 + 1 && p[1] >= r.y1 - 1 && p[1] <= r.y2 + 1 && (Math.abs(p[0] - r.x1) < 1 || Math.abs(p[0] - r.x2) < 1 || Math.abs(p[1] - r.y1) < 1 || Math.abs(p[1] - r.y2) < 1);
    assert.ok(onBorder(pts[0], a) && onBorder(pts[pts.length - 1], c), `${where}: arrow ${e.key} runs from border to border`);
    for (const id of ids) assert.ok(!through(pts, rect(T.nodes[id]), 1.5), `${where}: arrow ${e.key} goes through ${id}`);
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1], `${where}: arrow ${e.key} runs in horizontal and vertical stretches`);
  }
}

test('layout of the tema view: grey nodes outside the frame on their side, routes around every box, wide and upright', async () => {
  const d = tiny();
  for (const [aspect, wide] of [[1.75, true], [PORTRAIT_ASPECT, false]]) {
    for (const opts of [{}, { withoutForkunnskap: true }]) {
      const { tema, problems } = await computeTemaLayouts(d, { aspect, ...opts });
      assert.deepEqual(problems, []);
      assert.deepEqual(Object.keys(tema).sort(), opts.withoutForkunnskap ? ['a', 'b', 'c'] : ['a', 'b', 'c', 'forkunnskap']);
      for (const cid of Object.keys(tema)) check(d, cid, tema[cid], opts, wide);
    }
  }
});

test('layout of the tema view: prerequisites to the left inside the frame, level 1 and 2 together, the same every time', async () => {
  const d = tiny();
  const { tema } = await computeTemaLayouts(d), A = tema.a.nodes;
  assert.ok(A['T/mengde'].x < A['T/snitt'].x && A['T/snitt'].x < A['T/venndiagram'].x, 'what you must know first is further left');
  assert.equal(A['T/venndiagram'].l, 2);
  assert.equal(A['T/snitt'].l, 1);
  assert.ok(A['T/snitt'].h > 0 && A['T/venndiagram'].w > 0);
  assert.equal(JSON.stringify(await computeTemaLayouts(d)), JSON.stringify({ tema, problems: [] }));
  // the upright one reads from the top: prerequisites above
  const up = (await computeTemaLayouts(d, { aspect: PORTRAIT_ASPECT })).tema.a.nodes;
  assert.ok(up['T/mengde'].y < up['T/snitt'].y && up['T/snitt'].y < up['T/venndiagram'].y);
});

test('the boxes: own nodes are bigger than the grey ones, and the name of the tema under a grey node is at most two lines', () => {
  assert.ok(ownSize('Standardavvik for eit datasett', 1).h >= ownSize('Standardavvik for eit datasett', 2).h);
  const g = greySize('Standardavvik for eit datasett', 'Tema med eit veldig mykje lenger namn enn dei andre pleier å ha');
  assert.ok(g.cap.length === 2 && g.cap[1].endsWith('…'));
  assert.ok(g.h > g.nameH + g.capH, 'room for both');
  assert.equal(greySize('Tal', 'Forkunnskap').cap.length, 1);
});

for (const code of realMaps) {
  test(`${code}: every tema gets a clean layout, wide and upright, with and without forkunnskap`, async (t) => {
    const f = path.join(dist, code + '.json');
    if (!fs.existsSync(f)) return t.skip(`dist/${code}.json is missing (run scripts/bygg.py)`);
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [aspect, wide] of [[1.75, true], [PORTRAIT_ASPECT, false]]) {
      for (const opts of [{}, { withoutForkunnskap: true }]) {
        const { tema, problems } = await computeTemaLayouts(d, { aspect, ...opts });
        assert.deepEqual(problems, []);
        const groups = new Set(d.nodar.filter((n) => !n.utgaatt && n.type !== 'kompetansemaal' && !(opts.withoutForkunnskap && n.forkunnskap)).map((n) => (n.forkunnskap ? 'forkunnskap' : n.klynge)));
        assert.deepEqual(Object.keys(tema).sort(), [...groups].sort());
        for (const cid of Object.keys(tema)) check(d, cid, tema[cid], opts, wide);
      }
    }
  });
}
