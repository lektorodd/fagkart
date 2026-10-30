// The front page (src/index.html, build.mjs): it lists only the maps of "offentlege" in publisering.json (all maps when the key is missing), the other maps are still
// built into publiser/, the blog link is left out when "blogg" is missing, and the citation names the map. Builds the demo map under two codes into a temp folder.
// No browser needed. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { viewerDir } from './browser.mjs';

const ADRESSE = 'https://fagkart.example.org/';
// Two maps: the demo map as DEMO-01 and as DEMO-02 (the code of a map is the name of its file). args = more build.mjs arguments.
function build(args = [], { codes = ['DEMO-01', 'DEMO-02'], versjon = '2026.3' } = {}) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-landing-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-landing-'));
  const data = JSON.parse(fs.readFileSync(path.join(viewerDir, 'fixtures', 'DEMO-01.json'), 'utf8'));
  data.versjon = versjon;
  const files = codes.map((c) => { const f = path.join(src, `${c}.json`); fs.writeFileSync(f, JSON.stringify({ ...data, kode: c })); return f; });
  const r = spawnSync(process.execPath, ['build.mjs', `--out=${out}`, `--adresse=${ADRESSE}`, ...args, ...files], { cwd: viewerDir, encoding: 'utf8' });
  fs.rmSync(src, { recursive: true, force: true });
  const html = (p) => fs.readFileSync(path.join(out, p), 'utf8');
  return { out, status: r.status, stderr: r.stderr, html, exists: (p) => fs.existsSync(path.join(out, p)), done: () => fs.rmSync(out, { recursive: true, force: true }) };
}
const cards = (html) => [...html.matchAll(/<li><h3>([^<]*)<\/h3>/g)].map((m) => m[1]);

test('only the maps of "offentlege" are listed on the front page, with links to their folders', () => {
  const b = build(['--offentlege=DEMO-01']);
  try {
    assert.equal(b.status, 0, b.stderr);
    const html = b.html('publiser/index.html');
    assert.equal(cards(html).length, 1);
    assert.match(html, /href="demo-01\/">Opne kartet</);
    assert.match(html, /href="demo-01\/\?vising=elev">Elevvising</);
    assert.ok(!/demo-02/i.test(html), 'the map that is not public is not named or linked');
    assert.ok(!/DEMO-02/.test(b.html('index.html')), 'the flat front page of dist/ lists the same maps');
    assert.match(b.html('index.html'), /href="DEMO-01\.html\?vising=elev">Elevvising</);
  } finally { b.done(); }
});

test('the maps that are not listed are still built into publiser/, with their data and version files', () => {
  const b = build(['--offentlege=DEMO-01']);
  try {
    for (const sti of ['demo-01', 'demo-02']) {
      for (const f of ['index.html', 'sw.js', `${sti.toUpperCase()}.json`, `${sti.toUpperCase()}.versjon.json`]) assert.ok(b.exists(`publiser/${sti}/${f}`), `${sti}/${f}`);
    }
    assert.ok(b.exists('DEMO-02.html'));
    const kart = JSON.parse(b.html('publiser/kart.json'));
    assert.deepEqual(kart.map((k) => k.kode).sort(), ['DEMO-01', 'DEMO-02'], 'the list of maps for the service of rooms is not the front page');
  } finally { b.done(); }
});

test('without the key "offentlege" all built maps are listed; an empty list lists none; the codes are not case sensitive', () => {
  const all = build(['--offentlege=']);
  const none = build(['--offentlege=ingen-slik']);
  const lower = build(['--offentlege=demo-02']);
  try {
    assert.deepEqual(cards(all.html('publiser/index.html')).length, 2);
    assert.equal(cards(none.html('publiser/index.html')).length, 0);
    assert.match(none.stderr, /"ingen-slik" i "offentlege" er ikkje blant karta/);
    assert.match(none.html('publiser/index.html'), /Ingen kart er klare enno/);
    assert.equal(cards(lower.html('publiser/index.html')).length, 1);
  } finally { all.done(); none.done(); lower.done(); }
});

test('the key in publisering.json: a list is used, and anything else stops the build', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-landing-cfg-'));
  const cfg = path.join(dir, 'publisering.json');
  try {
    for (const bad of ['"DEMO-01"', '[1]', '[""]']) {
      fs.writeFileSync(cfg, `{ "adresse": "${ADRESSE}", "offentlege": ${bad} }\n`);
      const b = build([`--publisering=${cfg}`]);
      try { assert.notEqual(b.status, 0, bad); assert.match(b.stderr, /"offentlege" må vere ei liste/); } finally { b.done(); }
    }
    // the file decides when no --offentlege= is given (and "blogg" comes from it too)
    fs.writeFileSync(cfg, `{ "adresse": "${ADRESSE}", "offentlege": ["DEMO-02"], "blogg": "https://blogg.example.org/fagkart" }\n`);
    const b = build([`--publisering=${cfg}`]);
    try {
      const html = b.html('publiser/index.html');
      assert.equal(cards(html).length, 1);
      assert.match(html, /href="demo-02\/"/);
      assert.ok(!/href="demo-01\//.test(html));
      assert.match(html, /href="https:\/\/blogg\.example\.org\/fagkart"/);
    } finally { b.done(); }
    // the file of the repository itself: a list of codes (or no key), all strings
    const real = JSON.parse(fs.readFileSync(path.join(viewerDir, '..', 'publisering.json'), 'utf8'));
    assert.ok(real.offentlege === undefined || (Array.isArray(real.offentlege) && real.offentlege.every((c) => typeof c === 'string')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the blog link is there when "blogg" is set and left out when it is missing or not an address', () => {
  const med = build(['--offentlege=DEMO-01', '--blogg=https://blogg.example.org/fagkart?a=1&b="2']);
  const utan = build(['--offentlege=DEMO-01', '--blogg=']);
  const feil = build(['--offentlege=DEMO-01', '--blogg=javascript:alert(1)']);
  try {
    assert.match(med.html('publiser/index.html'), /<a href="https:\/\/blogg\.example\.org\/fagkart\?a=1&amp;b=&quot;2">Blogginnlegget om fagkart<\/a>/);
    for (const b of [utan, feil]) assert.ok(!/Blogginnlegget/.test(b.html('publiser/index.html')));
    assert.match(feil.stderr, /blogg "javascript:alert\(1\)" må starte med http/);
    // the links that are always there
    for (const h of ['https://github.com/lektorodd/fagkart"', 'https://github.com/lektorodd/fagkart/issues', 'CC BY 4.0', 'MIT']) assert.ok(utan.html('publiser/index.html').includes(h), h);
  } finally { med.done(); utan.done(); feil.done(); }
});

test('the citation names the map, the year of its version and its address; "Kjem" has no links; no dev maps by code', () => {
  const b = build(['--offentlege=DEMO-01'], { versjon: '2026.3' });
  try {
    const html = b.html('publiser/index.html');
    assert.match(html, /Ottestad, T\. F\. \(2026\)\. <em>[^<]+<\/em> \(versjon 2026\.3\)\. https:\/\/fagkart\.example\.org\/demo-01\//);
    const kjem = /<ul class="kjem">([\s\S]*?)<\/ul>/.exec(html)[1];
    assert.deepEqual([...kjem.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]), ['Statistikk', 'Matematikk for økonomi']);
    assert.ok(!/<a /.test(kjem));
    assert.ok(!new RegExp('inn' + 'spel', 'i').test(html), 'the service for rooms is not linked'); // spelled in two parts: the open export forbids the word in files
    assert.ok(!/MAT1[12]-01/i.test(html));
    assert.ok(!/ · | — /.test(html.replace(/<style>[\s\S]*?<\/style>/, '')), 'no middle dot or dash as a separator in the text');
  } finally { b.done(); }
  const utanAar = build(['--offentlege=DEMO-01'], { versjon: 'utkast' });
  try { assert.match(utanAar.html('publiser/index.html'), /Ottestad, T\. F\.\. <em>/); } finally { utanAar.done(); }
});

test('the picture of the front page is built in for S2 only, and the page needs nothing from the net', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-landing-s2-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-landing-'));
  try {
    const data = JSON.parse(fs.readFileSync(path.join(viewerDir, 'fixtures', 'DEMO-01.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'S2.json'), JSON.stringify({ ...data, kode: 'S2' }));
    execFileSync(process.execPath, ['build.mjs', `--out=${out}`, `--adresse=${ADRESSE}`, '--offentlege=S2', path.join(dir, 'S2.json')], { cwd: viewerDir, stdio: 'pipe' });
    const html = fs.readFileSync(path.join(out, 'publiser', 'index.html'), 'utf8');
    assert.match(html, /<img src="s2-oversikt\.webp" width="960" height="600" alt="[^"]{20,}">/);
    assert.ok(fs.existsSync(path.join(out, 'publiser', 's2-oversikt.webp')) && fs.existsSync(path.join(out, 's2-oversikt.webp')));
    assert.ok(fs.statSync(path.join(out, 'publiser', 's2-oversikt.webp')).size < 60 * 1024, 'a small picture');
    assert.ok(!/(src|href)="https?:\/\/(?!github\.com|creativecommons\.org|lektorodd\.no)/.test(html), 'no external script, style or font');
    assert.ok(!/fonts\.googleapis|<script src=|<link rel="stylesheet"/.test(html));
    assert.match(html, /@font-face\{font-family:'Space Grotesk'/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
  const b = build(['--offentlege=DEMO-01']);
  try { assert.ok(!/<img /.test(b.html('publiser/index.html')), 'other maps: no S2 picture'); } finally { b.done(); }
});
