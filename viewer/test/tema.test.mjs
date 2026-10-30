// Tests for the colour slot of a tema and the counts on the tema boxes. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { temaSlot, TEMA_SLOTS, countText, countParts } from '../src/tema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const mapsDir = path.join(here, '..', '..', 'dist');
const maps = [path.join(here, '..', 'fixtures', 'DEMO-01.json'), ...(fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir).filter((f) => f.endsWith('.json') && !/\.(layout|versjon)\.json$/.test(f)).map((f) => path.join(mapsDir, f)) : [])];

test('the slot depends on the id alone and stays in range', () => {
  for (const id of ['sannsyn', 'derivasjon', 'okonomi', 'a', '']) {
    assert.equal(temaSlot(id), temaSlot(id));
    assert.ok(Number.isInteger(temaSlot(id)) && temaSlot(id) >= 0 && temaSlot(id) < TEMA_SLOTS, id);
  }
  // fixed values: a change here recolours every map, so it must be deliberate
  assert.deepEqual(['sannsyn', 'inferens', 'derivasjon'].map(temaSlot), [1, 5, 7]);
});

test('every slot is used by some id (the palette is spread out)', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(temaSlot('tema-' + i));
  assert.equal(seen.size, TEMA_SLOTS);
});

test('the temaa of each map we have get different colours', () => {
  assert.ok(maps.length >= 1);
  for (const file of maps) {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ids = (d.klyngjer || []).map((k) => k.id).filter((id) => id !== 'forkunnskap'); // forkunnskap is always grey
    const slots = ids.map(temaSlot);
    assert.equal(new Set(slots).size, ids.length, `${path.basename(file)}: ${ids.map((id, i) => `${id}=${slots[i]}`).join(' ')}`);
  }
});

test('counts say omgrep and metodar, with singular and plural, and skip what is not there', () => {
  const n = (type, k) => Array.from({ length: k }, () => ({ type }));
  assert.equal(countText([...n('omgrep', 4), ...n('prosedyre', 2)]), '4 omgrep · 2 metodar');
  assert.equal(countText([...n('prosedyre', 1), ...n('forklaring', 1), ...n('representasjon', 3)]), '1 metode · 1 forklaring · 3 representasjonar');
  assert.equal(countText([...n('omgrep', 1), ...n('kompetansemaal', 5)]), '1 omgrep');
  assert.deepEqual(countParts([]), []);
  assert.equal(countText([]), '');
});
