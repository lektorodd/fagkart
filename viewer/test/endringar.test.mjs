// Tests for the data behind "Kva er nytt" (src/endringar.js). Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { endringarView, datoTekst } from '../src/endringar.js';

const DATA = {
  format: 'fagkart-endringar/1', kart: 'X',
  versjonar: [
    { versjon: '2', dato: '2026-10-29', samandrag: 'Nyast.', etter_innspel: 3, utrekna: true,
      nye: [{ id: 'X/a', namn: 'A $x^2$', tema: 'rekker' }], endra: [{ id: 'X/b', namn: 'B', felt: ['tekst_elev', 'nivaa', 'ukjend'] }],
      sletta: [{ id: 'X/c', namn: 'C' }], kantar: { nye: [{ fra: 'X/a', til: 'X/b', type: 'byggjer_paa' }], fjerna: [] } },
    { versjon: '1', dato: '2026-10-18', samandrag: 'Første.', utrekna: false },
  ],
};

test('datoTekst: Nynorsk date, other text as it came', () => {
  assert.equal(datoTekst('2026-10-29'), '29. oktober 2026');
  assert.equal(datoTekst('2026-01-05'), '5. januar 2026');
  assert.equal(datoTekst('i går'), 'i går');
  assert.equal(datoTekst('2026-13-01'), '2026-13-01');
});

test('no log: null', () => {
  for (const d of [null, undefined, {}, { versjonar: [] }, { versjonar: 'nei' }]) assert.equal(endringarView(d), null);
});

test('teacher view: lists, field names and counts; older versions behind', () => {
  const v = endringarView(DATA);
  assert.equal(v.kart, 'X');
  assert.equal(v.naa.versjon, '2');
  assert.equal(v.naa.dato, '29. oktober 2026');
  assert.equal(v.naa.innspel, 3);
  assert.deepEqual(v.naa.nye, [{ id: 'X/a', namn: 'A $x^2$', tema: 'rekker' }]);
  assert.deepEqual(v.naa.endra, [{ id: 'X/b', namn: 'B', felt: ['forklaring til eleven', 'nivå', 'ukjend'] }]);
  assert.deepEqual(v.naa.sletta, [{ id: 'X/c', namn: 'C' }]);
  assert.deepEqual(v.naa.piler, { nye: 1, fjerna: 0 });
  assert.equal(v.eldre.length, 1);
});

test('student view: the same names, no field names', () => {
  const v = endringarView(DATA, { elev: true });
  assert.deepEqual(v.naa.endra, [{ id: 'X/b', namn: 'B', felt: [] }]);
  assert.equal(v.naa.nye.length, 1);
  assert.equal(v.naa.sletta.length, 1);
});

test('a version that was not calculated has only the summary', () => {
  const old = endringarView(DATA).eldre[0];
  assert.equal(old.utrekna, false);
  assert.equal(old.samandrag, 'Første.');
  assert.equal(old.innspel, null);
  assert.deepEqual([old.nye, old.endra, old.sletta, old.piler], [[], [], [], null]);
});

test('a single version has no older ones, and missing lists do not break it', () => {
  const v = endringarView({ versjonar: [{ versjon: '1', dato: '2026-10-18', samandrag: 'x', utrekna: true }] });
  assert.deepEqual(v.eldre, []);
  assert.deepEqual([v.naa.nye, v.naa.endra, v.naa.sletta, v.naa.piler], [[], [], [], { nye: 0, fjerna: 0 }]);
});
