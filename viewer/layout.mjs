import { texLabel } from './src/texlabel.js';
import { routeEdges } from './src/route.js';
import { kartEdges } from './src/kartkantar.js';
import { computeTemaLayouts } from './temalayout.mjs';
// Build-time layout of the fagkart "Kart" view. Pure function of the dist JSON, so every build gives the same positions.
//
//   1. Level 1 nodes get an inner layered layout per klynge (elkjs, direction right, `oversiktskantar`).
//   2. The klynger become boxes. They are ordered by their prerequisites (forkunnskap first) and packed in columns
//      from left to right, so the prerequisites sit left and the project work right.
//   3. Level 2 nodes become satellites: each goes to the free spot nearest its anchor (a level 1 node) inside its
//      own klynge box. A box that is too small for its satellites grows, and everything is packed again.
//   4. A node with `pos` in the data keeps that position.
// A map without any nivaa 1 node and without oversiktskantar is laid out flat: all nodes are level 1, the byggjer_paa edges are the inner edges.
//
// Each layout also carries `tema`: the layouts of the tema view, one per tema (temalayout.mjs).
// computeLayout(data, { withoutForkunnskap: true }) runs the very same rules on the map without the forkunnskap cluster
// (every node with a `forkunnskap` field), so the viewer can switch forkunnskap off and still get a tight map.
// computeLayouts(data) returns the full layout with that second one attached as `utanForkunnskap`, and a pair for a tall stage as `smal`.
import ELK from 'elkjs/lib/elk.bundled.js';
import { wrap } from './metrics.mjs';

export const L1 = { font: 14, wrapW: 92, padX: 8, padY: 6, minW: 50 };
export const L2 = { font: 12, wrapW: 88, padX: 7, padY: 5, minW: 44 };
const BAND = 64; // label band at the top of a klynge area
const AREA_PAD = 16;
const GAP = 14; // minimum air between two node boxes (the arrows run in it)
const COL_GAP = 46, ROW_GAP = 30, ASPECT = 1.75; // ASPECT: the shape we pack for (width / height of the stage); opts.aspect packs for another one (a phone held upright)

const lineH = (font) => Math.ceil(font * 1.2);
export function nodeSize(label, lvl) {
  const s = lvl === 1 ? L1 : L2;
  const m = wrap(label, s.font, s.wrapW);
  return { lines: m.lines, w: Math.max(s.minW, m.w + s.padX * 2), h: m.lines.length * lineH(s.font) + s.padY * 2 };
}

const overlaps = (a, b, m = 0) => a.x1 < b.x2 + m && b.x1 < a.x2 + m && a.y1 < b.y2 + m && b.y1 < a.y2 + m;
const rectOf = (p) => ({ x1: p.x - p.w / 2, y1: p.y - p.h / 2, x2: p.x + p.w / 2, y2: p.y + p.h / 2 });
const clusterOf = (n) => (n.forkunnskap ? 'forkunnskap' : n.klynge || 'anna');

// Offsets around an anchor, nearest first (sideways is cheaper than vertical because the map reads left to right).
const OFFSETS = (() => {
  const o = [];
  for (let dy = -70; dy <= 70; dy++) for (let dx = -70; dx <= 70; dx++) o.push([dx * 10, dy * 10]);
  const dist = ([dx, dy]) => Math.hypot(dx * 0.8, dy * 1.25);
  return o.sort((p, q) => dist(p) - dist(q) || p[1] - q[1] || p[0] - q[0]);
})();

export async function computeLayout(data, opts = {}) {
  const aspect = opts.aspect || ASPECT;
  const nodes = data.nodar.filter((n) => !n.utgaatt && n.type !== 'kompetansemaal' && !(opts.withoutForkunnskap && n.forkunnskap));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // A map without nivaa and oversiktskantar is "flat": every node is level 1 and its explicit edges drive the layout
  const flat = !data.nodar.some((n) => n.nivaa === 1) && !(data.oversiktskantar || []).length;
  const lvl = (n) => (flat || n.nivaa === 1 ? 1 : 2);
  const ov = (flat ? (data.kantar || []).filter((e) => !e.implisitt) : data.oversiktskantar || []).filter((e) => byId.has(e.fra) && byId.has(e.til));
  const elk = new ELK();

  const cids = [];
  const used = new Set(nodes.map(clusterOf));
  if (used.has('forkunnskap')) cids.push('forkunnskap');
  for (const k of data.klyngjer || []) if (used.has(k.id) && !cids.includes(k.id)) cids.push(k.id);
  for (const c of [...used].sort()) if (!cids.includes(c)) cids.push(c);

  const size = new Map(nodes.map((n) => [n.id, nodeSize(texLabel(n.namn), lvl(n))]));

  // ---- 1. inner layouts: several aspect ratios per klynge, the most compact one wins ----
  const innerLayout = async (own, ar) => {
    const ids = new Set(own.map((n) => n.id));
    const edges = ov.filter((e) => e.type === 'byggjer_paa' && ids.has(e.fra) && ids.has(e.til))
      .map((e, i) => ({ id: `e${i}`, sources: [e.til], targets: [e.fra] })); // prerequisite -> dependent: flows to the right
    const g = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '16', 'elk.layered.spacing.nodeNodeBetweenLayers': '44',
        'elk.layered.spacing.edgeNodeBetweenLayers': '8', 'elk.spacing.edgeEdge': '6',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.spacing.componentComponent': '12', 'elk.separateConnectedComponents': 'true',
        'elk.layered.wrapping.strategy': 'MULTI_EDGE', 'elk.aspectRatio': String(ar),
        'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      },
      children: own.map((n) => ({ id: n.id, width: size.get(n.id).w, height: size.get(n.id).h })),
      edges,
    });
    return { w: g.width, h: g.height, pos: new Map(g.children.map((c) => [c.id, { x: c.x, y: c.y }])) };
  };
  const variants = new Map(); // klynge -> inner layouts of different widths, narrowest first
  for (const cid of cids) {
    const own = nodes.filter((n) => lvl(n) === 1 && clusterOf(n) === cid).sort((a, b) => a.id.localeCompare(b.id));
    if (!own.length) continue;
    const all = [];
    for (const ar of [0.5, 0.8, 1.2, 1.8, 2.6, 4.0]) {
      const v = await innerLayout(own, ar);
      if (!all.some((q) => Math.abs(q.w - v.w) < 6 && Math.abs(q.h - v.h) < 6)) all.push(v);
    }
    variants.set(cid, all.sort((p, q) => p.w - q.w));
  }
  const withNodes = cids.filter((c) => variants.has(c));

  // ---- 2. order of the klynger: prerequisites first ----
  // Every explicit byggjer_paa between two klynger counts, also between level 2 nodes (a project klynge often ties to the
  // others only there). Two klynger that build on each other keep the direction with more edges; a tie gives no order.
  const dirCount = new Map();
  for (const e of [...ov, ...(data.kantar || []).filter((k) => !k.implisitt && byId.has(k.fra) && byId.has(k.til))]) {
    if (e.type !== 'byggjer_paa') continue;
    const a = clusterOf(byId.get(e.fra)), b = clusterOf(byId.get(e.til));
    if (a !== b && variants.has(a) && variants.has(b)) dirCount.set(`${b}|${a}`, (dirCount.get(`${b}|${a}`) || 0) + 1); // prerequisite -> dependent
  }
  const cEdges = new Set([...dirCount].filter(([k, n]) => { const [b, a] = k.split('|'); return n > (dirCount.get(`${a}|${b}`) || 0); }).map(([k]) => k));
  // Depth of a klynge = the longest chain of prerequisite klynger below it (a cycle is cut by limiting the rounds).
  // The orders to try put every depth before the next, so the project work always ends up at the right.
  const depth = new Map(withNodes.map((c) => [c, 0]));
  for (let r = 0; r < withNodes.length; r++) {
    for (const k of [...cEdges].sort()) {
      const [s, t] = k.split('|');
      if (depth.get(t) < depth.get(s) + 1 && depth.get(s) < withNodes.length) depth.set(t, depth.get(s) + 1);
    }
  }
  const levels = [...new Set(depth.values())].sort((a, b) => a - b).map((d) => withNodes.filter((c) => depth.get(c) === d));
  const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  let orders = [[]];
  for (const lv of levels) orders = orders.flatMap((o) => perms(lv).map((p) => [...o, ...p])).slice(0, 600);
  
  // ---- satellites: who they hang on ----
  const adj = new Map(nodes.map((n) => [n.id, { build: [], builtOn: [], other: [] }]));
  for (const k of data.kantar || []) {
    if (!byId.has(k.fra) || !byId.has(k.til) || k.implisitt) continue;
    if (k.type === 'byggjer_paa') { adj.get(k.til).build.push(k.fra); adj.get(k.fra).builtOn.push(k.til); }
    else { adj.get(k.til).other.push(k.fra); adj.get(k.fra).other.push(k.til); }
  }
  const sat = nodes.filter((n) => lvl(n) === 2).sort((a, b) => a.id.localeCompare(b.id));
  // The anchor is a level 1 node that builds on the satellite, or else one it builds on, or else any neighbour;
  // a node of the same klynge is preferred. Satellites chain onto already placed satellites as a last resort.
  const anchorOf = (n, done) => {
    const a = adj.get(n.id), cid = clusterOf(n);
    for (const sameOnly of [true, false]) {
      for (const tier of [(id) => lvl(byId.get(id)) === 1, () => true]) {
        for (const ids of [a.build, a.builtOn, a.other]) {
          const ok = [...new Set(ids)].filter((id) => done.has(id) && tier(id) && (!sameOnly || clusterOf(byId.get(id)) === cid)).sort();
          if (ok.length) return ok[0];
        }
      }
    }
    return null;
  };

  // ---- 3. one full attempt: pack the boxes, place level 1 inside them, then the satellites ----
  const extra = new Map(); // klynge -> extra height the satellites asked for
  // The inner layout a klynge gets in a column of the given width: the lowest one that is not wider.
  const fitIn = (cid, Wc) => {
    const vs = variants.get(cid);
    const ok = vs.filter((v) => v.w + AREA_PAD * 2 <= Wc);
    const v = ok.length ? ok.reduce((a, b) => (b.h < a.h ? b : a)) : vs[0];
    return { v, w: v.w + AREA_PAD * 2, h: v.h + AREA_PAD * 2 + BAND + (extra.get(cid) || 0) };
  };
  const pack = (hMax, order, Wc) => {
    const cols = [], choice = new Map();
    let col = null;
    for (const cid of order) {
      const s = fitIn(cid, Wc);
      choice.set(cid, s.v);
      if (!col || (col.items.length && col.h + ROW_GAP + s.h > hMax)) { col = { items: [], hs: [], h: -ROW_GAP, w: 0 }; cols.push(col); }
      col.items.push(cid); col.hs.push(s.h); col.h += ROW_GAP + s.h; col.w = Math.max(col.w, s.w);
    }
    return { cols, choice, W: cols.reduce((t, c) => t + c.w, 0) + COL_GAP * (cols.length - 1), H: Math.max(...cols.map((c) => c.h)) };
  };
  // How far apart the klynger with many arrows between them sit: the sum over the pairs of (number of arrows) x (distance between the middles of the boxes)
  const pairCount = new Map();
  for (const e of ov) {
    const a = clusterOf(byId.get(e.fra)), b = clusterOf(byId.get(e.til));
    if (a === b || !variants.has(a) || !variants.has(b)) continue;
    const key = a < b ? a + '|' + b : b + '|' + a;
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  }
  const totalPairs = [...pairCount.values()].reduce((t, n) => t + n, 0);
  const linkLength = (p) => {
    const mid = new Map();
    let x = 0;
    for (const col of p.cols) {
      let y = 0;
      col.items.forEach((cid, i) => { mid.set(cid, { x: x + col.w / 2, y: y + col.hs[i] / 2 }); y += col.hs[i] + ROW_GAP; });
      x += col.w + COL_GAP;
    }
    let t = 0;
    for (const [key, n] of pairCount) { const [a, b] = key.split('|'), pa = mid.get(a), pb = mid.get(b); t += n * (Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y)); }
    return t;
  };
  const widths = [...new Set([...variants.values()].flat().map((v) => Math.round(v.w + AREA_PAD * 2)))].sort((a, b) => a - b);
  const packBest = () => {
    let best = null;
    for (const ord of orders) {
      for (const Wc of widths) {
        const hs = new Set();
        for (let i = 0; i < ord.length; i++) { let t = 0; for (let j = i; j < ord.length; j++) { t += fitIn(ord[j], Wc).h + ROW_GAP; hs.add(t - ROW_GAP); } }
        for (const hMax of [...hs].sort((a, b) => a - b)) {
          // the shape that fits the stage best counts first; between about as good ones the one where the klynger that many arrows
          // run between sit close together wins (at most about 5 % of the shape)
          const p = pack(hMax, ord, Wc), shape = Math.max(p.W, p.H * aspect);
          const sc = totalPairs ? shape * (1 + (0.1 * linkLength(p)) / (totalPairs * (p.W + p.H))) : shape;
          if (!best || sc < best.sc - 1) best = { ...p, sc, ord };
        }
      }
    }
    return best;
  };
  const override = (n, fixed) => {
    if (n.pos && Number.isFinite(n.pos.x) && Number.isFinite(n.pos.y)) { fixed.add(n.id); return { x: n.pos.x, y: n.pos.y }; }
    return null;
  };

  function attempt() {
    const best = packBest();
    const box = new Map();
    let cx = 0;
    for (const col of best.cols) {
      let cy = 0;
      for (const cid of col.items) {
        const v = best.choice.get(cid), h = v.h + AREA_PAD * 2 + BAND + (extra.get(cid) || 0);
        box.set(cid, { x1: cx, y1: cy, x2: cx + col.w, y2: cy + h, dx: (col.w - v.w - AREA_PAD * 2) / 2 });
        cy += h + ROW_GAP;
      }
      cx += col.w + COL_GAP;
    }
    const placed = new Map(); // id -> {x,y,w,h} (centre)
    const fixed = new Set();
    for (const cid of withNodes) {
      const b = box.get(cid);
      for (const [id, p] of best.choice.get(cid).pos) {
        const s = size.get(id);
        placed.set(id, { x: b.x1 + b.dx + AREA_PAD + p.x + s.w / 2, y: b.y1 + AREA_PAD + BAND + p.y + s.h / 2, w: s.w, h: s.h });
      }
    }
    for (const n of nodes) { const o = override(n, fixed); if (o && placed.has(n.id)) Object.assign(placed.get(n.id), o); }

    const obstacles = [...placed.values()].map(rectOf);
    const done = new Set(placed.keys());
    const failed = new Map();
    let pending = sat.slice();
    for (let round = 0; pending.length && round < 40; round++) {
      const later = [];
      for (const n of pending) {
        const cid = clusterOf(n), s = size.get(n.id), b = box.get(cid);
        const o = override(n, fixed);
        if (o) { placed.set(n.id, { ...o, w: s.w, h: s.h }); obstacles.push(rectOf(placed.get(n.id))); done.add(n.id); continue; }
        const anchor = anchorOf(n, done);
        if (!anchor && round < 5) { later.push(n); continue; } // wait for a neighbour to be placed
        const home = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
        const from = anchor ? placed.get(anchor) : home;
        // a foreign anchor: search from the point of our own box nearest to it
        const sx = Math.min(Math.max(from.x, b.x1 + s.w / 2 + 10), b.x2 - s.w / 2 - 10);
        const sy = Math.min(Math.max(from.y, b.y1 + BAND + s.h / 2 + 10), b.y2 - s.h / 2 - 10);
        let spot = null;
        for (const [dx, dy] of OFFSETS) {
          const r = rectOf({ x: sx + dx, y: sy + dy, w: s.w, h: s.h });
          if (r.x1 < b.x1 + 8 || r.x2 > b.x2 - 8 || r.y1 < b.y1 + BAND || r.y2 > b.y2 - 8) continue;
          if (obstacles.some((q) => overlaps(r, q, GAP))) continue;
          spot = { x: sx + dx, y: sy + dy }; break;
        }
        if (!spot) { failed.set(cid, (failed.get(cid) || 0) + 1); spot = { x: b.x2 - s.w / 2 - 8, y: b.y2 + s.h / 2 }; } // parked below the box, the box grows next round
        placed.set(n.id, { ...spot, w: s.w, h: s.h });
        obstacles.push(rectOf(placed.get(n.id)));
        done.add(n.id);
      }
      if (later.length === pending.length && later.length) later.length = 0;
      pending = later;
    }
    return { best, box, placed, fixed, failed };
  }

  // grow the boxes that are too small, then shave each one down as far as its satellites still fit
  let res = attempt();
  for (let round = 0; round < 40 && res.failed.size; round++) {
    for (const [cid, k] of res.failed) extra.set(cid, (extra.get(cid) || 0) + 18 * Math.min(k, 6));
    res = attempt();
  }
  for (const cid of withNodes) {
    for (;;) {
      const prev = extra.get(cid) || 0;
      if (prev <= 0) break;
      extra.set(cid, Math.max(0, prev - 14));
      const r = attempt();
      if (r.failed.size) { extra.set(cid, prev); break; }
      res = r;
    }
  }
  res = attempt();
  for (let round = 0; round < 20 && res.failed.size; round++) { // the last repack moved something: grow again
    for (const [cid, k] of res.failed) extra.set(cid, (extra.get(cid) || 0) + 14 * Math.min(k, 4));
    res = attempt();
  }
  const { best, box, placed, fixed, failed } = res;
  if (failed.size) throw new Error('satellites do not fit: ' + [...failed.keys()].join(', '));

  // ---- 4. areas and output ----
  const areas = {};
  for (const cid of withNodes) {
    const b = box.get(cid);
    const a = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
    for (const n of nodes) { // a node with a hand-set position may lie outside the box
      if (clusterOf(n) !== cid || !fixed.has(n.id)) continue;
      const r = rectOf(placed.get(n.id));
      a.x1 = Math.min(a.x1, r.x1 - 10); a.y1 = Math.min(a.y1, r.y1 - BAND); a.x2 = Math.max(a.x2, r.x2 + 10); a.y2 = Math.max(a.y2, r.y2 + 10);
    }
    areas[cid] = { x: Math.round((a.x1 + a.x2) / 2), y: Math.round((a.y1 + a.y2) / 2), w: Math.round(a.x2 - a.x1), h: Math.round(a.y2 - a.y1), band: BAND };
  }
  const outNodes = {};
  for (const n of nodes) {
    const p = placed.get(n.id), s = size.get(n.id);
    outNodes[n.id] = { x: Math.round(p.x), y: Math.round(p.y), w: s.w, h: s.h, lines: s.lines, l: lvl(n) };
  }
  // verification: no two nodes overlap (unless one was placed by hand), no two areas overlap
  const problems = [];
  const ids = Object.keys(outNodes);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (fixed.has(ids[i]) || fixed.has(ids[j])) continue;
    if (overlaps(rectOf(outNodes[ids[i]]), rectOf(outNodes[ids[j]]), 0)) problems.push(`overlap ${ids[i]} / ${ids[j]}`);
  }
  const ak = Object.keys(areas);
  for (let i = 0; i < ak.length; i++) for (let j = i + 1; j < ak.length; j++) {
    if (overlaps(rectOf(areas[ak[i]]), rectOf(areas[ak[j]]), 0)) problems.push(`area overlap ${ak[i]} / ${ak[j]}`);
  }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const a of Object.values(areas)) { const r = rectOf(a); x1 = Math.min(x1, r.x1); y1 = Math.min(y1, r.y1); x2 = Math.max(x2, r.x2); y2 = Math.max(y2, r.y2); }
  const routes = computeRoutes(data, outNodes, areas, clusterOf, nodes, problems);
  // the tema view (temalayout.mjs): one layout per tema, packed for the same stage shape
  const tv = await computeTemaLayouts(data, { aspect, withoutForkunnskap: opts.withoutForkunnskap });
  problems.push(...tv.problems);
  return { version: 2, order: best.ord, cols: best.cols.map((c) => c.items), nodes: outNodes, areas, bounds: { x1, y1, x2, y2 }, routes, tema: tv.tema, problems };
}

// ---- 5. the arrows: every arrow the page draws gets a path of horizontal and vertical runs that keeps clear of all the nodes ----
// routes[key] = [[x, y], ...] from the node the arrow starts at (fra) to the one it ends at (til); the first and the last point lie on the borders.
// The key is the id of the arrow in the page (src/kartkantar.js).
export const ROUTE = { step: 6, pad: 4, turn: 6 };
function computeRoutes(data, outNodes, areas, clusterOf, nodes, problems) {
  const obstacles = Object.entries(outNodes).map(([id, p]) => ({ id, ...rectOf(p) }));
  const members = new Map();
  for (const n of nodes) { const c = clusterOf(n); if (!members.has(c)) members.set(c, []); members.get(c).push(n.id); }
  // soft zones: an arrow likes the lanes between the areas better than the inside of another area, and keeps away from the names of the areas
  const zones = [];
  let hx1 = Infinity, hy1 = Infinity, hx2 = -Infinity, hy2 = -Infinity;
  for (const a of Object.values(areas)) { const r = rectOf(a); hx1 = Math.min(hx1, r.x1); hy1 = Math.min(hy1, r.y1); hx2 = Math.max(hx2, r.x2); hy2 = Math.max(hy2, r.y2); }
  zones.push({ x1: hx1 - 1000, y1: hy1 - 1000, x2: hx2 + 1000, y2: hy2 + 1000, cost: 1.5, members: [] }, { x1: hx1, y1: hy1, x2: hx2, y2: hy2, cost: 0, members: [] });
  for (const [cid, a] of Object.entries(areas)) { const r = rectOf(a); zones.push({ ...r, cost: 0.4, members: members.get(cid) || [] }); }
  for (const a of Object.values(areas)) { const r = rectOf(a); zones.push({ x1: r.x1, x2: r.x2, y1: r.y1, y2: r.y1 + a.band, cost: 3, members: [] }); }
  const list = kartEdges(data, (id) => !!outNodes[id]);
  const dist = (e) => { const a = outNodes[e.k.fra], b = outNodes[e.k.til]; return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); };
  // the overview arrows are the ones you see first, so they get the best lanes; short arrows first, they have the fewest ways to go
  const order = [...list.filter((e) => e.ov).sort((p, q) => dist(p) - dist(q)), ...list.filter((e) => !e.ov).sort((p, q) => dist(p) - dist(q))];
  const res = routeEdges({ obstacles, edges: order.map((e) => ({ id: e.key, from: e.k.fra, to: e.k.til })), zones, ...ROUTE });
  const routes = {};
  for (const e of order) {
    const r = res.get(e.key);
    if (!r) continue;
    if (!r.ok) problems.push(`no route for arrow ${e.key} (${e.k.fra} -> ${e.k.til})`);
    routes[e.key] = r.pts;
  }
  return routes;
}

// The layout the viewer bakes into the page: the full map, plus the same map without the forkunnskap cluster.
// The second one is null when the map has no forkunnskap nodes (the switch does not exist then).
// A phone held upright gets its own pair (`smal`), packed for a tall stage, so the boxes of the tema level fit the screen.
export const PORTRAIT_ASPECT = 0.6;
export async function computeLayouts(data) {
  const hasFk = data.nodar.some((n) => !n.utgaatt && n.type !== 'kompetansemaal' && n.forkunnskap);
  const pair = async (opts) => {
    const full = await computeLayout(data, opts);
    const utan = hasFk ? await computeLayout(data, { ...opts, withoutForkunnskap: true }) : null;
    return { ...full, utanForkunnskap: utan };
  };
  const wide = await pair({});
  return { ...wide, smal: Object.keys(wide.areas).length >= 3 ? await pair({ aspect: PORTRAIT_ASPECT }) : null };
}
