// Tests for the rules of the layer "Neste steg" (src/lag/nestesteg.js): klar til å lære and svake punkt, on the demo map.
// The layer is a plain script, so it is run here against a small fake of the page (fagkart.registerLayer) and the real graph.js.
// Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGraph, reach, topoOrder, prerequisiteChain, shortestPath, readyToLearn } from '../src/graph.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'DEMO-01.json'), 'utf8'));
const P = 'DEMO-01/';
const id = (s) => P + s;

let layer = null;
new Function('fagkart', fs.readFileSync(path.join(here, '..', 'src', 'lag', 'nestesteg.js'), 'utf8'))({ registerLayer: (d) => { layer = d; } });

const isKm = (n) => n.type === 'kompetansemaal';
const isFk = (n) => !!n.forkunnskap;
const ids = DATA.nodar.map((n) => n.id);
// the ctx of the page as far as the rules use it: marks come from a fake "eigenvurdering" layer
function makeCtx(marks, { implicit = false } = {}) {
  const state = { showImplicit: implicit, showFk: true };
  const g = makeGraph(ids, DATA.kantar, { implicit });
  return {
    data: DATA, nodes: DATA.nodar, byId: new Map(DATA.nodar.map((n) => [n.id, n])), isKm, isFk, state,
    graph: () => g,
    alg: { reach, topoOrder, prerequisiteChain, shortestPath, readyToLearn },
    layer: (l) => (l === 'eigenvurdering' ? { marks: () => ({ ...marks }), mark: (i) => marks[i] || null } : null),
  };
}
const plan = (marks, opts) => layer.plan(makeCtx(marks, opts));
const short = (list) => list.map((i) => i.replace(P, ''));
const m = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [id(k), v]));

test('the layer is for the student view only', () => {
  assert.equal(layer.id, 'nestesteg');
  assert.deepEqual(layer.modes, ['elev']);
  assert.equal(layer.cardSlot, 'bottom');
});

test('no marks: the starting points (nodes without a prerequisite in the subject), in learning order', () => {
  const p = plan({});
  // forkunnskap without a mark is known, so a node that builds only on forkunnskap is a start too
  assert.deepEqual(short(p.ready), ['avvik', 'spreiing', 'histogram', 'klokkekurve', 'standardnormal']);
  assert.deepEqual(p.weak, []);
  assert.equal(p.marked, 0);
  const subject = DATA.nodar.filter((n) => !isKm(n) && !isFk(n));
  assert.equal(p.unassessed, subject.length);
  // no forkunnskap node and no competence goal is ever offered
  assert.ok(p.ready.every((i) => !isFk(DATA.nodar.find((n) => n.id === i)) && !isKm(DATA.nodar.find((n) => n.id === i))));
});

test('a node becomes ready when all its prerequisites are heilt, and is gone when it is heilt itself', () => {
  assert.ok(!plan({}).ready.includes(id('kvadrert-avvik')));
  assert.ok(!plan(m({ avvik: 'delvis' })).ready.includes(id('kvadrert-avvik'))); // delvis is not enough
  assert.ok(!plan(m({ avvik: 'ikkje' })).ready.includes(id('kvadrert-avvik')));
  const p = plan(m({ avvik: 'heilt' }));
  assert.ok(p.ready.includes(id('kvadrert-avvik')));
  assert.ok(!p.ready.includes(id('avvik'))); // mastered: nothing left to learn
  // varians needs both kvadrert-avvik and spreiing
  const q = plan(m({ avvik: 'heilt', 'kvadrert-avvik': 'heilt' }));
  assert.ok(!q.ready.includes(id('varians')));
  const r = plan(m({ avvik: 'heilt', 'kvadrert-avvik': 'heilt', spreiing: 'heilt' }));
  assert.ok(r.ready.includes(id('varians')));
  assert.deepEqual(short(r.ready), ['histogram', 'varians', 'klokkekurve', 'standardnormal']);
  // a mark that says "ikkje" on a node whose prerequisites are done keeps it ready (and it is a weak point as well)
  const s = plan(m({ avvik: 'heilt', 'kvadrert-avvik': 'ikkje' }));
  assert.ok(s.ready.includes(id('kvadrert-avvik')));
  assert.deepEqual(short(s.weak.map((w) => w.id)), ['kvadrert-avvik']);
});

test('a forkunnskap node marked ikkje or delvis takes the ready status from what builds on it; unmarked does not', () => {
  assert.ok(plan({}).ready.includes(id('avvik')));
  assert.ok(plan(m({ 'fk-gjennomsnitt': 'heilt' })).ready.includes(id('avvik')));
  for (const v of ['ikkje', 'delvis']) {
    const p = plan(m({ 'fk-gjennomsnitt': v }));
    assert.ok(!p.ready.includes(id('avvik')), v);
    assert.ok(!p.ready.includes(id('spreiing')), v);
    assert.ok(p.ready.includes(id('histogram')), 'what builds on another forkunnskap node is not affected');
    assert.deepEqual(p.weak.map((w) => [w.id, w.mark]), [[id('fk-gjennomsnitt'), v]]);
  }
  // the further chain stays closed: avvik is not mastered, so kvadrert-avvik is not ready either
  assert.ok(!plan(m({ 'fk-gjennomsnitt': 'ikkje' })).ready.includes(id('kvadrert-avvik')));
});

test('weak points: ikkje and delvis only, the one most nodes of the subject build on first, with the count', () => {
  const p = plan(m({ avvik: 'ikkje', spreiing: 'delvis', histogram: 'heilt', klokkekurve: 'ikkje', 'fk-frekvens': 'ikkje' }));
  // avvik: kvadrert-avvik, varians, standardavvik, kvifor-kvadrat, rekne-sd, normalfordeling, empirisk-regel = 7
  // spreiing: varians + what builds on varians = 5; fk-frekvens: histogram = 1; klokkekurve: 0
  assert.deepEqual(p.weak.map((w) => [w.id.replace(P, ''), w.count]), [['avvik', 7], ['spreiing', 6], ['fk-frekvens', 1], ['klokkekurve', 0]]);
  assert.ok(!p.weak.some((w) => w.id === id('histogram')), 'heilt is no weak point');
  assert.equal(p.marked, 5);
});

test('unmarked is unknown: it is never a weak point, and is counted as not assessed', () => {
  const p = plan(m({ avvik: 'heilt' }));
  assert.deepEqual(p.weak, []);
  assert.equal(p.unassessed, DATA.nodar.filter((n) => !isKm(n) && !isFk(n)).length - 1);
});

test('missing: the direct prerequisites that are not mastered', () => {
  const none = plan({});
  assert.deepEqual(short(none.missing(id('varians'))), ['kvadrert-avvik', 'spreiing']);
  assert.deepEqual(none.missing(id('avvik')), []); // forkunnskap unmarked: known
  const p = plan(m({ spreiing: 'heilt', 'fk-sumteikn': 'delvis' }));
  assert.deepEqual(short(p.missing(id('varians'))), ['kvadrert-avvik']);
  assert.deepEqual(short(p.missing(id('kvadrert-avvik'))), ['avvik', 'fk-sumteikn']);
});

test('the same answer with and without "Vis implisitte piler", also when the marks do not hang together', () => {
  assert.ok(DATA.kantar.some((k) => k.implisitt), 'the demo map has an implied edge (varians -> fk-gjennomsnitt)');
  const cases = [
    {},
    m({ avvik: 'heilt' }),
    m({ 'fk-gjennomsnitt': 'ikkje' }),
    m({ 'fk-gjennomsnitt': 'ikkje', spreiing: 'heilt', avvik: 'heilt', 'kvadrert-avvik': 'heilt' }), // varians ready only if the implied edge is not read
    m({ 'fk-gjennomsnitt': 'delvis', spreiing: 'heilt', 'kvadrert-avvik': 'heilt', avvik: 'delvis', histogram: 'ikkje' }),
    m({ spreiing: 'heilt', 'kvadrert-avvik': 'heilt', varians: 'delvis', standardavvik: 'ikkje' }),
  ];
  for (const marks of cases) {
    const a = plan(marks), b = plan(marks, { implicit: true });
    assert.deepEqual(a.ready, b.ready, JSON.stringify(marks));
    assert.deepEqual(a.weak, b.weak, JSON.stringify(marks));
    assert.deepEqual(a.unassessed, b.unassessed);
    for (const n of DATA.nodar) if (!isKm(n)) assert.deepEqual(a.missing(n.id), b.missing(n.id), n.id);
  }
});

test('marks on ids the map does not have are ignored', () => {
  const p = plan({ 'DEMO-01/finst-ikkje': 'ikkje', ...m({ avvik: 'heilt' }) });
  assert.deepEqual(p.weak, []);
  assert.equal(p.marked, 1);
});
