// Screenshots for the blog draft (blogg/fagkart.md): the finished page dist/S2.html in the teacher and the student view, written to blogg/bilete/.
// Usage: node blogg-bilete.mjs [dist/KODE.html]   (build first: python3 scripts/bygg.py && npm run build)
// Not the screenshots of the tests (skjermbilete/): these are made for readers, with the marks of an invented example plan and invented self-assessments.
// No student data: the marks of "Kva kan eg?" and of the plan are made here, by this script, and only illustrate how the colours look.
// The picture of the front page (src/s2-oversikt.webp) is the Tema picture shrunk to 960 px: after a new run,
//   python3 -c "from PIL import Image; im=Image.open('../blogg/bilete/blogg-tema.png').convert('RGB'); im.resize((960,600), Image.LANCZOS).save('src/s2-oversikt.webp', quality=82, method=6)"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(process.argv[2] || path.join(here, '..', 'dist', 'S2.html'));
const code = path.basename(htmlPath, '.html');
const outDir = path.resolve(here, '..', 'blogg', 'bilete');
fs.mkdirSync(outDir, { recursive: true });
const N = (id) => `${code}/${id}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--allow-file-access-from-files'] });
async function open(query = '', viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'light', deviceScaleFactor: 1 });
  // the walk-through of the student view is done, so it does not cover the page
  await ctx.addInitScript("try { localStorage.setItem('fagkart.gjennomgang', 'ferdig'); } catch (e) {}");
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // the check for a newer version asks the web address built into the page: no network here is not a fault of the page
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/^Failed to load resource: net::ERR_/.test(m.text())) errors.push(m.text()); });
  await page.goto(pathToFileURL(htmlPath).href + query);
  await page.waitForSelector('html[data-ready="1"]');
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const level = async (page, l) => { await page.click(`#levelBtns button[data-level="${l}"]`); await page.waitForTimeout(1300); };
const select = (page, id) => page.evaluate((i) => window.__fk.select(i, { center: true }), N(id)).then(() => page.waitForTimeout(700));
const all = [];

// 1. The teacher view: Tema, Kart, and one tema opened
{
  const { ctx, page, errors } = await open();
  await shot(page, 'blogg-tema');
  await level(page, 'kart');
  await shot(page, 'blogg-kart');
  await level(page, 'tema');
  await page.evaluate(() => window.__fk.openTema('inferens'));
  await page.waitForTimeout(1500);
  await shot(page, 'blogg-temavising');
  all.push(...errors);
  await ctx.close();
}

// 2. The student view: the card of a node, then "Kva kan eg?" with some marks
{
  const { ctx, page, errors } = await open('?vising=elev');
  await level(page, 'detalj');
  await select(page, 'standardavvik');
  await shot(page, 'blogg-kort-elev');
  await page.click('#evBtn');
  await page.waitForTimeout(300);
  const marks = [
    ['sannsynsfordeling', 'heilt'], ['gjennomsnitt-standardavvik-data', 'heilt'], ['forventningsverdi', 'heilt'], ['varians', 'delvis'], ['standardavvik', 'delvis'],
    ['rekne-forventning-varians', 'delvis'], ['reknereglar-forventning-varians', 'ikkje'], ['binomisk-forventning-varians', 'delvis'],
    ['kontinuerleg-fordeling', 'ikkje'], ['simulere-fordeling', 'ikkje'], ['anvendingar-fordelingar', 'ikkje'],
  ];
  for (const [id, v] of marks) {
    await select(page, id);
    await page.click(`#panel [data-ev="${v}"]`);
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__fk.openTema('stokastikk'));
  await page.waitForTimeout(1500);
  await shot(page, 'blogg-kva-kan-eg');
  all.push(...errors);
  await ctx.close();
}

// 3. The teacher view with a plan: "Ny markering" with the yearly plan scale, some nodes marked
{
  const { ctx, page, errors } = await open();
  await page.click('#moreBtn');
  await page.waitForTimeout(300);
  await page.click('#side [data-layer="markering"] [data-mk-act="ny"]');
  await page.fill('#side [data-mk-nytt-namn]', 'Årsplan, døme');
  await page.click('#side [data-mk-act="lag"]');
  await page.waitForTimeout(300);
  await page.click('#moreBtn');
  await page.waitForTimeout(300);
  await level(page, 'kart');
  const plan = {
    '3': ['antiderivert', 'integrasjonsreglar', 'bestemt-integral', 'integral-areal', 'fundamentalteoremet'],
    '2': ['rekne-bestemt-integral', 'areal-mellom-grafar', 'integral-akkumulert-endring'],
    '1': ['delvis-integrasjon', 'integrasjonsteknikkar', 'numerisk-integrasjon', 'delbrokoppspalting'],
  };
  for (const [key, ids] of Object.entries(plan)) {
    for (const id of ids) {
      await select(page, id);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    }
  }
  await select(page, 'fundamentalteoremet');
  await shot(page, 'blogg-markering');
  all.push(...errors);
  await ctx.close();
}

await browser.close();
if (all.length) { console.error('Meldingar frå sida:\n' + all.join('\n')); process.exit(1); }
console.log(`Skjermbilete skrivne til ${path.relative(process.cwd(), outDir)}/`);
