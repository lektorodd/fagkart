// Build-time layout of the tema view: one tema at a time, its nodes (level 1 and 2 together) big and readable in a frame, the nodes of other
// temaa it is tied to by a byggjer_paa arrow small and grey on the sides, and the arrows between them routed around the boxes.
// Pure function of the dist JSON, like layout.mjs; the page only draws it (never a layout in the browser).
//
//   1. The nodes of the tema get an inner layered layout (elkjs, prerequisites to the left; for a phone held upright direction down,
//      prerequisites at the top). Several aspect ratios are tried; the whole picture (frame + grey nodes) that fits the stage best wins.
//   2. The grey nodes sit outside the frame: what the tema builds on to the left (above, on a phone held upright), what builds on the tema
//      to the right (below). Each lane is ordered by where the nodes it ties to sit, so the arrows cross as little as possible.
//   3. The arrows (temaMembers in src/kartkantar.js) are routed by src/route.js: horizontal and vertical runs that keep clear of every box.
//
// computeTemaLayouts(data, { aspect, withoutForkunnskap }) -> { problems, tema: { <tema id>: layout } }
//   layout = { frame: { x, y, w, h, band }, nodes: { <id>: { x, y, w, h, lines, l, role, cap?, capH?, nameH? } }, bounds, routes: { <arrow id>: [[x, y], ...] } }
//   x, y are the middle of the box; role is own | before | after; cap = the lines of the tema name under a grey node.
import ELK from 'elkjs/lib/elk.bundled.js';
import { texLabel } from './src/texlabel.js';
import { routeEdges } from './src/route.js';
import { temaMembers, arrowEnds } from './src/kartkantar.js';
import { wrap, textWidth } from './metrics.mjs';

// Box styles: level 1 and 2 of the tema (bigger than on the zoom surface, the view is about reading), and the grey neighbours.
export const T1 = { font: 16, wrapW: 124, padX: 11, padY: 8, minW: 66 };
export const T2 = { font: 14, wrapW: 112, padX: 9, padY: 7, minW: 56 };
export const TG = { font: 12, wrapW: 96, padX: 8, padY: 5, minW: 64, cap: { font: 10, wrapW: 108, lines: 2 } };
export const TEMA_ROUTE = { step: 6, pad: 5, turn: 6 };
const FRAME_PAD = 18, BAND = 42;
const SIDE_GAP = 72, LANE_GAP = 44, ITEM_GAP = 16; // air between the frame and the grey nodes (the arrows run in it), between lanes, between grey nodes
const FLOW = new Set(['byggjer_paa', 'brukar', 'doeme_paa', 'representerast_som']); // the arrows that say which node goes left of which
const INNER_ASPECTS = [0.3, 0.5, 0.8, 1.2, 1.8, 2.6, 3.8]; // for a wide stage; the tall one takes the same list (the shapes repeat, duplicates are dropped)

const lineH = (font) => Math.ceil(font * 1.2);
const rectOf = (p) => ({ x1: p.x - p.w / 2, y1: p.y - p.h / 2, x2: p.x + p.w / 2, y2: p.y + p.h / 2 });
const overlaps = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const pretty = (s) => { const t = String(s).replace(/[-_]/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

export function ownSize(label, lvl) {
  const s = lvl === 1 ? T1 : T2, m = wrap(label, s.font, s.wrapW);
  return { lines: m.lines, w: Math.max(s.minW, m.w + s.padX * 2), h: m.lines.length * lineH(s.font) + s.padY * 2 };
}
// A grey neighbour: its name, and the name of its tema under it (at most two lines, cut with a dots)
export function greySize(label, temaLabel) {
  const nm = wrap(label, TG.font, TG.wrapW), c = TG.cap;
  let cap = wrap(temaLabel, c.font, c.wrapW).lines;
  if (cap.length > c.lines) {
    cap = cap.slice(0, c.lines);
    let last = cap[c.lines - 1] + ' …';
    while (last.length > 4 && textWidth(last, c.font) > c.wrapW) last = last.slice(0, -3).trimEnd() + ' …';
    cap[c.lines - 1] = last;
  }
  const nameH = nm.lines.length * lineH(TG.font), capH = cap.length * lineH(c.font), capW = Math.max(...cap.map((l) => textWidth(l, c.font)));
  return { lines: nm.lines, cap, nameH, capH, w: Math.max(TG.minW, nm.w + TG.padX * 2, Math.ceil(capW) + TG.padX * 2), h: nameH + 3 + capH + TG.padY * 2 };
}

export async function computeTemaLayouts(data, opts = {}) {
  const aspect = opts.aspect || 1.75, wide = aspect >= 1;
  const elk = new ELK();
  const live = data.nodar.filter((n) => !n.utgaatt && n.type !== 'kompetansemaal' && !(opts.withoutForkunnskap && n.forkunnskap));
  const byId = new Map(live.map((n) => [n.id, n]));
  const flat = !data.nodar.some((n) => n.nivaa === 1) && !(data.oversiktskantar || []).length;
  const lvl = (n) => (flat || n.nivaa === 1 ? 1 : 2);
  const klyngeNamn = new Map((data.klyngjer || data.klynger || []).map((k) => [k.id, texLabel(k.namn || '')]));
  const temaLabel = (cid) => klyngeNamn.get(cid) || (cid === 'forkunnskap' ? 'Forkunnskap' : pretty(cid));
  const groupOf = (n) => (n.forkunnskap ? 'forkunnskap' : n.klynge || 'anna');
  const cids = [...new Set(live.map(groupOf))];
  const problems = [], tema = {};

  for (const cid of cids.sort()) {
    const M = temaMembers(data, cid, opts);
    if (!M.own.length) continue;
    const own = M.own.slice().sort((a, b) => a.localeCompare(b));
    const ownSet = new Set(own);
    const size = new Map();
    for (const id of own) size.set(id, { ...ownSize(texLabel(byId.get(id).namn), lvl(byId.get(id))), l: lvl(byId.get(id)), role: 'own' });
    for (const [ids, role] of [[M.before, 'before'], [M.after, 'after']]) {
      for (const id of ids) size.set(id, { ...greySize(texLabel(byId.get(id).namn), temaLabel(groupOf(byId.get(id)))), l: lvl(byId.get(id)), role });
    }
    // which own nodes a grey node is tied to (where its lane places it)
    const ties = new Map();
    for (const e of M.edges) {
      if (!e.grey) continue;
      const g = ownSet.has(e.k.fra) ? e.k.til : e.k.fra, o = ownSet.has(e.k.fra) ? e.k.fra : e.k.til;
      if (!ties.has(g)) ties.set(g, []);
      ties.get(g).push(o);
    }

    // ---- 1. the nodes of the tema: inner layouts of several shapes ----
    const flow = M.edges.filter((e) => !e.grey && !e.k.implisitt && FLOW.has(e.k.type)).map((e, i) => {
      const { source, target } = arrowEnds(e.k, false);
      return { id: `f${i}`, sources: [source], targets: [target] };
    });
    const inner = [];
    for (const ar of INNER_ASPECTS) {
      const g = await elk.layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered', 'elk.direction': wide ? 'RIGHT' : 'DOWN',
          'elk.spacing.nodeNode': '22', 'elk.layered.spacing.nodeNodeBetweenLayers': '60',
          'elk.layered.spacing.edgeNodeBetweenLayers': '12', 'elk.spacing.edgeEdge': '8',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
          'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
          'elk.spacing.componentComponent': '16', 'elk.separateConnectedComponents': 'true',
          'elk.layered.wrapping.strategy': 'MULTI_EDGE', 'elk.aspectRatio': String(ar),
          'elk.padding': '[top=0,left=0,bottom=0,right=0]',
        },
        children: own.map((id) => ({ id, width: size.get(id).w, height: size.get(id).h })),
        edges: flow.filter((e) => ownSet.has(e.sources[0]) && ownSet.has(e.targets[0])),
      });
      const v = { w: g.width, h: g.height, pos: new Map(g.children.map((c) => [c.id, { x: c.x, y: c.y }])) };
      if (!inner.some((q) => Math.abs(q.w - v.w) < 8 && Math.abs(q.h - v.h) < 8)) inner.push(v);
    }

    // ---- 2. the frame and the grey lanes around it ----
    const compose = (v) => {
      const F = { x1: 0, y1: 0, x2: v.w + FRAME_PAD * 2, y2: BAND + v.h + FRAME_PAD * 2 };
      const placed = new Map();
      for (const id of own) {
        const p = v.pos.get(id), s = size.get(id);
        placed.set(id, { x: F.x1 + FRAME_PAD + p.x + s.w / 2, y: F.y1 + BAND + FRAME_PAD + p.y + s.h / 2, w: s.w, h: s.h });
      }
      const near = (id) => { const t = (ties.get(id) || []).map((o) => placed.get(o)); return t.reduce((sum, p) => sum + (wide ? p.y : p.x), 0) / Math.max(1, t.length); };
      const lanes = (ids, sign) => {
        if (!ids.length) return;
        const items = ids.map((id) => ({ id, s: size.get(id), b: near(id) })).sort((p, q) => p.b - q.b || p.id.localeCompare(q.id));
        const along = (s) => (wide ? s.h : s.w), across = (s) => (wide ? s.w : s.h); // along the lane / across the lanes
        const frameLen = wide ? F.y2 - F.y1 : F.x2 - F.x1, room = Math.max(frameLen, wide ? 420 : 340);
        const total = items.reduce((t, it) => t + along(it.s), 0) + ITEM_GAP * (items.length - 1);
        const n = Math.max(1, Math.ceil(total / room));
        let gap = SIDE_GAP;
        for (let li = 0; li < n; li++) {
          const lane = items.filter((_, i) => i % n === li);
          if (!lane.length) continue;
          const depth = Math.max(...lane.map((it) => across(it.s)));
          let end = -Infinity;
          const at = lane.map((it) => { const c = Math.max(it.b, end + ITEM_GAP + along(it.s) / 2); end = c + along(it.s) / 2; return c; });
          const shift = lane.reduce((t, it, i) => t + (it.b - at[i]), 0) / lane.length; // the lane as a whole sits where its nodes want it
          const mid = sign < 0 ? (wide ? F.x1 : F.y1) - gap - depth / 2 : (wide ? F.x2 : F.y2) + gap + depth / 2;
          lane.forEach((it, i) => placed.set(it.id, wide ? { x: mid, y: at[i] + shift, w: it.s.w, h: it.s.h } : { x: at[i] + shift, y: mid, w: it.s.w, h: it.s.h }));
          gap += depth + LANE_GAP;
        }
      };
      lanes(M.before, -1);
      lanes(M.after, 1);
      let x1 = F.x1, y1 = F.y1, x2 = F.x2, y2 = F.y2;
      for (const p of placed.values()) { const r = rectOf(p); x1 = Math.min(x1, r.x1); y1 = Math.min(y1, r.y1); x2 = Math.max(x2, r.x2); y2 = Math.max(y2, r.y2); }
      return { F, placed, bounds: { x1, y1, x2, y2 }, shape: Math.max(x2 - x1, (y2 - y1) * aspect) };
    };
    let best = null;
    for (const v of inner) { const c = compose(v); if (!best || c.shape < best.shape - 1) best = c; }
    const { F, placed, bounds } = best;

    // ---- 3. the arrows ----
    const obstacles = [...placed].map(([id, p]) => ({ id, ...rectOf(p) }));
    const zones = [{ x1: F.x1, x2: F.x2, y1: F.y1, y2: F.y1 + BAND, cost: 3, members: [] }]; // keep off the name of the tema
    const dist = (e) => { const a = placed.get(e.k.fra), b = placed.get(e.k.til); return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); };
    const order = M.edges.slice().sort((p, q) => dist(p) - dist(q) || p.key.localeCompare(q.key));
    const res = routeEdges({ obstacles, edges: order.map((e) => ({ id: e.key, from: e.k.fra, to: e.k.til })), ...TEMA_ROUTE, zones });
    const routes = {};
    for (const e of order) {
      const r = res.get(e.key);
      if (!r) continue;
      if (!r.ok) problems.push(`tema ${cid}: no route for arrow ${e.key} (${e.k.fra} -> ${e.k.til})`);
      routes[e.key] = r.pts;
    }
    // an arrow may loop outside the boxes: the view holds the arrows too
    const bb = { ...bounds };
    for (const pts of Object.values(routes)) for (const [x, y] of pts) { bb.x1 = Math.min(bb.x1, x - 6); bb.y1 = Math.min(bb.y1, y - 6); bb.x2 = Math.max(bb.x2, x + 6); bb.y2 = Math.max(bb.y2, y + 6); }

    // ---- output, rounded ----
    const R = Math.round;
    const nodes = {};
    for (const [id, p] of placed) {
      const s = size.get(id);
      nodes[id] = { x: R(p.x), y: R(p.y), w: s.w, h: s.h, lines: s.lines, l: s.l, role: s.role };
      if (s.role !== 'own') Object.assign(nodes[id], { cap: s.cap, capH: s.capH, nameH: s.nameH });
    }
    const ids = Object.keys(nodes);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (overlaps(rectOf(nodes[ids[i]]), rectOf(nodes[ids[j]]))) problems.push(`tema ${cid}: overlap ${ids[i]} / ${ids[j]}`);
    tema[cid] = {
      frame: { x: R((F.x1 + F.x2) / 2), y: R((F.y1 + F.y2) / 2), w: R(F.x2 - F.x1), h: R(F.y2 - F.y1), band: BAND },
      nodes, bounds: { x1: R(bb.x1), y1: R(bb.y1), x2: R(bb.x2), y2: R(bb.y2) }, routes,
    };
  }
  return { tema, problems };
}
