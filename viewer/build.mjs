// Builds one self-contained HTML file per fagkart dist JSON.
// Also writes <KODE>.layout.json next to each HTML file, and takes <KODE>.endringar.json (the version log, scripts/endringar.py) in when it lies beside the input.
// Also writes <KODE>.versjon.json, sw.js and index.html (the front page: the maps of publisering.json "offentlege"), and the folder publiser/ laid out the way the maps are hosted
// (<adresse><kode-lowercase>/, e.g. fagkart.lektorodd.no/s2/; publishing, see README § Publisering), with the service innspel/ beside the maps,
// kart.json (the list of the maps) and <sti>/<KODE>.json (the data of each map).
// Usage: node build.mjs [--out=dir] [--adresse=url] [--offentlege=KODE,KODE] [--blogg=url] [--publisering=file.json] [--lag=layer.js ...] [file.json ...]   (default: ../dist/*.json, falling back to fixtures/DEMO-01.json)
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLayouts } from './layout.mjs';
import { texLabel } from './src/texlabel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith('--out='));
// --out=<dir> writes the HTML somewhere else than ../dist (for test builds)
const distDir = outArg ? path.resolve(outArg.slice(6)) : path.resolve(here, '..', 'dist');
const inputArgs = args.filter((a) => !a.startsWith('--'));
const read = (p) => fs.readFileSync(p, 'utf8');
// Function replacers: the inlined code contains "$&" style sequences that String.replace would interpret.
const put = (s, key, val) => s.split(key).join(val);

const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script');
const lib = [
  path.join(here, 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js'),
  path.join(here, 'node_modules', 'cytoscape-dagre', 'dist', 'cytoscape-dagre.min.js'),
  path.join(here, 'node_modules', 'katex', 'dist', 'katex.min.js'),
].map((p) => safeScript(read(p)).replace(/\/\/# sourceMappingURL=.*$/gm, '')).join('\n;\n');

function fontFace(pkg, file, family, weights, local) {
  const p = path.join(here, 'node_modules', '@fontsource-variable', pkg, 'files', file);
  const b64 = fs.readFileSync(p).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weights};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}
const fonts = [
  fontFace('space-grotesk', 'space-grotesk-latin-wght-normal.woff2', 'Space Grotesk', '300 700'),
  fontFace('source-sans-3', 'source-sans-3-latin-wght-normal.woff2', 'Source Sans 3', '200 900'),
  fontFace('jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2', 'JetBrains Mono', '100 800'),
].join('\n');

// KaTeX CSS with only the woff2 fonts, inlined as base64 (the page must work offline).
const katexDist = path.join(here, 'node_modules', 'katex', 'dist');
const katexCss = read(path.join(katexDist, 'katex.min.css')).replace(/src:url\(fonts\/([\w-]+)\.woff2\)[^;}]*/g, (_, f) =>
  `src:url(data:font/woff2;base64,${fs.readFileSync(path.join(katexDist, 'fonts', f + '.woff2')).toString('base64')}) format("woff2")`);
// texlabel.js, graph.js, tema.js, route.js, kartkantar.js, endringar.js and layers.js are ES modules for the tests; in the page their functions are plain globals.
const asGlobals = (file) => safeScript(read(path.join(here, 'src', file)).replace(/^export /gm, ''));
// A file of the lists below that does not exist is skipped, with one line on stderr: the open repository (scripts/offentleg.py) is exported without the service
// for rooms (src/innspel.js), the layer kommentarar and the layer faglogg. Nothing changes in the full repository, where every file is there.
// Files that are left out of a copy (the open repo has no rooms and no Faglogg layer) are skipped; the list is said once, at the end of the build.
const leftOut = [];
const existing = (files, dir = '') => files.filter((f) => fs.existsSync(path.join(here, 'src', dir, f)) || (leftOut.push(path.posix.join(dir, f)), false));
const modulesJs = existing(['texlabel.js', 'innspel.js', 'graph.js', 'tema.js', 'route.js', 'kartkantar.js', 'endringar.js', 'layers.js']).map(asGlobals).join('\n;\n');
// The built-in layers (src/lag/), in this order (eigenvurdering and markering after forkunnskap, so their fill colours win over the hole colours; kommentarar
// after eigenvurdering, so its badge joins theirs), then the extra ones from --lag=<file> (e.g. a test layer). They only use registerLayer.
const BUILTIN_LAYERS = existing(['forkunnskap.js', 'eigenvurdering.js', 'kommentarar.js', 'markering.js', 'faglogg.js', 'stiar.js', 'nestesteg.js', 'implisitte.js', 'koplingar.js', 'filter.js'], 'lag').map((f) => path.join(here, 'src', 'lag', f));
const extraLayers = args.filter((a) => a.startsWith('--lag=')).map((a) => path.resolve(a.slice(6)));
const layersJs = [...BUILTIN_LAYERS, ...extraLayers].map((p) => safeScript(read(p))).join('\n;\n');

const template = read(path.join(here, 'src', 'template.html'));
const css = read(path.join(here, 'src', 'style.css'));
const app = safeScript(read(path.join(here, 'src', 'app.js')));
const gjennomgang = safeScript(read(path.join(here, 'src', 'gjennomgang.js')));
const oppdatering = safeScript(read(path.join(here, 'src', 'oppdatering.js')));
// publisering.json in the repo root (optional): "adresse" (the web address of the published maps), "offentlege" (the codes of the maps the front page lists;
// without the key all built maps are listed) and "blogg" (the address of the blog post, left out of the front page when it is missing).
// Test builds override them: --adresse=<url>, --offentlege=<KODE,KODE> and --blogg=<url>; an argument with nothing after it overrides the file with "not decided".
function publishConfig() {
  let file = {};
  const fileArg = args.find((x) => x.startsWith('--publisering='));
  try { file = JSON.parse(read(fileArg ? path.resolve(fileArg.slice(14)) : path.resolve(here, '..', 'publisering.json'))); } catch (e) { if (e.code !== 'ENOENT') console.warn('publisering.json: kunne ikkje lesast, adressa er tom'); }
  const argOf = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a === undefined ? undefined : a.slice(name.length + 3); };
  const url = (key, raw) => {
    raw = String(raw ?? '').trim();
    if (raw && !/^https?:\/\//.test(raw)) { console.warn(`publisering.json: ${key} "${raw}" må starte med http:// eller https://, ho er tom`); return ''; }
    return raw;
  };
  let adresse = url('adressa', argOf('adresse') ?? file.adresse);
  if (adresse && !adresse.endsWith('/')) adresse += '/';
  const blogg = url('blogg', argOf('blogg') ?? file.blogg);
  // The maps on the front page: null = all of them. A key that is not a list of codes stops the build: a mistake must not publish every map.
  let offentlege = null;
  const rawOff = argOf('offentlege');
  if (rawOff !== undefined) offentlege = rawOff.trim() ? rawOff.split(',').map((c) => c.trim()).filter(Boolean) : null;
  else if (file.offentlege !== undefined) {
    if (!Array.isArray(file.offentlege) || file.offentlege.some((c) => typeof c !== 'string' || !c.trim())) throw new Error('publisering.json: "offentlege" må vere ei liste med kartkodar, til dømes ["S2"]');
    offentlege = file.offentlege.map((c) => c.trim());
  }
  return { adresse, blogg, offentlege };
}
const { adresse, blogg, offentlege } = publishConfig();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

// Fixed positions of the zoom surface, with and without the forkunnskap cluster (maps without nivaa are laid out flat, see layout.mjs).
// Computed here, never in the browser.
// The layout is a pure function of the data and of the code that computes it, and it takes a while (four layouts and their arrow routes),
// so the result is kept in a cache folder keyed by a hash of both. A changed map or a changed layout file is a new key.
const layoutCacheDir = path.join(os.tmpdir(), 'fagkart-layout-cache');
const layoutKey = (data) => {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(data));
  for (const f of ['layout.mjs', 'temalayout.mjs', 'metrics.mjs', path.join('src', 'route.js'), path.join('src', 'kartkantar.js'), path.join('src', 'texlabel.js')]) h.update(read(path.join(here, f)));
  return h.digest('hex');
};
async function layoutFor(data, label) {
  if (!data.nodar.some((n) => !n.utgaatt && n.type !== 'kompetansemaal')) return null;
  const file = path.join(layoutCacheDir, layoutKey(data) + '.json');
  try { return JSON.parse(read(file)); } catch (e) { /* no cached layout: compute it */ }
  const L = await computeLayouts(data);
  const problems = [...L.problems, ...(L.utanForkunnskap ? L.utanForkunnskap.problems.map((p) => 'without forkunnskap: ' + p) : []), ...(L.smal ? L.smal.problems.map((p) => 'upright: ' + p) : [])];
  for (const p of problems) console.warn(`${label}: layout: ${p}`);
  if (!problems.length) { try { fs.mkdirSync(layoutCacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(L)); } catch (e) { /* no cache folder: fine */ } }
  return L;
}

async function buildOne(jsonPath) {
  const raw = read(jsonPath);
  const data = JSON.parse(raw);
  if (data.format !== 'fagkart/1') throw new Error(`${jsonPath}: unknown format "${data.format}" (expected fagkart/1)`);
  // Output is named after the map (dist/<KART>.json), not the curriculum: one
  // curriculum (e.g. MAT04-02) can hold several maps (S1, S2).
  const code = path.basename(jsonPath, '.json');
  // Data lives in a type=application/json script, so only "<" needs escaping.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  // The version log beside the map (dist/<KODE>.endringar.json), or null: "Kva er nytt" in the help box reads it
  const logPath = path.join(path.dirname(jsonPath), `${code}.endringar.json`);
  const log = fs.existsSync(logPath) ? JSON.parse(read(logPath)) : null;
  const layoutObj = await layoutFor(data, code);
  const layout = JSON.stringify(layoutObj).replace(/</g, '\\u003c');
  let html = template;
  html = put(html, '__TITLE__', esc(`Fagkart ${texLabel(data.namn || '')} (${code})`));
  html = put(html, '/*__FONTS__*/', fonts);
  html = put(html, '/*__KATEXCSS__*/', katexCss);
  html = put(html, '/*__CSS__*/', css);
  html = put(html, '__DATA__', json);
  html = put(html, '__LAYOUT__', layout);
  html = put(html, '__ENDRINGAR__', JSON.stringify(log).replace(/</g, '\\u003c'));
  html = put(html, '/*__LIB__*/', lib);
  html = put(html, '/*__MODULES__*/', modulesJs);
  html = put(html, '/*__APP__*/', app);
  html = put(html, '/*__LAG__*/', layersJs);
  html = put(html, '/*__GJENNOMGANG__*/', gjennomgang);
  // The address of this map on the web: <adresse><sti>/, where sti is the map code in lowercase (fagkart.lektorodd.no/s2/)
  const sti = code.toLowerCase();
  const mapAddress = adresse ? `${adresse}${sti}/` : '';
  html = put(html, '/*__OPPDATERING__*/', put(oppdatering, "/*__ADRESSE__*/ ''", JSON.stringify(mapAddress).replace(/</g, '\\u003c')));
  fs.mkdirSync(distDir, { recursive: true });
  const out = path.join(distDir, `${code}.html`);
  fs.writeFileSync(out, html);
  // The same page as it is hosted: publiser/<sti>/index.html, with its version file and the service worker beside it
  const pubDir = path.join(distDir, 'publiser', sti);
  fs.mkdirSync(pubDir, { recursive: true });
  fs.writeFileSync(path.join(pubDir, 'index.html'), html);
  fs.writeFileSync(path.join(pubDir, `${code}.versjon.json`), JSON.stringify({ kart: code, versjon: String(data.versjon ?? '?'), fil: 'index.html' }) + '\n');
  fs.copyFileSync(path.join(here, 'src', 'sw.js'), path.join(pubDir, 'sw.js'));
  // The map data beside the page (publiser/<sti>/<KODE>.json): the page of innspel/ reads the node names from it. Public anyway, it is all in the HTML.
  fs.copyFileSync(jsonPath, path.join(pubDir, `${code}.json`));
  if (log) {
    fs.copyFileSync(logPath, path.join(pubDir, `${code}.endringar.json`));
    if (path.resolve(distDir, `${code}.endringar.json`) !== logPath) fs.copyFileSync(logPath, path.join(distDir, `${code}.endringar.json`));
  }
  console.log(`${path.relative(process.cwd(), out)}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB`);
  // The same layout object as in the HTML (no reshaping), for readers without a browser (Faglogg, Typst export). See docs/FORMAT.md.
  const layoutOut = path.join(distDir, `${code}.layout.json`);
  fs.writeFileSync(layoutOut, JSON.stringify({ format: 'fagkart-layout/1', kart: code, kartversjon: data.versjon ?? null, layout: layoutObj }) + '\n');
  console.log(`${path.relative(process.cwd(), layoutOut)}  ${(fs.statSync(layoutOut).size / 1024).toFixed(0)} kB`);
  // The version file the pages read to see whether a newer edition is out (oppdatering.js)
  const versjon = String(data.versjon ?? '?');
  fs.writeFileSync(path.join(distDir, `${code}.versjon.json`), JSON.stringify({ kart: code, versjon, fil: `${code}.html` }) + '\n');
  return { code, sti, namn: texLabel(data.namn || data.tittel || code), versjon };
}

let inputs = inputArgs.map((p) => path.resolve(p));
if (!inputs.length) {
  const jsonDir = path.resolve(here, '..', 'dist');
  // only the map files: dist/ also holds <KODE>.layout.json and <KODE>.versjon.json, which this build writes itself, and <KODE>.endringar.json (scripts/endringar.py)
  if (fs.existsSync(jsonDir)) inputs = fs.readdirSync(jsonDir).filter((f) => f.endsWith('.json') && !/\.(layout|versjon|endringar)\.json$/.test(f)).map((f) => path.join(jsonDir, f));
  if (!inputs.length) {
    console.log('Ingen dist/*.json funnen, bygger demokartet i staden.');
    inputs = [path.join(here, 'fixtures', 'DEMO-01.json')];
  }
}
const built = [];
for (const p of inputs) built.push(await buildOne(p));

// The service worker and the front page (src/index.html): the maps of "offentlege" (all built maps when the key is missing), each with a card, the picture of
// the map named in HERO, the links to the open repository and the blog post, and the way to cite a map. The maps not listed are built all the same and lie at their
// addresses. Written twice: dist/index.html (flat, for local use, links <KODE>.html) and publiser/index.html (as hosted, links <sti>/).
fs.copyFileSync(path.join(here, 'src', 'sw.js'), path.join(distDir, 'sw.js'));
const HERO = { kode: 'S2', file: 's2-oversikt.webp', alt: 'Matematikk S2 som tema: ein boks per tema, som Integrasjon og Funksjonsanalyse, med piler som viser kva som byggjer på kva.' };
const listed = offentlege === null ? built : built.filter((b) => offentlege.some((c) => c.toLowerCase() === b.code.toLowerCase()));
for (const c of offentlege || []) if (!built.some((b) => b.code.toLowerCase() === c.toLowerCase())) console.warn(`publisering.json: "${c}" i "offentlege" er ikkje blant karta som blei bygde`);
function landingPage(hrefOf) {
  const cards = listed.map((b) => `      <li><h3>${esc(b.namn)}</h3><span class="mono muted">${esc(b.code)}, versjon ${esc(b.versjon)}</span>`
    + `<span class="knappar"><a class="btn primar" href="${escAttr(hrefOf(b))}">Opne kartet</a><a class="btn" href="${escAttr(hrefOf(b))}?vising=elev">Elevvising</a></span></li>`).join('\n');
  const hasHero = listed.some((b) => b.code === HERO.kode) && fs.existsSync(path.join(here, 'src', HERO.file));
  const hero = hasHero ? `    <figure><img src="${HERO.file}" width="960" height="600" alt="${escAttr(HERO.alt)}"></figure>` : '';
  const bloggLink = blogg ? `      <li><a href="${escAttr(blogg)}">Blogginnlegget om fagkart</a></li>\n` : '';
  // "Ottestad, T. F. (2026). <name> (versjon 2026.3). <address>" for each map listed; the year is the one the version begins with
  const cite = listed.map((b) => {
    const year = /^(\d{4})\b/.exec(b.versjon);
    return `      <p>Ottestad, T. F.${year ? ` (${year[1]})` : ''}. <em>${esc(b.namn)}</em> (versjon ${esc(b.versjon)}).${adresse ? ` ${esc(adresse + b.sti + '/')}` : ''}</p>`;
  }).join('\n');
  let html = read(path.join(here, 'src', 'index.html'));
  html = put(html, '/*__FONTS__*/', fonts);
  html = put(html, '__BILETEKLASSE__', hasHero ? ' med-bilete' : '');
  html = put(html, '__BILETE__', hero);
  html = put(html, '__KART__', cards || '      <li><p>Ingen kart er klare enno.</p></li>');
  html = put(html, '__BLOGG__\n', bloggLink);
  html = put(html, '__SITERING__', cite);
  return html;
}
fs.writeFileSync(path.join(distDir, 'index.html'), landingPage((b) => `${encodeURI(b.code)}.html`));
const heroFile = path.join(here, 'src', HERO.file);
if (fs.existsSync(heroFile)) fs.copyFileSync(heroFile, path.join(distDir, HERO.file));
const pubRoot = path.join(distDir, 'publiser');
fs.writeFileSync(path.join(pubRoot, 'index.html'), landingPage((b) => `${b.sti}/`));
if (fs.existsSync(heroFile)) fs.copyFileSync(heroFile, path.join(pubRoot, HERO.file));
fs.copyFileSync(path.join(here, 'src', 'sw.js'), path.join(pubRoot, 'sw.js'));
// The list of the maps for the page of innspel/ (the choice of map in "Nytt rom", and the check of POST rom): publiser/kart.json
fs.writeFileSync(path.join(pubRoot, 'kart.json'), JSON.stringify(built.map((b) => ({ kode: b.code, namn: b.namn, versjon: b.versjon, sti: b.sti }))) + '\n');
// The service for shared rooms (innspel/, PHP) goes beside the maps: publiser/innspel/ (README § Publisering, innspel/README.md). Never the real
// config.php (it is made on the web host, outside git), no notes (README.md), and no test files or database files.
const innspelSrc = path.resolve(here, '..', 'innspel');
if (fs.existsSync(innspelSrc)) {
  const innspelOut = path.join(pubRoot, 'innspel');
  fs.rmSync(innspelOut, { recursive: true, force: true });
  fs.cpSync(innspelSrc, innspelOut, {
    recursive: true,
    filter: (src) => { const n = path.basename(src); return !/^\.?config(?!\.example\.php$)/i.test(n) && n !== 'README.md' && n !== 'test' && n !== 'tests' && !/\.(test|spec)\.|\.(sqlite3?|db|log|bak|old|orig|save|swp|swo|tmp)$|~$/i.test(n); },
  });
}
console.log(`${path.relative(process.cwd(), path.join(distDir, 'index.html'))}, sw.js, publiser/{${built.map((b) => b.sti).join(',')}}${adresse ? `  (adresse ${adresse})` : ''}`);
if (leftOut.length) console.log(`Utan ${leftOut.join(', ')} (finst ikkje i denne kopien)`);
