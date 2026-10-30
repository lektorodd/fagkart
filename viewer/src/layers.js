// The layer registry of the viewer: layers are registered with registerLayer() and the core asks the active ones
// for styles, marks and card sections. Pure functions, no DOM or Cytoscape, so the composition is testable in Node.
// See docs/ARKITEKTUR.md § Lag-API for the hooks. The build inlines this file into the page after removing
// the `export` keywords, so keep it to plain declarations without imports.

// Higher wins. The selection itself (val) is drawn by the core above every layer.
export const PRIORITY = { tema: 10, markering: 20, sti: 30, val: 40 };

const HOOKS = ['init', 'styles', 'prepare', 'nodeStyle', 'nodeLabel', 'edgeStyle', 'clusterStyle', 'nodeCard', 'kmCard', 'toolbar', 'render', 'status', 'reveal', 'onSelect', 'viewport'];
const MODES = ['elev', 'laerar', 'faglogg'];

export function createLayerRegistry() {
  const layers = [];
  const sorted = () => layers.slice().sort((a, b) => a.priority - b.priority || a.order - b.order);

  function register(def) {
    if (!def || typeof def.id !== 'string' || !def.id) throw new Error('registerLayer: a layer needs an id');
    if (layers.some((l) => l.id === def.id)) throw new Error(`registerLayer: "${def.id}" is already registered`);
    for (const k of HOOKS) if (def[k] != null && typeof def[k] !== 'function') throw new Error(`registerLayer: ${def.id}.${k} must be a function`);
    const modes = def.modes || MODES;
    for (const m of modes) if (!MODES.includes(m)) throw new Error(`registerLayer: ${def.id}: unknown mode "${m}"`);
    const priority = typeof def.priority === 'number' ? def.priority : PRIORITY[def.priority || 'markering'];
    if (typeof priority !== 'number') throw new Error(`registerLayer: ${def.id}: unknown priority "${def.priority}"`);
    const layer = { ...def, modes, priority, cardSlot: def.cardSlot || 'bottom', order: layers.length };
    layers.push(layer);
    return layer;
  }

  // Layers in priority order (lowest first, so later ones win), only those available in the mode.
  const active = (mode) => sorted().filter((l) => !mode || l.modes.includes(mode));
  const call = (list, hook, args) => list.filter((l) => l[hook]).map((l) => ({ layer: l, value: l[hook](...args) }));

  // Merge the answers of nodeStyle / edgeStyle / clusterStyle. Classes add up; hide, fade and keep hold when any layer says so;
  // every other field (fill, ring, badge, …) comes from the layer with the highest priority that sets it.
  function merge(parts) {
    const out = { classes: [] };
    for (const { value } of parts) {
      if (!value) continue;
      for (const [k, v] of Object.entries(value)) {
        if (v == null) continue;
        if (k === 'classes') { for (const c of [].concat(v)) if (c && !out.classes.includes(c)) out.classes.push(c); }
        else if (k === 'hide' || k === 'fade' || k === 'keep') out[k] = out[k] || !!v;
        else out[k] = v;
      }
    }
    return out;
  }

  return {
    register,
    all: () => sorted(),
    active,
    get: (id) => layers.find((l) => l.id === id) || null,
    call: (mode, hook, ...args) => call(active(mode), hook, args),
    nodeStyle: (mode, node, ctx, el) => merge(call(active(mode), 'nodeStyle', [node, ctx, el])),
    edgeStyle: (mode, edge, ctx) => merge(call(active(mode), 'edgeStyle', [edge, ctx])),
    clusterStyle: (mode, cid, ctx) => merge(call(active(mode), 'clusterStyle', [cid, ctx])),
    // Extra label lines under the name, in priority order
    nodeLabel: (mode, node, ctx) => call(active(mode), 'nodeLabel', [node, ctx]).map((p) => p.value).filter((v) => v != null && v !== ''),
    // Card sections for one slot ('top' under the heading, 'bottom' after the links), in priority order
    cards: (mode, slot, node, ctx) => call(active(mode).filter((l) => l.cardSlot === slot), 'nodeCard', [node, ctx]).flatMap((p) => [].concat(p.value || [])).filter(Boolean),
    kmCards: (mode, km, ctx) => call(active(mode), 'kmCard', [km, ctx]).flatMap((p) => [].concat(p.value || [])).filter(Boolean),
  };
}
