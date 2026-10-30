// The layer API in the real page: the demo map built with the test layer (build.mjs --lag=…), opened in Chromium.
// Skipped when no Chromium is installed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMap, skip } from './browser.mjs';

const openDemo = (extra) => openMap('fixtures/DEMO-01.json', extra);
// the background of the first procedure node and of the first other node, as Cytoscape draws them
const colours = (page) => page.evaluate(() => {
  const cy = window.__cy, bg = (n) => n.pstyle('background-color').strValue;
  return { proc: bg(cy.nodes('[kind="node"][type="prosedyre"]')[0]), other: bg(cy.nodes('[kind="node"][type="omgrep"]')[0]) };
});

test('a layer outside the core colours nodes and adds a card section', { skip }, async () => {
  const { page, errors, close } = await openDemo(['--lag=test/lag/testlag.js']);
  try {
    const c = await colours(page);
    assert.equal(c.proc, 'rgb(255,224,138)');
    assert.notEqual(c.other, 'rgb(255,224,138)');
    const id = await page.evaluate(() => window.__cy.nodes('[kind="node"][type="prosedyre"]')[0].id());
    await page.evaluate((nid) => window.__fk.select(nid, { center: false }), id);
    assert.match(await page.textContent('#panel'), /Lær først \(testlag\)/);
    assert.equal(await page.textContent('#side [data-layer="testlag"] summary'), 'Testlag');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('without the layer the page is the plain one', { skip }, async () => {
  const { page, errors, close } = await openDemo([]);
  try {
    const c = await colours(page);
    assert.notEqual(c.proc, 'rgb(255,224,138)');
    assert.equal(await page.$('#side [data-layer="testlag"]'), null); // the built-in layers keep their own sections
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
