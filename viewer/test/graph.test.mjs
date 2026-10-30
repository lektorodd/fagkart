// Tests for the graph algorithms of the viewer. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGraph, reach, topoOrder, prerequisiteChain, shortestPath, readyToLearn } from '../src/graph.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bp = (fra, til, extra) => ({ fra, til, type: 'byggjer_paa', ...extra });

// tal <- brok <- prosent <- vekstfaktor, brok <- forhold <- vekstfaktor; likning stands alone; rekkje builds on vekstfaktor
const IDS = ['vekstfaktor', 'prosent', 'brok', 'tal', 'forhold', 'likning', 'rekkje'];
const KANTAR = [
  bp('prosent', 'brok'), bp('brok', 'tal'), bp('vekstfaktor', 'prosent'), bp('forhold', 'brok'), bp('vekstfaktor', 'forhold'),
  bp('rekkje', 'vekstfaktor'), bp('vekstfaktor', 'brok', { implisitt: true }),
  { fra: 'likning', til: 'tal', type: 'brukar' },
  bp('vekstfaktor', 'ukjend'), // to a node outside the map: left out
];
const G = makeGraph(IDS, KANTAR);

test('makeGraph: adjacency per type, implied edges only on request', () => {
  assert.deepEqual(G.prereqs('vekstfaktor'), ['prosent', 'forhold']);
  assert.deepEqual(G.dependents('brok'), ['prosent', 'forhold']);
  assert.deepEqual(G.out('brukar', 'likning'), ['tal']);
  assert.deepEqual(G.inn('brukar', 'tal'), ['likning']);
  assert.deepEqual(G.prereqs('likning'), []);
  assert.equal(G.has('ukjend'), false);
  const GI = makeGraph(IDS, KANTAR, { implicit: true });
  assert.deepEqual(GI.prereqs('vekstfaktor'), ['prosent', 'forhold', 'brok'], 'explicit edges first, then the implied ones');
  assert.deepEqual(GI.dependents('brok'), ['prosent', 'forhold', 'vekstfaktor']);
});

test('reach: depth first, through decides where the walk stops', () => {
  assert.deepEqual(reach(G, ['vekstfaktor']), ['prosent', 'brok', 'tal', 'forhold']);
  assert.deepEqual(reach(G, ['tal'], { dir: 'post' }), ['brok', 'prosent', 'vekstfaktor', 'rekkje', 'forhold']);
  // stop at brok: it is listed, what lies behind it is not
  assert.deepEqual(reach(G, ['vekstfaktor'], { through: (id) => id !== 'brok' }), ['prosent', 'brok', 'forhold']);
  assert.deepEqual(reach(G, ['tal']), []);
});

test('topoOrder: prerequisites first, ties in map order', () => {
  const order = topoOrder(G);
  assert.equal(order.length, IDS.length);
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const k of KANTAR) if (k.type === 'byggjer_paa' && G.has(k.til) && !k.implisitt) assert.ok(pos.get(k.til) < pos.get(k.fra), `${k.til} before ${k.fra}`);
  // of the nodes that are ready, the one that comes first in the map goes first
  assert.deepEqual(order, ['tal', 'brok', 'prosent', 'forhold', 'vekstfaktor', 'likning', 'rekkje']);
  assert.deepEqual(topoOrder(G, ['vekstfaktor', 'brok', 'prosent']), ['brok', 'prosent', 'vekstfaktor'], 'a subset keeps the order of the edges between its nodes');
});

test('topoOrder: a cycle never loses nodes', () => {
  // b and c build on each other; a builds on the cycle, e does not
  const g = makeGraph(['a', 'b', 'c', 'e'], [bp('a', 'b'), bp('b', 'c'), bp('c', 'b')]);
  assert.deepEqual(topoOrder(g), ['e', 'a', 'b', 'c'], 'what can be ordered first, then the rest in map order');
});

test('prerequisiteChain: what you must know before a node, in learning order', () => {
  assert.deepEqual(prerequisiteChain(G, 'vekstfaktor'), ['tal', 'brok', 'prosent', 'forhold']);
  assert.deepEqual(prerequisiteChain(G, 'rekkje'), ['tal', 'brok', 'prosent', 'forhold', 'vekstfaktor']);
  assert.deepEqual(prerequisiteChain(G, 'tal'), []);
});

test('shortestPath: from a prerequisite to what builds on it', () => {
  assert.deepEqual(shortestPath(G, 'tal', 'rekkje'), ['tal', 'brok', 'prosent', 'vekstfaktor', 'rekkje']);
  assert.deepEqual(shortestPath(G, 'brok', 'brok'), ['brok']);
  assert.equal(shortestPath(G, 'rekkje', 'tal'), null, 'against the arrows there is no chain');
  assert.equal(shortestPath(G, 'tal', 'likning'), null, 'brukar is not a byggjer_paa edge');
  assert.equal(shortestPath(G, 'tal', 'ukjend'), null);
  // both ways two steps; the first neighbour found wins (what builds on a node before its prerequisites)
  assert.deepEqual(shortestPath(G, 'prosent', 'forhold', { undirected: true }), ['prosent', 'vekstfaktor', 'forhold']);
  assert.deepEqual(shortestPath(G, 'rekkje', 'tal', { undirected: true }), ['rekkje', 'vekstfaktor', 'prosent', 'brok', 'tal']);
  // the implied edge is a shortcut when it counts
  assert.deepEqual(shortestPath(makeGraph(IDS, KANTAR, { implicit: true }), 'brok', 'rekkje'), ['brok', 'vekstfaktor', 'rekkje']);
});

test('readyToLearn: not mastered, every prerequisite mastered', () => {
  assert.deepEqual(readyToLearn(G, {}), ['tal', 'likning'], 'with nothing marked: the nodes without prerequisites');
  assert.deepEqual(readyToLearn(G, { tal: 'heilt', likning: 'heilt' }), ['brok']);
  assert.deepEqual(readyToLearn(G, new Map([['tal', 'heilt'], ['brok', 'heilt'], ['prosent', 'delvis']])), ['prosent', 'forhold', 'likning'], 'in map order');
  assert.deepEqual(readyToLearn(G, { tal: 'heilt', brok: 'heilt', prosent: 'heilt', forhold: 'heilt' }, ['vekstfaktor', 'rekkje']), ['vekstfaktor']);
});

// The real maps: every byggjer_paa chain has an order (no cycles), and the order respects every explicit edge.
const distDir = path.resolve(here, '..', '..', 'dist');
// only the map files (<KODE>.json): dist/ also holds <KODE>.layout.json and <KODE>.versjon.json
const maps = fs.existsSync(distDir) ? fs.readdirSync(distDir).filter((f) => /^[A-Za-z0-9-]+\.json$/.test(f) && !/\.(layout|versjon)\.json$/.test(f)) : [];
for (const f of maps) {
  test(`real map ${f}: learning order respects every byggjer_paa edge`, () => {
    const data = JSON.parse(fs.readFileSync(path.join(distDir, f), 'utf8'));
    const ids = data.nodar.filter((n) => !n.utgaatt).map((n) => n.id);
    const g = makeGraph(ids, data.kantar || [], { implicit: true });
    const order = topoOrder(g);
    assert.equal(order.length, ids.length);
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const k of data.kantar || []) {
      if (k.type !== 'byggjer_paa' || !g.has(k.fra) || !g.has(k.til)) continue;
      assert.ok(pos.get(k.til) < pos.get(k.fra), `${f}: ${k.til} must come before ${k.fra}`);
    }
    for (const id of ids) {
      const chain = prerequisiteChain(g, id);
      assert.ok(!chain.includes(id), `${f}: ${id} is its own prerequisite`);
    }
  });
}
