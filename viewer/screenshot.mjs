// Usage: node screenshot.mjs [dist/KODE.html]
// Opens the built viewer via file:// with the preinstalled Chromium and writes PNGs (and the poster PDF) to screenshots/.
// Walks the zoom surface: Tema (far out), Kart (middle) and Detalj (close up), the glide between them, the level buttons,
// a click on a tema box (the tema view: one tema at a time, with the grey nodes of other temaa), "Fleire val", the node card with closed and
// open sections, mobile, dark mode and the poster.
// Also checks the layout, that no arrow goes through a box (Tema, Kart and the tema view), the labels, the colours and the console.
// Exit code 1 when something is wrong. window.__fk is the debugging hook (state, Z = zoom anchors, KART = current level, goLevel ...).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(process.argv[2] || path.join(here, '..', 'dist', 'DEMO-01.html'));
const code = path.basename(htmlPath, '.html');
const outDir = path.join(here, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
const problems = [];
const requests = [];

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr || 1, colorScheme: opts.dark ? 'dark' : 'light', hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage();
  page.__touch = !!opts.touch;
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${m.type()} after ${globalThis.__step}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
  await page.goto(pathToFileURL(htmlPath).href + (opts.query || ''));
  await page.waitForSelector('html[data-ready="1"]');
  await page.waitForTimeout(400);
  return { ctx, page };
}
const shot = (page, name) => { globalThis.__step = name; return page.screenshot({ path: path.join(outDir, `${code}-${name}.png`) }); }
const wait = (page, ms = 450) => page.waitForTimeout(ms);

// Click an element of the graph by its position, like a user would.
async function clickEl(page, id) {
  const pos = await page.evaluate((nid) => {
    const cy = window.__cy, n = cy.getElementById(nid), r = document.getElementById('cy').getBoundingClientRect();
    let p = n.renderedPosition();
    // like a user panning: only move the view when the node is outside it
    if (p.x < 40 || p.y < 40 || p.x > r.width - 40 || p.y > r.height - 40) { cy.center(n); p = n.renderedPosition(); }
    return { x: r.left + p.x, y: r.top + p.y };
  }, id);
  if (page.__touch) await page.touchscreen.tap(pos.x, pos.y); else await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(500);
}
const lvl = (page) => page.evaluate(() => ({ level: window.__fk.KART.level, z: window.__cy.zoom(), sel: window.__fk.state.sel }));
const goBtn = async (page, level) => { await page.click(`#levelBtns button[data-level="${level}"]`); await wait(page, 1000); }; // from the tema view the way back takes a fade and a glide
// "Fleire val" is closed at the start: open it (and, when asked, the sections that start closed) before touching what is in it
const openMore = async (page, ...sections) => {
  if ((await page.evaluate(() => document.getElementById('app').dataset.more)) !== 'open') { await page.click('#moreBtn'); await wait(page, 250); }
  for (const t of sections) await page.evaluate((title) => { for (const d of document.querySelectorAll('#side details.sec')) if (d.querySelector('summary').textContent.trim().startsWith(title)) d.open = true; }, t);
  await wait(page, 100);
};
const closeMore = async (page) => {
  if ((await page.evaluate(() => document.getElementById('app').dataset.more)) === 'open') { await page.click('#moreBtn'); await wait(page, 250); }
};
// the switch "Vis forkunnskapar" is in "Fleire val": it is opened first and stays open until the next click on the map or the top bar
const toggleFk = async (page) => { await openMore(page); await page.locator('.switch:has(#swFk)').click(); };
const setMode = async (page, mode) => { await page.click(`#modeSeg button[data-mode="${mode}"]`); await wait(page, 300); };
// Pick the tema to drill into: sannsyn when the map has it, otherwise the first one that is not forkunnskap.
const pickCluster = (page) => page.evaluate(() => {
  const c = window.__fk.CLUSTERS;
  if (c.includes('sannsyn')) return 'sannsyn';
  const rest = c.filter((k) => k !== 'forkunnskap');
  return rest.length ? rest[0] : c[0];
});
// Automatic layout checks: overlapping real nodes and NaN positions
async function checkLayout(page, label) {
  const bad = await page.evaluate(() => {
    const out = [];
    const ns = window.__cy.nodes().filter((n) => !n.hasClass('hide') && !n.hasClass('ghost') && !n.hasClass('zoff') && !['carea', 'tframe', 'clabel', 'ctext'].includes(n.data('kind')));
    const bbs = ns.map((n) => ({ id: n.id(), b: n.boundingBox({ includeLabels: false, includeOverlays: false }) }));
    for (const n of window.__cy.nodes()) if (!Number.isFinite(n.position('x')) || !Number.isFinite(n.position('y'))) out.push('NaN ' + n.id());
    for (let i = 0; i < bbs.length; i++) for (let j = i + 1; j < bbs.length; j++) {
      const a = bbs[i].b, b = bbs[j].b;
      if (a.x1 < b.x2 - 1 && b.x1 < a.x2 - 1 && a.y1 < b.y2 - 1 && b.y1 < a.y2 - 1) out.push(`overlap ${bbs[i].id} / ${bbs[j].id}`);
    }
    return out;
  });
  for (const b of bad.slice(0, 8)) problems.push(`[layout] ${label}: ${b}`);
}
// Kart and Detalj: nodes at full size never overlap (also the ones that are hidden at this zoom), every label fits its box,
// and the tema areas hold their nodes and do not overlap each other.
async function checkKart(page, label) {
  const bad = await page.evaluate(() => {
    const out = [], cy = window.__cy;
    const rect = (n) => { const p = n.position(); return { x1: p.x - n.data('w0') / 2, y1: p.y - n.data('h0') / 2, x2: p.x + n.data('w0') / 2, y2: p.y + n.data('h0') / 2 }; };
    const ns = cy.nodes('[kind="node"]').toArray();
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const a = rect(ns[i]), b = rect(ns[j]);
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) out.push(`overlap ${ns[i].id()} / ${ns[j].id()}`);
    }
    const areas = cy.nodes('[kind="carea"]').toArray();
    for (const n of ns) {
      const r = rect(n), a = areas.find((x) => x.data('cid') === (n.data('grp')));
      if (!a) { out.push('no area for ' + n.id()); continue; }
      const p = a.position(), w = a.data('w'), h = a.data('h');
      if (r.x1 < p.x - w / 2 || r.x2 > p.x + w / 2 || r.y1 < p.y - h / 2 || r.y2 > p.y + h / 2) out.push(`outside its area ${n.id()}`);
    }
    for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) {
      const p = areas[i].position(), q = areas[j].position();
      if (Math.abs(p.x - q.x) < (areas[i].data('w') + areas[j].data('w')) / 2 && Math.abs(p.y - q.y) < (areas[i].data('h') + areas[j].data('h')) / 2) out.push(`areas overlap ${areas[i].id()} / ${areas[j].id()}`);
    }
    // labels: the text must fit inside its own box (only for nodes drawn as boxes right now)
    for (const n of cy.nodes('[kind="node"]').filter((x) => !x.hasClass('zoff') && x.data('lop') > 0.9)) {
      const lb = n.boundingBox({ includeLabels: true, includeNodes: false, includeEdges: false, includeOverlays: false });
      if (Number.isFinite(lb.w) && lb.w > n.data('cw') + 3) out.push(`label wider than its box ${n.id()} (${Math.round(lb.w)} > ${Math.round(n.data('cw'))})`);
    }
    return out;
  });
  for (const b of bad.slice(0, 10)) problems.push(`[kart] ${label}: ${b}`);
}
// Kart and Detalj: no arrow that is drawn goes through a node that is drawn (the ends touch the border of their own nodes, nothing more)
async function checkArrows(page, label) {
  const bad = await page.evaluate(() => {
    const out = [], cy = window.__cy;
    const rects = cy.nodes('[kind="node"]').filter((n) => !n.hasClass('zoff') && !n.hasClass('hide') && n.data('op') > 0.05).map((n) => {
      const p = n.position(), w = n.data('cw'), h = n.data('ch');
      return { id: n.id(), x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2 };
    });
    // a segment against the inside of a rectangle (slab test), the border itself does not count
    const hits = (ax, ay, bx, by, r, m) => {
      let t0 = 0, t1 = 1;
      for (const [p, d, lo, hi] of [[ax, bx - ax, r.x1 + m, r.x2 - m], [ay, by - ay, r.y1 + m, r.y2 - m]]) {
        if (Math.abs(d) < 1e-9) { if (p <= lo || p >= hi) return false; continue; }
        let u = (lo - p) / d, v = (hi - p) / d;
        if (u > v) [u, v] = [v, u];
        t0 = Math.max(t0, u); t1 = Math.min(t1, v);
        if (t0 >= t1) return false;
      }
      return true;
    };
    let n = 0;
    for (const e of cy.edges().filter((x) => x.data('kart') && !x.hasClass('zoff') && !x.hasClass('hide') && x.data('op') > 0.02)) {
      n++;
      const pts = e._private.rscratch.allpts;
      if (!e.data('rt') || !pts || pts.length < 4) { out.push(`arrow ${e.id()} has no route`); continue; }
      for (let i = 2; i + 1 < pts.length; i += 2) for (const r of rects) if (hits(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], r, 1.5)) out.push(`arrow ${e.id()} (${e.data('source')} -> ${e.data('target')}) goes through ${r.id}`);
    }
    if (!n) out.push('no arrows are drawn');
    return out;
  });
  for (const b of [...new Set(bad)].slice(0, 8)) problems.push(`[pilar] ${label}: ${b}`);
}
// The tema view: the frame holds the nodes of the tema, the grey ones are outside it and smaller, every label fits its box, only the arrows of
// the view are there, and no arrow that is drawn goes through a box that is drawn (the ends touch the border of their own boxes, nothing more)
async function checkTemaView(page, label, whole = true) {
  const bad = await page.evaluate((whole) => {
    const out = [], cy = window.__cy, fk = window.__fk, cid = fk.state.tema, TL = fk.temaLayout(cid);
    if (!cid || !TL) return ['the tema view is not open'];
    if (cy.nodes('[kind="carea"]').length) out.push('the areas of the surface are still there');
    const frame = cy.getElementById('f:' + cid);
    if (frame.empty()) return ['no frame'];
    const fp = frame.position(), fw = frame.data('w'), fh = frame.data('h');
    const nodes = cy.nodes('[kind="node"]').filter((n) => !n.hasClass('hide'));
    const rect = (n) => { const p = n.position(); return { id: n.id(), x1: p.x - n.data('w0') / 2, y1: p.y - n.data('h0') / 2, x2: p.x + n.data('w0') / 2, y2: p.y + n.data('h0') / 2 }; };
    const rects = nodes.map(rect);
    for (const n of nodes) {
      const r = rect(n), grey = n.data('grey'), inside = r.x1 >= fp.x - fw / 2 && r.x2 <= fp.x + fw / 2 && r.y1 >= fp.y - fh / 2 && r.y2 <= fp.y + fh / 2;
      if (!grey && !inside) out.push(`${n.id()} is outside the frame`);
      if (grey && (r.x1 < fp.x + fw / 2 && r.x2 > fp.x - fw / 2 && r.y1 < fp.y + fh / 2 && r.y2 > fp.y - fh / 2)) out.push(`grey ${n.id()} is on the frame`);
      if (grey && n.data('grp') === cid) out.push(`grey ${n.id()} belongs to the tema`);
      if (!grey && n.data('grp') !== cid) out.push(`${n.id()} does not belong to the tema`);
      const lb = n.boundingBox({ includeLabels: true, includeNodes: false, includeEdges: false, includeOverlays: false });
      if (Number.isFinite(lb.w) && lb.w > n.data('w0') + 3) out.push(`label wider than its box ${n.id()} (${Math.round(lb.w)} > ${Math.round(n.data('w0'))})`);
      if (Number.isFinite(lb.h) && !grey && lb.h > n.data('h0') + 3) out.push(`label taller than its box ${n.id()} (${Math.round(lb.h)} > ${Math.round(n.data('h0'))})`);
      if (grey && !cy.nodes('.ghost[role="cap"]').some((g) => g.data('of') === n.id())) out.push(`grey ${n.id()} has no name of its tema under it`);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) out.push(`overlap ${a.id} / ${b.id}`);
    }
    const ids = new Set(nodes.map((n) => n.id()));
    let drawn = 0;
    const through = (pts, r, m) => {
      for (let i = 2; i + 1 < pts.length; i += 2) {
        const x1 = Math.min(pts[i - 2], pts[i]), x2 = Math.max(pts[i - 2], pts[i]), y1 = Math.min(pts[i - 1], pts[i + 1]), y2 = Math.max(pts[i - 1], pts[i + 1]);
        if (x1 < r.x2 - m && x2 > r.x1 + m && y1 < r.y2 - m && y2 > r.y1 + m) return true;
      }
      return false;
    };
    for (const e of cy.edges().filter((x) => !x.hasClass('hide'))) {
      drawn++;
      const s = e.data('source'), t = e.data('target');
      if (!ids.has(s) || !ids.has(t)) { out.push(`arrow ${e.id()} ties a node that is not in the view`); continue; }
      const gs = cy.getElementById(s).data('grey'), gt = cy.getElementById(t).data('grey');
      if ((gs || gt) && (e.data('type') !== 'byggjer_paa' || (gs && gt))) out.push(`arrow ${e.id()} is not a byggjer_paa arrow between a grey node and the tema`);
      const pts = e._private.rscratch.allpts;
      if (!e.data('rt') || !pts || pts.length < 4) { out.push(`arrow ${e.id()} has no route`); continue; }
      for (const r of rects) if (through(pts, r, 1.5)) out.push(`arrow ${e.id()} (${s} -> ${t}) goes through ${r.id}`);
    }
    if (!drawn) out.push('no arrows are drawn');
    // at the start the whole view is inside the stage (a long view on a small screen reaches past the edge)
    if (whole) {
      const r = document.getElementById('cy').getBoundingClientRect(), b = cy.nodes('[kind="node"], [kind="tframe"]').renderedBoundingBox();
      if (b.x1 < -1 || b.y1 < -1 || b.x2 > r.width + 1 || b.y2 > r.height + 1) out.push('the whole view is not inside the stage');
    }
    return out;
  }, whole);
  for (const b of [...new Set(bad)].slice(0, 10)) problems.push(`[temavising] ${label}: ${b}`);
}
// Open a tema the way a user does (a click on its box on the surface), or by the hook when it is not in view
const openTemaView = async (page, cid, real = true) => {
  if (real && (await page.evaluate(() => window.__fk.KART.level)) === 'tema' && !(await page.evaluate(() => window.__fk.state.tema))) {
    const bp = await boxPos(page, cid);
    await page.mouse.click(bp.x, bp.y);
  } else await page.evaluate((c) => window.__fk.openTema(c), cid);
  await wait(page, 1000);
  if ((await page.evaluate(() => window.__fk.state.tema)) !== cid) problems.push(`[temavising] the tema ${cid} did not open`);
};
// Tema: the boxes sit inside their areas and apart, every text fits its box and is big enough to read, and no arrow runs through a box
// (arrows = false on a phone, where the whole map is wider than the screen and the boxes fill their areas)
async function checkTema(page, label, arrows = true) {
  const bad = await page.evaluate((arrows) => {
    const out = [], cy = window.__cy, TM = window.__fk.TM, L = window.__fk.LAYOUT, z = cy.zoom();
    const boxes = Object.entries(TM).filter(([cid]) => L.areas[cid]).map(([cid, t]) => {
      const a = L.areas[cid];
      return { cid, t, x1: a.x - t.cw / 2, x2: a.x + t.cw / 2, y1: a.y - t.ch / 2, y2: a.y + t.ch / 2, a };
    });
    for (const b of boxes) {
      if (b.t.cw > b.a.w || b.t.ch > b.a.h) out.push(`box ${b.cid} is bigger than its area`);
      const ar = cy.getElementById('a:' + b.cid);
      if (Math.abs(ar.data('cw') - b.t.cw) > 1 || Math.abs(ar.data('ch') - b.t.ch) > 1) out.push(`box ${b.cid} is not drawn at its size (${Math.round(ar.data('cw'))}x${Math.round(ar.data('ch'))})`);
      for (const [id, name] of [['l:', 'name'], ['m:', 'counts'], ['q:', 'goals']]) {
        const el = cy.getElementById(id + b.cid);
        if (el.empty() || el.hasClass('zoff') || !el.data('label')) continue;
        const lb = el.boundingBox({ includeLabels: true, includeNodes: false, includeEdges: false, includeOverlays: false });
        if (lb.x1 < b.x1 - 1 || lb.x2 > b.x2 + 1 || lb.y1 < b.y1 - 1 || lb.y2 > b.y2 + 1) out.push(`${name} of ${b.cid} does not fit its box`);
        if (el.data('fs') * z < 9.5 && b.a.w * z > 140) out.push(`${name} of ${b.cid} is only ${(el.data('fs') * z).toFixed(1)} px`);
      }
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) out.push(`boxes ${a.cid} / ${b.cid} overlap`);
    }
    // the arrows run in stretches (round-segments): their corner points are in allpts, and none of them may go through a box
    const through = (pts, b, m) => {
      for (let i = 2; i + 1 < pts.length; i += 2) {
        const x1 = Math.min(pts[i - 2], pts[i]), x2 = Math.max(pts[i - 2], pts[i]), y1 = Math.min(pts[i - 1], pts[i + 1]), y2 = Math.max(pts[i - 1], pts[i + 1]);
        if (x1 < b.x2 - m && x2 > b.x1 + m && y1 < b.y2 - m && y2 > b.y1 + m) return true;
      }
      return false;
    };
    const shown = cy.edges('[?meta]').filter((x) => !x.hasClass('zoff') && !x.hasClass('hide'));
    for (const e of arrows ? shown : []) {
      const pts = e._private.rscratch.allpts;
      if (!e.data('rt') || !pts || pts.length < 4) { out.push(`arrow ${e.data('src')} -> ${e.data('dst')} has no route`); continue; }
      for (const b of boxes) if (through(pts, b, 1.5 / z)) out.push(`arrow ${e.data('src')} -> ${e.data('dst')} runs through the box of ${b.cid}`);
    }
    // the number of an arrow: on the arrow, on no box and on no other number
    const labs = cy.nodes('[kind="mlab"]').filter((x) => !x.hasClass('zoff') && !x.hasClass('hide')).toArray();
    const lr = (n) => { const p = n.position(); return { x1: p.x - n.data('w') / 2, x2: p.x + n.data('w') / 2, y1: p.y - n.data('h') / 2, y2: p.y + n.data('h') / 2, id: n.data('of') }; };
    for (let i = 0; arrows && i < labs.length; i++) {
      const a = lr(labs[i]);
      for (const b of boxes) if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) out.push(`the number on arrow ${a.id} sits on the box of ${b.cid}`);
      for (let j = i + 1; j < labs.length; j++) { const c = lr(labs[j]); if (a.x1 < c.x2 && c.x1 < a.x2 && a.y1 < c.y2 && c.y1 < a.y2) out.push(`the numbers on ${a.id} and ${c.id} overlap`); }
    }
    return out;
  }, arrows);
  for (const b of bad.slice(0, 10)) problems.push(`[tema] ${label}: ${b}`);
}
// The whole map inside the stage (Tema at the start)
const wholeMapInside = (page) => page.evaluate(() => {
  const r = document.getElementById('cy').getBoundingClientRect(), b = window.__cy.nodes('[kind="carea"]').renderedBoundingBox();
  return b.x1 >= -1 && b.y1 >= -1 && b.x2 <= r.width + 1 && b.y2 <= r.height + 1;
});
// Colour of the border of each tema as [hue, saturation]: the same hue at every zoom
const temaHues = (page) => page.evaluate(() => {
  const out = {};
  for (const ar of window.__cy.nodes('[kind="carea"]')) {
    const m = ar.pstyle('border-color').strValue.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (!m) continue;
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const hue = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    out[ar.data('cid')] = { hue: hue * 60, sat: d / (1 - Math.abs(mx + mn - 1) || 1) };
  }
  return out;
});
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
// The zoom to a level (or a mix of two), around a point of the map: the surface answers to the zoom alone
const zoomAt = async (page, z, centre) => {
  await page.evaluate(({ z, centre }) => {
    const cy = window.__cy;
    if (centre) cy.viewport({ zoom: z, pan: { x: cy.width() / 2 - centre.x * z, y: cy.height() / 2 - centre.y * z } });
    else cy.zoom({ level: z, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }, { z, centre });
  await wait(page, 500);
};
const Zs = (page) => page.evaluate(() => ({ ...window.__fk.Z }));
const areaCentre = (page, cid) => page.evaluate((c) => { const a = window.__fk.LAYOUT.areas[c]; return a ? { x: a.x, y: a.y } : null; }, cid);
// The middle of a tema box on the screen (page coordinates), for a real click
const boxPos = (page, cid) => page.evaluate((c) => {
  const r = document.getElementById('cy').getBoundingClientRect(), p = window.__cy.getElementById('a:' + c).renderedPosition();
  return { x: r.left + p.x, y: r.top + p.y };
}, cid);

// ---------- Desktop ----------
{
  const { ctx, page } = await open({ width: 1400, height: 900 });
  const first = await lvl(page);
  const Z = await Zs(page);
  if (first.level !== 'tema') problems.push('[tema] the map does not start at the Tema level: ' + JSON.stringify(first));
  if (Math.abs(Z.t - first.z) > 0.001) problems.push(`[tema] start zoom ${first.z} is not the Tema zoom ${Z.t}`);
  if (!(await wholeMapInside(page))) problems.push('[tema] the whole map is not inside the stage at the start');
  for (const t of ['Tema', 'Kart', 'Detalj']) if (!(await page.$(`#levelBtns button:text-is("${t}")`))) problems.push(`[ui] no button ${t}`);
  // at the start only the top bar and the map are there: "Fleire val", the card, the legend and the chip for a chosen goal are closed
  const shownAtStart = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && !e.hidden && r.width > 0 && r.height > 0; };
    return { top: [...document.querySelector('.top').children].filter(vis).map((e) => e.id || e.className.split(' ')[0]), more: vis(document.getElementById('side')), panel: vis(document.getElementById('panel')), help: vis(document.getElementById('helpBox')), chip: vis(document.getElementById('focusChip')) };
  });
  if (shownAtStart.more || shownAtStart.panel || shownAtStart.help || shownAtStart.chip) problems.push('[ui] more than the top bar and the map at the start: ' + JSON.stringify(shownAtStart));
  if (shownAtStart.top.join() !== 'brand,levelBtns,search,modeSeg,moreBtn') problems.push('[ui] the top bar is not the name, the zoom buttons, the search, Lærar | Elev and Fleire val: ' + shownAtStart.top.join());
  if (!(await page.$('#helpBtn'))) problems.push('[ui] no ? button for the legend');
  if ((await page.$('#viewTabs')) || (await page.$('#zFit'))) problems.push('[ui] the old view tabs or Tilpass are still there');
  await shot(page, 'tema');
  await checkTema(page, 'start');
  const hues0 = await temaHues(page);
  const cid = await pickCluster(page);
  const c = await areaCentre(page, cid);

  // the glide: Tema -> Kart -> Detalj in small steps; nothing moves, the colours stay, nothing breaks on the way
  const steps = [[0.25, 'overgang-1'], [0.5, 'overgang-2'], [0.8, 'overgang-3']];
  for (const [f, name] of steps) {
    await zoomAt(page, Z.t + (Z.k - Z.t) * f, c);
    await shot(page, name);
    const now = await temaHues(page), moved = await page.evaluate(() => {
      const L = window.__fk.LAYOUT;
      return window.__cy.nodes('[kind="carea"]').filter((a) => Math.abs(a.position('x') - L.areas[a.data('cid')].x) > 0.5 || Math.abs(a.position('y') - L.areas[a.data('cid')].y) > 0.5).map((a) => a.id());
    });
    if (moved.length) problems.push(`[glide] areas moved at ${name}: ${moved.join(', ')}`);
    for (const [k, v] of Object.entries(hues0)) if (k !== 'forkunnskap' && now[k] && hueGap(v.hue, now[k].hue) > 6) problems.push(`[glide] colour of ${k} changes hue at ${name} (${Math.round(v.hue)} -> ${Math.round(now[k].hue)})`);
    await checkLayout(page, name);
  }
  await zoomAt(page, Z.k, c);
  const mid = await lvl(page);
  if (mid.level !== 'kart') problems.push('[kart] zoom Kart is not the Kart level: ' + JSON.stringify(mid));
  await shot(page, 'kart');
  await checkKart(page, 'kart');
  await checkArrows(page, 'kart');
  await checkLayout(page, 'kart');
  const huesK = await temaHues(page);
  for (const [k, v] of Object.entries(hues0)) if (k !== 'forkunnskap' && hueGap(v.hue, huesK[k].hue) > 6) problems.push(`[kart] colour of ${k} differs between Tema and Kart (${Math.round(v.hue)} / ${Math.round(huesK[k].hue)})`);
  const lv1 = await page.evaluate(() => window.__cy.nodes('[lvl=1]').filter((n) => !n.hasClass('zoff')).length);
  if (!lv1) problems.push('[kart] no level 1 nodes are shown at Kart');
  // close up: the satellites show
  await zoomAt(page, Z.d, c);
  await shot(page, 'detalj-' + cid);
  const near = await page.evaluate(() => ({ level: window.__fk.KART.level, l2: window.__cy.nodes('[lvl=2]').filter((n) => !n.hasClass('zoff')).length }));
  const hasL2 = await page.evaluate(() => window.__cy.nodes('[lvl=2]').length > 0); // a flat map has no satellites
  if (near.level !== 'detalj' || (hasL2 && !near.l2)) problems.push('[detalj] close up does not show the satellites: ' + JSON.stringify(near));
  await checkKart(page, 'detalj');
  await checkArrows(page, 'detalj');
  // a node is chosen: the panel opens and the neighbours are highlighted
  const pick = await page.evaluate(() => {
    const ns = window.__cy.nodes('[kind="node"][lvl=1]').filter((n) => !n.hasClass('zoff') && n.renderedPosition().x > 150 && n.renderedPosition().x < 1100 && n.renderedPosition().y > 80 && n.renderedPosition().y < 700);
    return ns.sort((a, b) => b.degree() - a.degree())[0].id();
  });
  await clickEl(page, pick);
  const sel = await lvl(page);
  if (sel.sel !== pick) problems.push('[detalj] click on a node did not select it: ' + JSON.stringify(sel));
  if ((await page.evaluate(() => window.__cy.edges('.nbr').length)) < 1) problems.push('[detalj] selected node has no highlighted edges');
  await shot(page, 'detalj-node-vald');
  // the card: the sections start closed; what is opened is remembered for the next node
  const folds = await page.evaluate(() => [...document.querySelectorAll('#panel .fold')].map((d) => ({ key: d.dataset.fold, open: d.open })));
  if (!folds.length || folds.some((f) => f.open)) problems.push('[kort] the sections of the card are not closed at the start: ' + JSON.stringify(folds));
  await page.evaluate(() => document.querySelectorAll('#panel .fold > summary').forEach((sm) => sm.click()));
  await wait(page, 200);
  await shot(page, 'kort-opna');
  await page.keyboard.press('Escape');
  const other = await page.evaluate((id) => { const n = window.__cy.nodes('[kind="node"][lvl=1]').filter((x) => x.id() !== id && !x.hasClass('zoff'))[0]; window.__fk.select(n.id(), { center: false }); return n.id(); }, pick);
  await wait(page, 300);
  const again = await page.evaluate(() => [...document.querySelectorAll('#panel .fold')].filter((d) => d.open).length);
  if (!again) problems.push('[kort] the sections that were opened are not open on the next node: ' + other);
  await page.evaluate(() => document.querySelectorAll('#panel .fold[open] > summary').forEach((sm) => sm.click())); // leave the storage as it was
  await page.keyboard.press('Escape');
  // the "?" in the corner: what the arrows mean
  await page.click('#helpBtn');
  await wait(page, 200);
  await shot(page, 'teiknforklaring');
  if (!(await page.$('#helpBox #legend .legrow[data-et="byggjer_paa"]'))) problems.push('[ui] the legend lacks the arrow «byggjer på»');
  await page.click('#helpBtn');

  // the level buttons are shortcuts to the zoom levels
  for (const [level, key] of [['tema', 'tema'], ['detalj', 'detalj'], ['kart', 'kart']]) {
    await goBtn(page, level);
    const r = await page.evaluate(() => ({ level: window.__fk.KART.level, pressed: [...document.querySelectorAll('#levelBtns button[aria-pressed="true"]')].map((b) => b.dataset.level) }));
    if (r.level !== key || r.pressed.join() !== key) problems.push(`[knappar] ${level}: ${JSON.stringify(r)}`);
  }
  const zk = await Zs(page);
  if (Math.abs((await lvl(page)).z - zk.k) > 0.01) problems.push('[knappar] Kart does not zoom to the Kart anchor');
  await goBtn(page, 'tema');
  if (!(await wholeMapInside(page))) problems.push('[knappar] Tema does not show the whole map');
  await shot(page, 'tema-knapp');
  // wheel: zooming with the mouse glides on from Tema to Kart
  await page.mouse.move(700, 480);
  const z0 = (await lvl(page)).z;
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
  await wait(page, 300);
  if (!((await lvl(page)).z > z0 * 1.1)) problems.push('[hjul] the mouse wheel did not zoom in');
  await goBtn(page, 'tema');
  // a click on a tema box opens the tema view: one tema at a time, the grey nodes of other temaa around it
  await openTemaView(page, cid);
  await shot(page, 'temavising');
  await checkTemaView(page, cid);
  await checkLayout(page, 'temavising');
  const tv = await page.evaluate(() => ({ pressed: [...document.querySelectorAll('#levelBtns button[aria-pressed="true"]')].length, bar: !document.getElementById('temaBar').hidden, name: document.getElementById('temaName').textContent, hint: document.getElementById('hint').textContent }));
  if (tv.pressed || !tv.bar || !tv.name) problems.push('[temavising] the bar or the level buttons are wrong: ' + JSON.stringify(tv));
  // every tema of the map, the forkunnskap one too: nothing overlaps, every arrow keeps clear of the boxes
  for (const other of await page.evaluate(() => window.__fk.CLUSTERS.slice())) {
    if (other !== cid) await openTemaView(page, other, false);
    await checkTemaView(page, other);
  }
  // a click on a grey node opens the tema it belongs to, with the node chosen
  await openTemaView(page, cid, false);
  const grey = await page.evaluate(() => { const g = window.__cy.nodes('.grey')[0]; return g ? { id: g.id(), grp: g.data('grp') } : null; });
  if (grey) {
    await clickEl(page, grey.id);
    await wait(page, 900);
    const r = await page.evaluate(() => ({ tema: window.__fk.state.tema, sel: window.__fk.state.sel }));
    if (r.tema !== grey.grp || r.sel !== grey.id) problems.push('[temavising] a click on a grey node did not open its tema with the node chosen: ' + JSON.stringify({ r, grey }));
    await shot(page, 'temavising-grau-klikk');
    await checkTemaView(page, 'after a grey click', false);
    await page.keyboard.press('Escape');
  }
  // "Alle tema" and Escape go back
  await page.click('#temaBack');
  await wait(page, 1000);
  if ((await page.evaluate(() => window.__fk.state.tema)) !== null || (await lvl(page)).level !== 'tema') problems.push('[temavising] "Alle tema" did not go back to Tema: ' + JSON.stringify(await lvl(page)));
  await openTemaView(page, cid, false);
  await page.keyboard.press('Escape');
  await wait(page, 1000);
  if ((await page.evaluate(() => window.__fk.state.tema)) !== null) problems.push('[temavising] Escape did not go back');
  await shot(page, 'temavising-tilbake');
  // search zooms to a satellite
  const sat = await page.evaluate(() => {
    const n = window.__cy.nodes('[lvl=2]').filter((x) => !x.data('fk'))[0] || window.__cy.nodes('[kind="node"]').filter((x) => !x.data('fk'))[0];
    return { id: n.id(), name: n.data('label').split('\n')[0] };
  });
  await goBtn(page, 'tema');
  await page.fill('#q', sat.name);
  await page.keyboard.press('Enter');
  await wait(page, 800);
  const afterSearch = await page.evaluate((id) => {
    const n = window.__cy.getElementById(id), r = document.getElementById('cy').getBoundingClientRect(), p = n.renderedPosition();
    return { sel: window.__fk.state.sel, zoff: n.hasClass('zoff'), inside: p.x > 0 && p.y > 0 && p.x < r.width && p.y < r.height, level: window.__fk.KART.level, lvl: n.data('lvl') };
  }, sat.id);
  if (!afterSearch.sel || afterSearch.zoff || !afterSearch.inside || (afterSearch.lvl === 2 && afterSearch.level !== 'detalj')) problems.push('[sok] search did not zoom to the node: ' + JSON.stringify(afterSearch));
  await shot(page, 'sok');
  await page.keyboard.press('Escape');
  // 1P: holes in the forkunnskap, badges on what is new, and the counts on the tema boxes
  await goBtn(page, 'tema');
  await openMore(page);
  await page.click('#fagSeg button[data-fag]:not([data-fag="alle"])');
  await wait(page, 500);
  await shot(page, 'fleire-val');
  await closeMore(page);
  await shot(page, 'tema-1P');
  await checkTema(page, '1P');
  await goBtn(page, 'kart');
  await shot(page, 'kart-1P');
  // the tema view with 1P chosen: "nytt for" on the nodes of the tema, holes in the forkunnskap tema, the grey nodes stay grey
  await goBtn(page, 'tema');
  await openTemaView(page, cid, false);
  await shot(page, 'temavising-1P');
  await checkTemaView(page, '1P');
  const marks = await page.evaluate(() => ({ badges: window.__cy.nodes('.ghost[role^="pill-"]').length, greyMarked: window.__cy.nodes('.grey').filter((n) => n.hasClass('hole-nei') || n.hasClass('hole-delvis') || n.hasClass('fkok')).length }));
  if (marks.greyMarked) problems.push('[temavising] a grey node is marked by the 1P layer: ' + JSON.stringify(marks));
  if (await page.evaluate(() => window.__fk.CLUSTERS.includes('forkunnskap'))) {
    await openTemaView(page, 'forkunnskap', false);
    await shot(page, 'temavising-forkunnskap-1P');
    const holes = await page.evaluate(() => window.__cy.nodes('.hole-nei, .hole-delvis').length);
    if (!holes) problems.push('[temavising] no holes are marked in the forkunnskap tema with 1P chosen');
    await checkTemaView(page, 'forkunnskap 1P');
    await openTemaView(page, cid, false);
  }
  // a node chosen: its arrows and neighbours stay, the rest dims; the card opens beside the view
  const hub = await page.evaluate(() => window.__cy.nodes('[kind="node"]').filter((n) => !n.data('grey') && n.data('lvl') === 1).sort((a, b) => b.degree() - a.degree())[0].id());
  await clickEl(page, hub);
  await wait(page, 500);
  const picked = await page.evaluate(() => ({ sel: window.__fk.state.sel, nbr: window.__cy.edges('.nbr').length, dim: window.__cy.nodes('[kind="node"].dim').length, tema: window.__fk.state.tema }));
  if (picked.sel !== hub || !picked.nbr || !picked.dim || !picked.tema) problems.push('[temavising] a chosen node does not light its arrows: ' + JSON.stringify(picked));
  await shot(page, 'temavising-node-vald');
  await checkTemaView(page, 'with a node chosen', false);
  await page.keyboard.press('Escape');
  // a competence goal of the tema, from the bar: its nodes are lit
  const chip = page.locator('#temaGoals .kmchip').first();
  if (await chip.count()) {
    await chip.click();
    await wait(page, 400);
    await shot(page, 'temavising-km');
    if (!(await page.evaluate(() => window.__fk.state.km && window.__fk.state.tema))) problems.push('[temavising] a goal from the bar left the tema view or chose nothing');
    await page.keyboard.press('Escape');
  }
  await goBtn(page, 'tema');
  await openMore(page);
  await page.click('#fagSeg button[data-fag="alle"]');
  await closeMore(page);
  // a competence goal: far out the temaa that cover it are lit, close up the nodes that serve it
  await goBtn(page, 'tema');
  await openMore(page, 'Kompetansemål');
  await page.locator('#kmList .kmitem').first().click();
  await wait(page, 900);
  await shot(page, 'km');
  const dimmed = await page.evaluate(() => window.__fk.KART.dim.size);
  if (!dimmed && (await page.evaluate(() => window.__fk.CLUSTERS.length)) > 2) problems.push('[km] choosing a goal dims no tema box far out');
  await page.keyboard.press('Escape');
  // the elev view and a filter: what does not match is faded
  await goBtn(page, 'kart');
  await setMode(page, 'elev');
  await openMore(page, 'Filter');
  await page.locator('#chType .chip').first().click();
  await wait(page, 300);
  await closeMore(page);
  await shot(page, 'filter-elev');
  await setMode(page, 'laerar');
  await openMore(page, 'Filter');
  await page.locator('#clearFilters').click();
  await closeMore(page);
  // the poster: the Kart level on an A3 sheet, landscape
  await goBtn(page, 'tema');
  const ok = await page.evaluate(() => window.__fk.preparePoster());
  if (!ok) problems.push('[print] preparePoster() gave nothing');
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(outDir, `${code}-plakat.pdf`), format: 'A3', landscape: true, printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', path.join(outDir, `${code}-plakat.pdf`), path.join(outDir, `${code}-plakat`)]);
  const pages = execFileSync('pdfinfo', [path.join(outDir, `${code}-plakat.pdf`)]).toString();
  if (!/Pages:\s+1\b/.test(pages)) problems.push('[print] the poster is not exactly one page: ' + pages.match(/Pages:.*/));
  const size = pages.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/);
  if (!size || !(+size[1] > 1180 && +size[1] < 1200 && +size[2] > 835 && +size[2] < 850)) problems.push('[print] the poster page is not A3 landscape: ' + (size && size[0]));
  // the grey words of graph theory must not show in the page
  await openMore(page);
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  // only the words of the page itself: the names of concepts and goals (a concept may well be called "graf") are the content of the map
  const words = await page.evaluate(() => {
    const content = [...document.querySelectorAll('#allList, #kmList, #results, #panel, #cy, #poster')];
    content.forEach((e) => e.setAttribute('data-was-hidden', e.hidden ? '1' : '0'));
    content.forEach((e) => { e.hidden = true; });
    const attrs = [...document.querySelectorAll('[placeholder],[aria-label],[title],[alt]')].flatMap((e) => ['placeholder', 'aria-label', 'title', 'alt'].map((a) => e.getAttribute(a)).filter(Boolean));
    const text = document.body.innerText + '\n' + attrs.join('\n') + '\n' + document.getElementById('fagNote').textContent;
    content.forEach((e) => { e.hidden = e.getAttribute('data-was-hidden') === '1'; e.removeAttribute('data-was-hidden'); });
    return text.match(/\b(nodar?|nodane|nodes?|kantar?|kantane|klynge|klyngjer|klynga|graf)\b/gi) || [];
  });
  if (words.length) problems.push('[ord] graph words in the page text: ' + [...new Set(words)].join(', '));
  await ctx.close();
}
// "Vis forkunnskapar" switched off (?forkunnskap=av): nothing of the forkunnskap tema may be left at any level
{
  const { ctx, page } = await open({ width: 1400, height: 900 }, { query: '?forkunnskap=av' });
  const info = await page.evaluate(() => ({ hasFk: window.__fk.CLUSTERS.includes('forkunnskap'), showFk: window.__fk.state.showFk }));
  if (info.hasFk) {
    if (info.showFk) problems.push('[forkunnskap] ?forkunnskap=av did not switch the forkunnskap off');
    const left = () => page.evaluate(() => {
      const cy = window.__cy, bad = cy.nodes().filter((n) => n.data('fk') || n.data('cid') === 'forkunnskap' || n.data('grp') === 'forkunnskap');
      const arrows = cy.edges('[?meta]').filter((e) => e.data('src') === 'forkunnskap' || e.data('dst') === 'forkunnskap');
      return [...bad.map((n) => n.id()), ...arrows.map((e) => e.id())].slice(0, 5);
    });
    const noFk = async (label) => { const l = await left(); if (l.length) problems.push(`[forkunnskap] ${label}: forkunnskap elements left: ${l.join(', ')}`); };
    const sw = await page.evaluate(() => document.getElementById('swFk').checked);
    if (sw) problems.push('[forkunnskap] the switch is on although the forkunnskap is off');
    // the data the page carries: an in-subject node that builds on forkunnskap (its card lists the hidden prerequisite, greyed)
    const probe = await page.evaluate(() => {
      const d = JSON.parse(document.getElementById('fagkart-data').textContent), by = new Map(d.nodar.map((n) => [n.id, n]));
      const cnt = new Map();
      for (const k of d.kantar) if (k.type === 'byggjer_paa' && !k.implisitt && by.get(k.fra) && by.get(k.til) && !by.get(k.fra).forkunnskap && by.get(k.til).forkunnskap && by.get(k.fra).type !== 'kompetansemaal') cnt.set(k.fra, (cnt.get(k.fra) || 0) + 1);
      const best = [...cnt].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return { id: best && best[0], fag: (d.forkunnskapsfag || [])[0] };
    });
    await shot(page, 'fk-av-tema');
    await checkTema(page, 'forkunnskap av');
    await noFk('tema');
    if (!(await wholeMapInside(page)) || (await page.evaluate(() => window.__fk.LAYOUT !== window.__fk.LAYOUT_NOFK))) problems.push('[forkunnskap] the map without forkunnskap is not fitted inside the stage');
    await goBtn(page, 'kart');
    await shot(page, 'fk-av-kart');
    await checkKart(page, 'forkunnskap av');
    await checkArrows(page, 'forkunnskap av');
    await checkLayout(page, 'kart forkunnskap av');
    await noFk('kart');
    if (probe.id) {
      await page.evaluate((id) => window.__fk.select(id, { center: true }), probe.id);
      await wait(page, 600);
      const card = await page.evaluate(() => ({ off: [...document.querySelectorAll('#panel .linkoff')].map((e) => e.textContent), links: document.querySelectorAll('#panel .linkbtn').length }));
      if (!card.off.length || !card.off.every((t) => t.includes('(forkunnskap)'))) problems.push('[forkunnskap] the node card does not list the hidden prerequisite greyed: ' + JSON.stringify(card));
      await shot(page, 'fk-av-kart-node');
      await page.keyboard.press('Escape');
    }
    // 1P/1T: badges on in-subject nodes stay, the hole counts for forkunnskap are gone
    if (probe.fag) {
      await openMore(page);
      await page.click(`#fagSeg button[data-fag="${probe.fag}"]`);
      await wait(page, 500);
      const f = await page.evaluate(() => ({ badges: window.__cy.nodes('.ghost[role^="pill-"]').length, holes: window.__cy.nodes('.hole-nei, .hole-delvis').length, note: document.getElementById('fagNote').textContent }));
      if (f.holes || /manglar heilt/.test(f.note)) problems.push('[forkunnskap] hole counts are still shown with forkunnskap off: ' + JSON.stringify(f));
      await shot(page, 'fk-av-kart-fag');
      await page.click('#fagSeg button[data-fag="alle"]');
      await closeMore(page);
    }
    // the poster: A3, one page
    if (!(await page.evaluate(() => window.__fk.preparePoster()))) problems.push('[print] preparePoster() gave nothing with forkunnskap off');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(outDir, `${code}-plakat-fk-av.pdf`), format: 'A3', landscape: true, printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: 'screen' });
    execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', path.join(outDir, `${code}-plakat-fk-av.pdf`), path.join(outDir, `${code}-plakat-fk-av`)]);
    const pg = execFileSync('pdfinfo', [path.join(outDir, `${code}-plakat-fk-av.pdf`)]).toString();
    if (!/Pages:\s+1\b/.test(pg)) problems.push('[print] the poster without forkunnskap is not exactly one page: ' + pg.match(/Pages:.*/));
    // the switch at Kart: fade and glide to the full map and back, in about 400 ms
    await goBtn(page, 'kart');
    const off = await page.evaluate(() => ({ n: window.__cy.nodes().length, e: window.__cy.edges().length }));
    await toggleFk(page);
    await wait(page, 120);
    const mid = await page.evaluate(() => ({ fade: window.__fk.KART.fade, animating: window.__fk.KART.fade > 0 && window.__fk.KART.fade < 1 }));
    if (!mid.animating) problems.push('[forkunnskap] no glide 120 ms after the switch: ' + JSON.stringify(mid));
    await shot(page, 'fk-pa-glid');
    await wait(page, 450);
    const on = await page.evaluate(() => ({ n: window.__cy.nodes().length, e: window.__cy.edges().length, fk: window.__cy.nodes('[?fk]').length, full: window.__fk.LAYOUT === window.__fk.LAYOUT_FULL, fade: window.__fk.KART.fade }));
    if (!on.fk || on.n <= off.n || on.e <= off.e || !on.full || on.fade !== 1) problems.push('[forkunnskap] switching on did not bring the forkunnskap back: ' + JSON.stringify({ off, on }));
    await checkKart(page, 'forkunnskap på igjen');
    await checkArrows(page, 'forkunnskap på igjen');
    await goBtn(page, 'tema');
    await checkTema(page, 'forkunnskap på igjen');
    await goBtn(page, 'kart');
    await toggleFk(page);
    await wait(page, 600);
    const off2 = await page.evaluate(() => ({ n: window.__cy.nodes().length, e: window.__cy.edges().length }));
    if (off2.n !== off.n || off2.e !== off.e) problems.push('[forkunnskap] off, on, off does not give the same map: ' + JSON.stringify({ off, off2 }));
    await noFk('kart after on/off');
    await checkKart(page, 'forkunnskap av igjen');
    await checkArrows(page, 'forkunnskap av igjen');
    // at Tema the switch builds the map again
    await goBtn(page, 'tema');
    await toggleFk(page);
    await wait(page, 600);
    if (!(await page.evaluate(() => window.__cy.nodes('[?fk]').length))) problems.push('[forkunnskap] the switch at Tema did not bring the forkunnskap back');
    await checkTema(page, 'forkunnskap på ved Tema');
    await toggleFk(page);
    await wait(page, 600);
    await noFk('tema after on/off');
    await checkTema(page, 'forkunnskap av ved Tema');
    // remembered per viewer: off survives a reload without the URL parameter, on is remembered too
    await toggleFk(page);
    await wait(page, 500);
    const url = page.url().split('?')[0];
    await page.goto(url);
    await page.waitForSelector('html[data-ready="1"]');
    if (!(await page.evaluate(() => window.__fk.state.showFk))) problems.push('[forkunnskap] the choice (on) was not remembered');
    await page.evaluate(() => window.__fk.setShowFk(false));
    await wait(page, 500);
    await page.goto(url);
    await page.waitForSelector('html[data-ready="1"]');
    if (await page.evaluate(() => window.__fk.state.showFk)) problems.push('[forkunnskap] the choice (off) was not remembered');
    await noFk('after reload');
    await page.evaluate(() => window.__fk.setShowFk(true)); // leave the storage clean for the next run
  }
  await ctx.close();
}
// Dark
{
  const { ctx, page } = await open({ width: 1400, height: 900 }, { dark: true });
  await shot(page, 'tema-dark');
  await checkTema(page, 'dark');
  const Z = await Zs(page), cid = await pickCluster(page), c = await areaCentre(page, cid);
  await zoomAt(page, Z.t + (Z.k - Z.t) * 0.5, c);
  await shot(page, 'overgang-dark');
  await zoomAt(page, Z.k, c);
  await shot(page, 'kart-dark');
  await zoomAt(page, Z.d, c);
  await shot(page, 'detalj-dark');
  await goBtn(page, 'tema');
  await openTemaView(page, cid, false);
  await shot(page, 'temavising-dark');
  await checkTemaView(page, 'dark');
  await goBtn(page, 'tema');
  await openMore(page, 'Filter');
  await shot(page, 'fleire-val-dark');
  await ctx.close();
}
// Mobile
{
  const { ctx, page } = await open({ width: 390, height: 844 }, { dpr: 2, touch: true });
  await shot(page, 'mobil-tema');
  await checkTema(page, 'mobil');
  if (!(await wholeMapInside(page))) problems.push('[mobil] the whole map is not inside the stage at the start');
  if ((await lvl(page)).level !== 'tema') problems.push('[mobil] the map does not start at Tema');
  // pinch to zoom in: two fingers moving apart
  const before = await page.evaluate(() => window.__cy.zoom());
  const cdp = await ctx.newCDPSession(page);
  const r = await page.evaluate(() => { const b = document.getElementById('cy').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await cdp.send('Input.synthesizePinchGesture', { x: r.x, y: r.y, scaleFactor: 2.6, relativeSpeed: 600, gestureSourceType: 'touch' });
  await wait(page, 600);
  const after = await page.evaluate(() => ({ z: window.__cy.zoom(), level: window.__fk.KART.level }));
  if (!(after.z > before * 1.5)) problems.push(`[mobil] pinch did not zoom in (${before} -> ${after.z})`);
  await shot(page, 'mobil-pinch');
  await goBtn(page, 'tema');
  // a tap on a tema box opens the tema view (the same view, upright)
  const cid = await pickCluster(page), bp = await boxPos(page, cid);
  const inView = await page.evaluate(({ x, y }) => { const b = document.getElementById('cy').getBoundingClientRect(); return x > b.left && x < b.right && y > b.top && y < b.bottom; }, bp);
  if (inView) {
    await page.touchscreen.tap(bp.x, bp.y);
    await wait(page, 1000);
    if ((await page.evaluate(() => window.__fk.state.tema)) !== cid) problems.push('[mobil] a tap on a tema box did not open the tema view: ' + JSON.stringify(await lvl(page)));
  } else await openTemaView(page, cid, false);
  await shot(page, 'mobil-temavising');
  await checkTemaView(page, 'mobil', false);
  await checkLayout(page, 'mobil temavising');
  const g = await page.evaluate(() => { const n = window.__cy.nodes('[kind="node"]').filter((x) => !x.data('grey') && x.data('lvl') === 1)[0]; return n ? n.id() : null; });
  if (g) { await page.evaluate((id) => window.__fk.select(id, { center: true }), g); await wait(page, 700); await shot(page, 'mobil-temavising-node'); await page.click('#panel .close'); }
  if ((await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))) problems.push('[layout] horizontal overflow at 390px in the tema view');
  await page.tap('#temaBack');
  await wait(page, 1000);
  if ((await page.evaluate(() => window.__fk.state.tema)) !== null) problems.push('[mobil] "Alle tema" did not go back');
  await goBtn(page, 'kart');
  await checkKart(page, 'mobil');
  await checkArrows(page, 'mobil kart');
  await page.evaluate(() => { const n = window.__cy.nodes('[kind="node"][lvl=1]').filter((x) => !x.hasClass('zoff') && x.renderedPosition().x > 20 && x.renderedPosition().x < 370 && x.renderedPosition().y > 20 && x.renderedPosition().y < 500)[0]; window.__fk.select(n.id(), { center: true }); });
  await wait(page, 700);
  await shot(page, 'mobil-node');
  await page.click('#panel .close');
  await page.click('#moreBtn');
  await page.waitForTimeout(250);
  await shot(page, 'mobil-val');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) problems.push('[layout] horizontal overflow at 390px');
  await ctx.close();
}
await browser.close();

if (requests.length) problems.push('[network] external requests: ' + requests.join(', '));
console.log(problems.length ? 'PROBLEM:\n' + problems.join('\n') : 'Console clean, no network requests.');
console.log('Screenshots in', path.relative(process.cwd(), outDir));
process.exit(problems.length ? 1 : 0);
