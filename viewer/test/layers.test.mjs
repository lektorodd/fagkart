// Tests for the layer registry (src/layers.js) and the layers in src/lag/ and test/lag/. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLayerRegistry, PRIORITY } from '../src/layers.js';
import { makeGraph, reach, topoOrder, prerequisiteChain, shortestPath, readyToLearn } from '../src/graph.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// A layer file is a plain script that calls fagkart.registerLayer; run it against a registry
function load(reg, file) {
  new Function('fagkart', fs.readFileSync(file, 'utf8'))({ PRIORITY, registerLayer: (def) => reg.register(def).id });
}

test('register: an id, functions as hooks, known modes and priorities', () => {
  const reg = createLayerRegistry();
  reg.register({ id: 'a' });
  assert.throws(() => reg.register({ id: 'a' }), /already registered/);
  assert.throws(() => reg.register({}), /needs an id/);
  assert.throws(() => reg.register({ id: 'b', nodeStyle: 'raud' }), /must be a function/);
  assert.throws(() => reg.register({ id: 'c', modes: ['foreldre'] }), /unknown mode/);
  assert.throws(() => reg.register({ id: 'd', priority: 'viktig' }), /unknown priority/);
  assert.throws(() => reg.register({ id: 'e', viewport: 'nei' }), /must be a function/); // viewport is a hook (HTML that follows the nodes)
  reg.register({ id: 'f', viewport: () => {} });
  assert.equal(reg.call('laerar', 'viewport').length, 1);
  assert.equal(reg.get('a').priority, PRIORITY.markering);
  assert.equal(reg.get('a').cardSlot, 'bottom');
});

test('nodeStyle: classes add up, hide and fade hold, the highest priority sets the colour', () => {
  const reg = createLayerRegistry();
  reg.register({ id: 'sti', priority: 'sti', nodeStyle: () => ({ fill: 'blue', classes: ['sti'] }) });
  reg.register({ id: 'tema', priority: 'tema', nodeStyle: () => ({ fill: 'grey', ring: 'black', classes: 'tema', hide: true }) });
  reg.register({ id: 'markering', nodeStyle: () => ({ fill: 'green', fade: true, hide: false, badge: { tone: 'new', text: 'ny' } }) });
  reg.register({ id: 'tom', nodeStyle: () => null });
  const s = reg.nodeStyle('laerar', { id: 'x' }, {}, {});
  assert.deepEqual(s.classes, ['tema', 'sti']);
  assert.equal(s.fill, 'blue');
  assert.equal(s.ring, 'black');
  assert.equal(s.hide, true);
  assert.equal(s.fade, true);
  assert.deepEqual(s.badge, { tone: 'new', text: 'ny' });
  assert.deepEqual(reg.all().map((l) => l.id), ['tema', 'markering', 'tom', 'sti']);
});

test('nodeStyle: keep holds when any layer says so, like hide and fade', () => {
  const reg = createLayerRegistry();
  reg.register({ id: 'a', nodeStyle: () => ({ keep: true }) });
  reg.register({ id: 'b', priority: 'sti', nodeStyle: () => ({ keep: false, fade: true }) });
  const s = reg.nodeStyle('laerar', { id: 'x' }, {}, {});
  assert.equal(s.keep, true);
  assert.equal(s.fade, true);
  assert.equal(reg.nodeStyle('laerar', { id: 'y' }, {}, {}).hide, undefined);
});

test('modes: a layer only answers in its modes', () => {
  const reg = createLayerRegistry();
  reg.register({ id: 'elev', modes: ['elev'], nodeStyle: () => ({ fill: 'mint' }), nodeLabel: () => 'elev' });
  reg.register({ id: 'alle', nodeLabel: () => 'alle' });
  assert.equal(reg.nodeStyle('laerar', {}, {}, {}).fill, undefined);
  assert.equal(reg.nodeStyle('elev', {}, {}, {}).fill, 'mint');
  assert.deepEqual(reg.nodeLabel('laerar', {}, {}), ['alle']);
  assert.deepEqual(reg.nodeLabel('elev', {}, {}), ['elev', 'alle']);
});

test('cards: per slot, in priority order, empty answers left out', () => {
  const reg = createLayerRegistry();
  reg.register({ id: 'b', priority: 'sti', nodeCard: () => 'B' });
  reg.register({ id: 'a', nodeCard: () => ['A1', null, 'A2'] });
  reg.register({ id: 't', cardSlot: 'top', nodeCard: () => 'T' });
  reg.register({ id: 'n', nodeCard: () => null });
  assert.deepEqual(reg.cards('laerar', 'bottom', {}, {}), ['A1', 'A2', 'B']);
  assert.deepEqual(reg.cards('laerar', 'top', {}, {}), ['T']);
});

test('the built-in layers register through the public API only', () => {
  const reg = createLayerRegistry();
  for (const f of ['forkunnskap.js', 'implisitte.js', 'filter.js']) load(reg, path.join(here, '..', 'src', 'lag', f));
  assert.deepEqual(reg.all().map((l) => l.id), ['forkunnskap', 'implisitte', 'filter']);
});

// The test layer: under 30 lines, colours nodes and adds a card section, without touching the core
const TESTLAG = path.join(here, 'lag', 'testlag.js');
test('test layer: under 30 lines, colours the procedures and adds a card section', () => {
  assert.ok(fs.readFileSync(TESTLAG, 'utf8').trimEnd().split('\n').length < 30);
  const reg = createLayerRegistry();
  load(reg, TESTLAG);
  const nodar = [{ id: 'tal', namn: 'Tal', type: 'omgrep' }, { id: 'rekne', namn: 'Rekne', type: 'prosedyre' }];
  const g = makeGraph(nodar.map((n) => n.id), [{ fra: 'rekne', til: 'tal', type: 'byggjer_paa' }]);
  // a stand-in for the core's ctx: h() builds plain objects instead of DOM
  const h = (tag, props, ...kids) => ({ tag, props, kids: kids.flat() });
  const ctx = { h, rich: (s) => s, byId: new Map(nodar.map((n) => [n.id, n])), graph: () => g, alg: { reach, topoOrder, prerequisiteChain, shortestPath, readyToLearn } };
  assert.equal(reg.nodeStyle('elev', nodar[1], ctx, {}).fill, '#ffe08a');
  assert.equal(reg.nodeStyle('elev', nodar[0], ctx, {}).fill, undefined);
  const [card] = reg.cards('laerar', 'bottom', nodar[1], ctx);
  assert.equal(card.kids[0].kids[0], 'Lær først (testlag)');
  assert.deepEqual(card.kids[1].kids.map((li) => li.kids[0]), ['Tal']);
});

