// Orthogonal arrow router: pure functions, no DOM. Used by the build (layout.mjs, the arrows of the map) and by the page (the arrows
// between the tema boxes), so no arrow runs through a box. The build inlines this file into the page after removing the `export` keywords,
// so keep it to plain declarations without imports.
//
// routeEdges({ obstacles, edges, ... }) finds for each edge a path of horizontal and vertical runs from a side of its first box to a
// side of its second box. A* on a grid; the boxes (and a little air around them) are blocked, every bend costs a little, runs over cells
// that an earlier arrow uses cost more (so arrows spread out instead of lying on top of each other) and the arrows of one box use
// different spots on its side where they can.
//
//   obstacles: [{ id, x1, y1, x2, y2 }]            the boxes
//   edges:     [{ id, from, to }]                   ids of boxes; routed in the given order
//   step, pad: grid size and the air kept around a box that is not an end of the arrow (same unit as the boxes)
//   turn:      cost of a bend, in grid steps
//   zones:     [{ x1, y1, x2, y2, cost, members }]  soft areas: a cell costs `cost` more, unless the arrow starts or ends in a
//                                                    box listed in `members`. Later zones win where they overlap.
// Returns Map(edge id -> { pts: [[x, y] ...], ok }): the path with its first and last point on the border of the two boxes.
// ok is false when no path was found; pts is then a plain line between the boxes.

const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // directions: 0 = right, 1 = down, 2 = left, 3 = up

export function routeEdges(opts) {
  const { obstacles, edges } = opts;
  const step = opts.step || 6, pad = opts.pad == null ? 4 : opts.pad, turn = opts.turn == null ? 5 : opts.turn;
  const zones = opts.zones || [];
  const out = new Map();
  if (!obstacles.length) return out;
  const idx = new Map(obstacles.map((o, i) => [o.id, i]));

  // ---- the grid ----
  let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
  for (const o of obstacles) { bx1 = Math.min(bx1, o.x1); by1 = Math.min(by1, o.y1); bx2 = Math.max(bx2, o.x2); by2 = Math.max(by2, o.y2); }
  const margin = opts.margin == null ? 10 * step : opts.margin;
  const x0 = bx1 - margin, y0 = by1 - margin;
  const W = Math.ceil((bx2 - bx1 + margin * 2) / step) + 1, H = Math.ceil((by2 - by1 + margin * 2) / step) + 1;
  const cx = (i) => x0 + (i + 0.5) * step, cyy = (j) => y0 + (j + 0.5) * step;
  const ci = (x) => Math.floor((x - x0) / step), cj = (y) => Math.floor((y - y0) / step);
  const core = new Uint8Array(W * H), h1 = new Int32Array(W * H), h2 = new Int32Array(W * H), hx = new Uint8Array(W * H);
  obstacles.forEach((o, k) => {
    for (let j = Math.max(0, cj(o.y1 - pad)); j <= Math.min(H - 1, cj(o.y2 + pad)); j++) {
      for (let i = Math.max(0, ci(o.x1 - pad)); i <= Math.min(W - 1, ci(o.x2 + pad)); i++) {
        const x = cx(i), y = cyy(j), c = j * W + i;
        if (x < o.x1 - pad || x > o.x2 + pad || y < o.y1 - pad || y > o.y2 + pad) continue;
        if (x >= o.x1 && x <= o.x2 && y >= o.y1 && y <= o.y2) core[c] = 1;
        else if (!h1[c]) h1[c] = k + 1;
        else if (!h2[c]) h2[c] = k + 1;
        else hx[c] = 1;
      }
    }
  });
  const zoneAt = new Int16Array(W * H).fill(-1);
  zones.forEach((z, k) => {
    for (let j = Math.max(0, cj(z.y1)); j <= Math.min(H - 1, cj(z.y2)); j++) for (let i = Math.max(0, ci(z.x1)); i <= Math.min(W - 1, ci(z.x2)); i++) {
      const x = cx(i), y = cyy(j);
      if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) zoneAt[j * W + i] = k;
    }
  });
  const usedH = new Uint8Array(W * H), usedV = new Uint8Array(W * H); // cells that an earlier arrow runs through
  const portUse = new Map();
  const N = W * H * 4;
  const stamp = new Int32Array(N), closed = new Int32Array(N), gs = new Float32Array(N), parent = new Int32Array(N);
  let gen = 0;

  // The places where an arrow can leave a box on one side: the stub cell (just outside the air around the box) and the point on the border.
  // Sorted by how near the middle of the side they are.
  function ports(o, side) {
    const list = [];
    const horizontal = side === 0 || side === 2; // the side is a vertical edge of the box
    const lo = horizontal ? o.y1 : o.x1, hi = horizontal ? o.y2 : o.x2, m = Math.min(4, (hi - lo) / 3), mid = (lo + hi) / 2;
    const n = horizontal ? H : W;
    for (let t = 0; t < n; t++) {
      const c = horizontal ? cyy(t) : cx(t);
      if (c < lo + m || c > hi - m) continue;
      let i, j, px, py;
      if (side === 0) { i = ci(o.x2 + pad) + 1; j = t; px = o.x2; py = c; }
      else if (side === 2) { i = ci(o.x1 - pad) - 1; j = t; px = o.x1; py = c; }
      else if (side === 1) { i = t; j = cj(o.y2 + pad) + 1; px = c; py = o.y2; }
      else { i = t; j = cj(o.y1 - pad) - 1; px = c; py = o.y1; }
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      list.push({ i, j, px, py, off: Math.abs(c - mid) });
    }
    return list.sort((a, b) => a.off - b.off).slice(0, 5);
  }
  const portCache = new Map();
  const portsOf = (k, side) => { const key = k * 4 + side; let p = portCache.get(key); if (!p) { p = ports(obstacles[k], side); portCache.set(key, p); } return p; };
  const portKey = (k, side, p) => `${k}:${side}:${p.i}:${p.j}`;

  function route(e) {
    const s = idx.get(e.from), t = idx.get(e.to);
    const S = obstacles[s], T = obstacles[t];
    const sc = { x: (S.x1 + S.x2) / 2, y: (S.y1 + S.y2) / 2 }, tc = { x: (T.x1 + T.x2) / 2, y: (T.y1 + T.y2) / 2 };
    // a side that faces the other box is the natural choice; the others cost extra
    const facing = (side, from, to) => {
      const dx = to.x - from.x, dy = to.y - from.y;
      return (side === 0 && dx > 0) || (side === 2 && dx < 0) || (side === 1 && dy > 0) || (side === 3 && dy < 0) ? 0 : 14;
    };
    const starts = [], goals = new Map();
    for (let side = 0; side < 4; side++) {
      for (const p of portsOf(s, side)) starts.push({ ...p, side, cost: facing(side, sc, tc) + (portUse.get(portKey(s, side, p)) || 0) * 9 });
      for (const p of portsOf(t, side)) goals.set(p.j * W + p.i + ':' + side, { ...p, side, cost: facing(side, tc, sc) + (portUse.get(portKey(t, side, p)) || 0) * 9 });
    }
    const goalAt = new Map();
    for (const g of goals.values()) { const c = g.j * W + g.i; if (!goalAt.has(c)) goalAt.set(c, []); goalAt.get(c).push(g); }
    const zoneOff = new Uint8Array(zones.length);
    zones.forEach((z, k) => { if (z.members && (z.members.includes(e.from) || z.members.includes(e.to))) zoneOff[k] = 1; });
    const free = (c) => !core[c] && !hx[c] && (!h1[c] || h1[c] - 1 === s || h1[c] - 1 === t) && (!h2[c] || h2[c] - 1 === s || h2[c] - 1 === t);
    // Manhattan distance from a cell to the box of the target, a lower bound of what is left
    const ti1 = ci(T.x1), ti2 = ci(T.x2), tj1 = cj(T.y1), tj2 = cj(T.y2);
    const heur = (i, j) => Math.max(0, ti1 - i, i - ti2) + Math.max(0, tj1 - j, j - tj2);

    const attempt = (win) => {
      gen++;
      const hf = [], hv = [];
      const push = (f, v) => { // binary heap of (f, v)
        let i = hf.length; hf.push(f); hv.push(v);
        while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; hv[i] = hv[p]; i = p; }
        hf[i] = f; hv[i] = v;
      };
      const pop = () => {
        const f0 = hf[0], v0 = hv[0], f = hf.pop(), v = hv.pop(), n = hf.length;
        if (n) {
          let i = 0;
          for (;;) {
            let c = 2 * i + 1;
            if (c >= n) break;
            if (c + 1 < n && hf[c + 1] < hf[c]) c++;
            if (hf[c] >= f) break;
            hf[i] = hf[c]; hv[i] = hv[c]; i = c;
          }
          hf[i] = f; hv[i] = v;
        }
        return [f0, v0];
      };
      const finals = []; // end points found: { state, goal }; finish entries in the heap are -(index + 1)
      for (const st of starts) {
        if (st.i < win.i1 || st.i > win.i2 || st.j < win.j1 || st.j > win.j2) continue;
        const c = st.j * W + st.i;
        if (!free(c)) continue;
        const state = c * 4 + st.side, g = st.cost;
        if (stamp[state] !== gen || gs[state] > g) { stamp[state] = gen; gs[state] = g; parent[state] = -1; push(g + heur(st.i, st.j), state); }
      }
      while (hf.length) {
        const [, v] = pop();
        if (v < 0) return { final: finals[-v - 1] };
        if (closed[v] === gen) continue;
        closed[v] = gen;
        const g = gs[v];
        const c = v >> 2, d = v & 3, i = c % W, j = (c - i) / W;
        const here = goalAt.get(c);
        if (here) for (const gl of here) {
          const total = g + gl.cost + (d === (gl.side + 2) % 4 ? 0 : turn);
          finals.push({ state: v, goal: gl });
          push(total, -finals.length);
        }
        for (let nd = 0; nd < 4; nd++) {
          if (nd === (d + 2) % 4) continue; // no U-turns
          const ni = i + DX[nd], nj = j + DY[nd];
          if (ni < win.i1 || ni > win.i2 || nj < win.j1 || nj > win.j2) continue;
          const nc = nj * W + ni;
          if (!free(nc)) continue;
          let cost = 1 + (nd === d ? 0 : turn);
          const z = zoneAt[nc];
          if (z >= 0 && !zoneOff[z]) cost += zones[z].cost;
          if (nd % 2 === 0) { if (usedH[nc]) cost += 4; if (usedV[nc]) cost += 1.5; } else { if (usedV[nc]) cost += 4; if (usedH[nc]) cost += 1.5; }
          const ng = g + cost, ns = nc * 4 + nd;
          if (stamp[ns] !== gen || gs[ns] > ng) { stamp[ns] = gen; gs[ns] = ng; parent[ns] = v; push(ng + heur(ni, nj), ns); }
        }
      }
      return null;
    };

    const near = 28; // cells: first look only around the two boxes, then everywhere
    const wins = [
      { i1: Math.max(0, Math.min(ci(S.x1), ci(T.x1)) - near), i2: Math.min(W - 1, Math.max(ci(S.x2), ci(T.x2)) + near), j1: Math.max(0, Math.min(cj(S.y1), cj(T.y1)) - near), j2: Math.min(H - 1, Math.max(cj(S.y2), cj(T.y2)) + near) },
      { i1: 0, i2: W - 1, j1: 0, j2: H - 1 },
    ];
    let res = null;
    for (const win of wins) { res = attempt(win); if (res) break; }
    if (!res) return { pts: [[sc.x, sc.y], [tc.x, tc.y]], ok: false };

    // the path as cells, from the end back to the start
    const cells = [];
    for (let v = res.final.state; v !== -1; v = parent[v]) cells.push(v);
    cells.reverse();
    const first = starts.find((p) => p.j * W + p.i === (cells[0] >> 2) && p.side === (cells[0] & 3));
    const last = res.final.goal;
    const pts = [[first.px, first.py]];
    for (const v of cells) { const c = v >> 2; pts.push([cx(c % W), cyy(Math.floor(c / W))]); }
    pts.push([last.px, last.py]);
    // mark what the arrow uses
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q] >> 2, d = cells[q] & 3;
      if (q === 0 || d % 2 === 0) usedH[c] = 1;
      if (q === 0 || d % 2 === 1) usedV[c] = 1;
    }
    portUse.set(portKey(s, first.side, first), (portUse.get(portKey(s, first.side, first)) || 0) + 1);
    portUse.set(portKey(t, last.side, last), (portUse.get(portKey(t, last.side, last)) || 0) + 1);
    return { pts: simplify(pts), ok: true };
  }

  for (const e of edges) {
    if (!idx.has(e.from) || !idx.has(e.to) || e.from === e.to) continue;
    const r = route(e);
    out.set(e.id, { pts: r.pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), ok: r.ok });
  }
  return out;
}

// Drop the points in the middle of a straight run
export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const a = out[out.length - 2], b = out[out.length - 1];
    if (b && b[0] === p[0] && b[1] === p[1]) continue;
    if (a && b && ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]))) out[out.length - 1] = p; else out.push(p);
  }
  return out;
}

// The path of an arrow as Cytoscape wants it (curve-style segments): the end points as a place on the box (percent of its size, from the
// middle) and the bends as a weight along the line between the middles of the boxes and a distance from that line.
//   pts: path from the first to the second box; S, T: { x, y, w, h } the two boxes (middle and size)
export function toSegments(pts, S, T) {
  const dx = T.x - S.x, dy = T.y - S.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -dy / L, ny = dx / L; // Cytoscape's normal
  const pct = (p, B) => `${Math.round(((p[0] - B.x) / B.w) * 1000) / 10}% ${Math.round(((p[1] - B.y) / B.h) * 1000) / 10}%`;
  // A straight arrow gets one bend in the middle of its run: Cytoscape cannot draw segments without any
  const bends = pts.length > 2 ? pts.slice(1, -1) : [[(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]];
  return {
    se: pct(pts[0], S), te: pct(pts[pts.length - 1], T),
    sw: bends.map((b) => Math.round((((b[0] - S.x) * ux + (b[1] - S.y) * uy) / L) * 10000) / 10000),
    sd: bends.map((b) => Math.round(((b[0] - S.x) * nx + (b[1] - S.y) * ny) * 100) / 100),
  };
}

// Length of a path, and the point at a length along it with the direction of its run there
export function pointAlong(pts, at) {
  let left = at;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= len || i === pts.length - 1) { const t = len ? left / len : 0; return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, vertical: a[0] === b[0], from: i - 1, run: len, at: left }; }
    left -= len;
  }
  return null;
}
export const pathLength = (pts) => pts.reduce((t, p, i) => (i ? t + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
