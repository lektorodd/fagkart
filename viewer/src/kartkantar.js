// Which arrows the zoom surface draws between the boxes of the map, shared by the build (layout.mjs routes them) and the page (app.js
// draws them), so both count the same arrows. The tema view (temaMembers, at the end) is in here too. Pure functions, no DOM. The build
// inlines this file into the page after removing the `export` keywords, so keep it to plain declarations without imports.
//
// Arrow ids: `o<i>` is arrow i of the overview (oversiktskantar; in a map without nivaa all the arrows of the map), `e<i>` is arrow i of
// the map (kantar, only the nodes that exist). The numbers are positions in those lists, so they never change without the data.

const DRAWN_TYPES = ['byggjer_paa', 'brukar', 'doeme_paa', 'representerast_som', 'forvekslast_med', 'dekkjer'];

// Which end of an arrow is the source: arrows are drawn in reading order, from the left to the right. The overview arrows only turn
// byggjer_paa around; the other arrows turn byggjer_paa, brukar and doeme_paa around.
export function arrowEnds(k, ov) {
  const rev = ov ? k.type === 'byggjer_paa' : k.type === 'byggjer_paa' || k.type === 'brukar' || k.type === 'doeme_paa';
  return rev ? { source: k.til, target: k.fra } : { source: k.fra, target: k.til };
}

// has(id): the node has a place in the layout. Returns [{ key, k, ov, keep }]. keep: an overview arrow that has the real arrow of the
// map as its twin (the twin is not drawn on its own, so the overview arrow stays when the nodes around it show). On a flat map the
// arrows are the real ones and have no twins, so they all stay at Detalj.
export function kartEdges(data, has) {
  const ids = new Set(data.nodar.filter((n) => !n.utgaatt).map((n) => n.id));
  const kantar = (data.kantar || []).filter((k) => ids.has(k.fra) && ids.has(k.til));
  const flat = !(data.oversiktskantar || []).length;
  const ovk = flat ? kantar : data.oversiktskantar;
  const pair = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const out = [], ovKeys = new Map();
  ovk.forEach((k, i) => {
    if (!has(k.fra) || !has(k.til) || !DRAWN_TYPES.includes(k.type) || (flat && k.type === 'dekkjer')) return;
    const el = { key: 'o' + i, k, ov: true, keep: flat };
    ovKeys.set(k.type + '|' + pair(k.fra, k.til), el);
    out.push(el);
  });
  if (!flat) {
    kantar.forEach((k, i) => {
      if (!has(k.fra) || !has(k.til) || k.type === 'dekkjer') return;
      const dup = ovKeys.get(k.type + '|' + pair(k.fra, k.til));
      if (dup && !k.implisitt) { dup.keep = true; return; }
      out.push({ key: 'e' + i, k, ov: false, keep: false });
    });
  }
  return out;
}

// The tema view (one tema at a time): the nodes of the tema, the nodes of other temaa it is tied to by an explicit byggjer_paa arrow
// (the grey ones; `before` = what the tema builds on, `after` = what builds on the tema) and the arrows between them. Shared by the build
// (temalayout.mjs lays it out and routes the arrows) and the page (app.js draws it), so both agree on what is in the view.
//   opts.withoutForkunnskap: the same view for the map without the forkunnskap tema
// Arrow ids are `e<i>`, as for the arrows of the map (i = position in the arrows between nodes that exist); `grey` arrows tie a grey node to
// the tema (byggjer_paa only, implied ones too: they show when "Vis implisitte piler" is on). Arrows to kompetansemaal are never drawn.
export function temaMembers(data, cid, opts) {
  const noFk = !!(opts && opts.withoutForkunnskap);
  const live = data.nodar.filter((n) => !n.utgaatt);
  const byId = new Map(live.map((n) => [n.id, n]));
  const usable = (n) => !!n && n.type !== 'kompetansemaal' && !(noFk && n.forkunnskap);
  const group = (n) => (n.forkunnskap ? 'forkunnskap' : n.klynge || 'anna');
  const kantar = (data.kantar || []).filter((k) => byId.has(k.fra) && byId.has(k.til));
  const own = live.filter((n) => usable(n) && group(n) === cid).map((n) => n.id);
  const ownSet = new Set(own);
  const pre = new Map(), post = new Map(); // grey node -> number of explicit arrows that make it a prerequisite / a dependent
  const bump = (m, id) => m.set(id, (m.get(id) || 0) + 1);
  for (const k of kantar) {
    if (k.type !== 'byggjer_paa' || k.implisitt) continue;
    const a = byId.get(k.fra), b = byId.get(k.til);
    if (!usable(a) || !usable(b)) continue;
    if (ownSet.has(a.id) && !ownSet.has(b.id)) bump(pre, b.id); // the tema builds on b
    if (ownSet.has(b.id) && !ownSet.has(a.id)) bump(post, a.id); // a builds on the tema
  }
  const greyIds = [...new Set([...pre.keys(), ...post.keys()])].sort();
  const before = greyIds.filter((id) => (pre.get(id) || 0) >= (post.get(id) || 0)); // a node on both sides goes where it has more arrows
  const after = greyIds.filter((id) => !before.includes(id));
  const inView = new Set([...own, ...greyIds]);
  const edges = [];
  kantar.forEach((k, i) => {
    if (!inView.has(k.fra) || !inView.has(k.til) || !DRAWN_TYPES.includes(k.type) || k.type === 'dekkjer') return;
    const grey = !ownSet.has(k.fra) || !ownSet.has(k.til);
    if (grey && (k.type !== 'byggjer_paa' || (!ownSet.has(k.fra) && !ownSet.has(k.til)))) return;
    edges.push({ key: 'e' + i, k, grey });
  });
  return { own, before, after, edges, group };
}
