// Tests for dist/<KODE>.layout.json, the build-time layout as a file of its own. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewerDir = path.join(here, '..');
const demo = path.join(viewerDir, 'fixtures', 'DEMO-01.json');

function buildDemo() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-layoutjson-'));
  execFileSync(process.execPath, ['build.mjs', `--out=${out}`, demo], { cwd: viewerDir, stdio: 'pipe' });
  return out;
}

test('build.mjs writes <KODE>.layout.json next to the HTML, with the same layout as the page', () => {
  const out = buildDemo();
  try {
    const data = JSON.parse(fs.readFileSync(demo, 'utf8'));
    const file = JSON.parse(fs.readFileSync(path.join(out, 'DEMO-01.layout.json'), 'utf8'));
    assert.equal(file.format, 'fagkart-layout/1');
    assert.equal(file.kart, 'DEMO-01');
    assert.equal(file.kartversjon, data.versjon);
    assert.deepEqual(Object.keys(file), ['format', 'kart', 'kartversjon', 'layout']);

    const expected = data.nodar.filter((n) => !n.utgaatt && n.type !== 'kompetansemaal').map((n) => n.id);
    assert.ok(expected.length > 0);
    for (const id of expected) assert.ok(file.layout.nodes[id], `no position for ${id}`);
    for (const k of ['version', 'nodes', 'areas', 'bounds', 'routes', 'tema']) assert.ok(k in file.layout, `layout.${k}`);

    // HTML and JSON can never differ: the page holds the very same object.
    const html = fs.readFileSync(path.join(out, 'DEMO-01.html'), 'utf8');
    const inPage = JSON.parse(html.match(/<script type="application\/json" id="fagkart-layout">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(inPage, file.layout);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
