// Tests for the arrow router (src/route.js), the list of drawn arrows (src/kartkantar.js) and the routes of the real maps. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeEdges, toSegments, simplify, pointAlong, pathLength } from '../src/route.js';
import { kartEdges, arrowEnds } from '../src/kartkantar.js';
import { computeLayout, PORTRAIT_ASPECT } from '../layout.mjs';
import { realMaps } from './kart.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', '..', 'dist');
const box = (id, x, y, w = 60, h = 30) => ({ id, x1: x - w / 2, y1: y - h / 2, x2: x + w / 2, y2: y + h / 2 });
// Does a path of horizontal and vertical runs go through the inside of a box? (touching the border is fine)
function crosses(pts, b, m = 0.5) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), y1 = Math.min(ay, by), y2 = Math.max(ay, by);
    if (x1 < b.x2 - m && x2 > b.x1 + m && y1 < b.y2 - m && y2 > b.y1 + m) return true;
  }
  return false;
}
const orthogonal = (pts) => pts.every((p, i) => !i || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);
const onBorder = (p, b) => (Math.abs(p[0] - b.x1) < 0.2 || Math.abs(p[0] - b.x2) < 0.2 ? p[1] >= b.y1 - 0.2 && p[1] <= b.y2 + 0.2 : Math.abs(p[1] - b.y1) < 0.2 || Math.abs(p[1] - b.y2) < 0.2 ? p[0] >= b.x1 - 0.2 && p[0] <= b.x2 + 0.2 : false);

test('an arrow between two boxes runs in horizontal and vertical stretches from border to border', () => {
  const obstacles = [box('a', 0, 0), box('b', 200, 100)];
  const r = routeEdges({ obstacles, edges: [{ id: 'x', from: 'a', to: 'b' }] }).get('x');
  assert.ok(r.ok);
  assert.ok(orthogonal(r.pts), JSON.stringify(r.pts));
  assert.ok(onBorder(r.pts[0], obstacles[0]) && onBorder(r.pts[r.pts.length - 1], obstacles[1]), JSON.stringify(r.pts));
});

test('an arrow goes around a box in its way, not through it', () => {
  const obstacles = [box('a', 0, 0), box('wall', 150, 0, 40, 300), box('b', 300, 0)];
  const r = routeEdges({ obstacles, edges: [{ id: 'x', from: 'a', to: 'b' }] }).get('x');
  assert.ok(r.ok && orthogonal(r.pts));
  assert.ok(!crosses(r.pts, obstacles[1]), JSON.stringify(r.pts));
  assert.ok(pathLength(r.pts) > 320, 'longer than the straight line, because it goes around');
});

test('an arrow that has no way out is reported, and drawn as a plain line', () => {
  // b sits inside a ring of boxes that leaves no gap
  const ring = [box('n', 300, 240, 200, 20), box('s', 300, 360, 200, 20), box('w', 200, 300, 20, 140), box('e', 400, 300, 20, 140)];
  const r = routeEdges({ obstacles: [box('a', 0, 0), box('b', 300, 300, 30, 20), ...ring], edges: [{ id: 'x', from: 'a', to: 'b' }], pad: 4 }).get('x');
  assert.equal(r.ok, false);
  assert.equal(r.pts.length, 2);
});

test('two arrows between the same boxes use different places on the boxes where they can', () => {
  const obstacles = [box('a', 0, 0, 60, 60), box('b', 200, 0, 60, 60)];
  const res = routeEdges({ obstacles, edges: [{ id: 'p', from: 'a', to: 'b' }, { id: 'q', from: 'a', to: 'b' }] });
  assert.notDeepEqual(res.get('p').pts[0], res.get('q').pts[0]);
  assert.notDeepEqual(res.get('p').pts.at(-1), res.get('q').pts.at(-1));
});

test('simplify drops the points in the middle of a straight stretch', () => {
  assert.deepEqual(simplify([[0, 0], [5, 0], [10, 0], [10, 4], [10, 9]]), [[0, 0], [10, 0], [10, 9]]);
});

test('pointAlong and pathLength', () => {
  const pts = [[0, 0], [10, 0], [10, 20]];
  assert.equal(pathLength(pts), 30);
  assert.deepEqual([pointAlong(pts, 15).x, pointAlong(pts, 15).y, pointAlong(pts, 15).vertical], [10, 5, true]);
});

test('toSegments: the bends come back as the same points from Cytoscape\'s weights and distances', () => {
  const S = { x: 0, y: 0, w: 60, h: 30 }, T = { x: 200, y: 120, w: 40, h: 40 };
  const pts = [[30, 5], [60, 5], [60, 120], [180, 120]];
  const g = toSegments(pts, S, T);
  assert.equal(g.se, '50% 16.7%');
  assert.equal(g.te, '-50% 0%');
  const dx = T.x - S.x, dy = T.y - S.y, L = Math.hypot(dx, dy);
  const back = g.sw.map((w, i) => [S.x + dx * w + (-dy / L) * g.sd[i], S.y + dy * w + (dx / L) * g.sd[i]]);
  back.forEach((b, i) => { assert.ok(Math.abs(b[0] - pts[i + 1][0]) < 0.1 && Math.abs(b[1] - pts[i + 1][1]) < 0.1, `${b} against ${pts[i + 1]}`); });
  // a straight arrow still gets one bend in the middle
  assert.equal(toSegments([[30, 0], [170, 0]], { x: 0, y: 0, w: 60, h: 30 }, { x: 200, y: 0, w: 60, h: 30 }).sw.length, 1);
});

test('kartEdges: the arrows the page draws, with the twin rule and the turning of the ends', () => {
  const d = {
    nodar: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'gone', utgaatt: true }],
    kantar: [{ fra: 'b', til: 'a', type: 'byggjer_paa' }, { fra: 'c', til: 'a', type: 'brukar' }, { fra: 'b', til: 'gone', type: 'byggjer_paa' }, { fra: 'c', til: 'b', type: 'byggjer_paa', implisitt: true }, { fra: 'a', til: 'c', type: 'dekkjer' }],
    oversiktskantar: [{ fra: 'b', til: 'a', type: 'byggjer_paa' }],
  };
  const list = kartEdges(d, () => true);
  // kantar index 2 is dropped (its node is gone), so the real arrows are e0, e1, e2 (implicit) and the dekkjer arrow is not drawn
  assert.deepEqual(list.map((e) => e.key), ['o0', 'e1', 'e2']);
  assert.equal(list[0].keep, true, 'the overview arrow has a twin and stays');
  assert.deepEqual(arrowEnds(d.kantar[0], true), { source: 'a', target: 'b' });
  assert.deepEqual(arrowEnds(d.kantar[1], false), { source: 'a', target: 'c' });
  assert.deepEqual(arrowEnds(d.kantar[1], true), { source: 'c', target: 'a' });
  // a map without overview arrows is laid out flat: every arrow is an overview arrow
  delete d.oversiktskantar;
  assert.deepEqual(kartEdges(d, () => true).map((e) => e.key), ['o0', 'o1', 'o2']);
  assert.deepEqual(kartEdges(d, (id) => id !== 'c').map((e) => e.key), ['o0']);
});

// the routes of the real maps, in the wide and in the upright layout: every arrow found a way, and none goes through a node
for (const code of realMaps) {
  for (const [label, opts] of [['wide', {}], ['upright', { aspect: PORTRAIT_ASPECT }]]) {
    test(`${code} (${label}): every arrow has a route that keeps clear of all the nodes`, async (t) => {
      const f = path.join(dist, code + '.json');
      if (!fs.existsSync(f)) return t.skip(`dist/${code}.json is missing (run scripts/bygg.py)`);
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      const L = await computeLayout(d, opts);
      assert.deepEqual(L.problems, []);
      const wanted = kartEdges(d, (id) => !!L.nodes[id]);
      assert.ok(wanted.length > 50);
      const rects = Object.entries(L.nodes).map(([id, p]) => ({ id, x1: p.x - p.w / 2, y1: p.y - p.h / 2, x2: p.x + p.w / 2, y2: p.y + p.h / 2 }));
      const bad = [];
      for (const e of wanted) {
        const pts = L.routes[e.key];
        if (!pts) { bad.push(`${e.key} has no route`); continue; }
        if (!orthogonal(pts)) bad.push(`${e.key} is not horizontal and vertical`);
        const a = rects.find((r) => r.id === e.k.fra), b = rects.find((r) => r.id === e.k.til);
        if (!onBorder(pts[0], a) || !onBorder(pts.at(-1), b)) bad.push(`${e.key} does not start and end on the borders`);
        for (const r of rects) if (crosses(pts, r)) bad.push(`${e.key} (${e.k.fra} -> ${e.k.til}) runs through ${r.id}`);
      }
      assert.deepEqual(bad.slice(0, 5), []);
    });
  }
}
