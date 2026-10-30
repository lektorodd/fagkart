// Graph algorithms over the edges (kantar) of a fagkart. Pure functions, no DOM, shared by the core and every layer.
// Direction: an edge { fra, til, type: 'byggjer_paa' } means that fra builds on til, so til is a prerequisite of fra.
//  - makeGraph(ids, kantar, opts): adjacency per edge type. Implied byggjer_paa edges only with opts.implicit.
//  - reach(g, starts, opts): every node reachable from the starts, in discovery order (depth first).
//  - topoOrder(g, ids): ids in learning order (prerequisites first).
//  - prerequisiteChain(g, id): "Kva må eg kunne før X?" — all prerequisites of id, in learning order.
//  - shortestPath(g, from, to, opts): the shortest chain of byggjer_paa edges from one node to another.
//  - readyToLearn(g, marks, ids): the nodes not yet mastered whose prerequisites are all mastered.
// The build inlines this file into the page after removing the `export` keywords, so keep it
// to plain declarations without imports.

const PRE = 'byggjer_paa';

// ids: the node ids in the map (their order breaks ties everywhere). Edges to or from other ids are left out.
// The explicit edges of a node come before its implied ones, in the order of kantar.
export function makeGraph(ids, kantar, opts) {
  const implicit = !!(opts && opts.implicit);
  const nodeIds = [...ids], known = new Set(nodeIds);
  const rank = new Map(nodeIds.map((id, i) => [id, i]));
  const out = new Map(), inn = new Map();
  const add = (k) => {
    if (!out.has(k.type)) { out.set(k.type, new Map()); inn.set(k.type, new Map()); }
    const o = out.get(k.type), i = inn.get(k.type);
    (o.get(k.fra) || o.set(k.fra, []).get(k.fra)).push(k.til);
    (i.get(k.til) || i.set(k.til, []).get(k.til)).push(k.fra);
  };
  const edges = (kantar || []).filter((k) => known.has(k.fra) && known.has(k.til));
  const isImpl = (k) => !!k.implisitt && k.type === PRE;
  for (const k of edges) if (!isImpl(k)) add(k);
  if (implicit) for (const k of edges) if (isImpl(k)) add(k);
  const get = (m, type, id) => (m.get(type) && m.get(type).get(id)) || [];
  return {
    ids: nodeIds,
    has: (id) => known.has(id),
    rank: (id) => (rank.has(id) ? rank.get(id) : Infinity),
    out: (type, id) => get(out, type, id), // edges fra = id: for byggjer_paa, the prerequisites of id
    inn: (type, id) => get(inn, type, id), // edges til = id: for byggjer_paa, what builds on id
    prereqs: (id) => get(out, PRE, id),
    dependents: (id) => get(inn, PRE, id),
  };
}

// Depth first from each start, in order. dir 'pre' follows the prerequisites, 'post' what builds on a node.
// through(id) decides whether the walk goes on past a reached node (it is listed either way).
// A start is only listed when it is reached from another start.
export function reach(g, starts, opts) {
  const dir = (opts && opts.dir) || 'pre', through = (opts && opts.through) || (() => true);
  const next = dir === 'post' ? g.dependents : g.prereqs;
  const seen = new Set(), out = [];
  const walk = (id) => {
    for (const p of next(id)) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      if (through(p)) walk(p);
    }
  };
  for (const s of starts) walk(s);
  return out;
}

// Kahn's algorithm on the subgraph of ids. Ties go to the node that comes first in the map.
// A cycle cannot be ordered: its nodes come last, in map order, so the result always holds every id once.
export function topoOrder(g, ids) {
  const set = new Set(ids == null ? g.ids : ids);
  const list = [...set].sort((a, b) => g.rank(a) - g.rank(b));
  const need = new Map(list.map((id) => [id, new Set(g.prereqs(id).filter((p) => set.has(p) && p !== id)).size]));
  const ready = list.filter((id) => need.get(id) === 0);
  const out = [], done = new Set();
  while (ready.length) {
    const id = ready.shift();
    out.push(id);
    done.add(id);
    let added = false;
    for (const d of new Set(g.dependents(id))) {
      if (!set.has(d) || done.has(d) || d === id) continue;
      need.set(d, need.get(d) - 1);
      if (need.get(d) === 0) { ready.push(d); added = true; }
    }
    if (added) ready.sort((a, b) => g.rank(a) - g.rank(b));
  }
  for (const id of list) if (!done.has(id)) out.push(id);
  return out;
}

// Everything id builds on, directly or through a chain, in learning order. id itself is not included.
export function prerequisiteChain(g, id) {
  return topoOrder(g, reach(g, [id]).filter((p) => p !== id));
}

// Breadth first along byggjer_paa, from a prerequisite towards what builds on it: [from, …, to], or null.
// With undirected: true the edges count both ways (a "snarveg" between any two nodes).
export function shortestPath(g, from, to, opts) {
  if (!g.has(from) || !g.has(to)) return null;
  if (from === to) return [from];
  const undirected = !!(opts && opts.undirected);
  const prev = new Map([[from, null]]), queue = [from];
  while (queue.length) {
    const id = queue.shift();
    const next = undirected ? [...g.dependents(id), ...g.prereqs(id)] : g.dependents(id);
    for (const n of next) {
      if (prev.has(n)) continue;
      prev.set(n, id);
      if (n === to) {
        const path = [n];
        for (let p = id; p != null; p = prev.get(p)) path.unshift(p);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

// marks: Map or object id -> 'ikkje' | 'delvis' | 'heilt' (the self-assessment scale). A node is ready to learn
// when it is not 'heilt' itself and all its prerequisites are. ids limits the candidates (default: all, map order).
export function readyToLearn(g, marks, ids) {
  const mark = (id) => (marks instanceof Map ? marks.get(id) : marks && marks[id]);
  const mastered = (id) => mark(id) === 'heilt';
  return (ids == null ? g.ids : [...ids]).filter((id) => g.has(id) && !mastered(id) && g.prereqs(id).every(mastered));
}
