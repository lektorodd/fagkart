// Helper for the browser tests: builds one map with build.mjs into a temp folder and opens it in Chromium (playwright-core).
// The tests are skipped when no Chromium is installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const viewerDir = path.join(here, '..');
export const chromiumPath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
export const skip = fs.existsSync(chromiumPath) ? false : `no Chromium at ${chromiumPath}`;

// The walk-through for students (src/gjennomgang.js) would cover the page in the tests that open the student view: these tests start as if it was done.
// Pass opts.gjennomgang = true to see it. Browser contexts that a test makes itself: await ctx.addInitScript(TOUR_DONE).
export const TOUR_DONE = "try { localStorage.setItem('fagkart.gjennomgang', 'ferdig'); } catch (e) {}";

// jsonPath is relative to viewer/; extra = more build.mjs arguments (--lag=…); opts.viewport / opts.colorScheme / opts.reducedMotion / opts.init (a script that runs before the page) for the page
export async function openMap(jsonPath, extra = [], opts = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fagkart-test-'));
  const code = path.basename(jsonPath, '.json');
  // --adresse= (empty) overrides publisering.json: a test page never asks the real server about versions
  execFileSync(process.execPath, ['build.mjs', `--out=${out}`, '--adresse=', ...extra, jsonPath], { cwd: viewerDir, stdio: 'pipe' });
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const close = async () => { await browser.close(); fs.rmSync(out, { recursive: true, force: true }); };
  try {
    const page = await browser.newPage({ viewport: opts.viewport || { width: 1400, height: 900 }, colorScheme: opts.colorScheme || 'light', reducedMotion: opts.reducedMotion || 'no-preference' });
    if (!opts.gjennomgang) await page.addInitScript(TOUR_DONE);
    if (opts.init) await page.addInitScript(opts.init);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(pathToFileURL(path.join(out, `${code}.html`)).href);
    await page.waitForSelector('html[data-ready="1"]');
    await page.waitForTimeout(300);
    return { page, errors, close };
  } catch (e) { await close(); throw e; }
}
