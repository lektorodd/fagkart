/* Layer "stiar": one path at a time on the map. Two sources:
   (a) the prerequisite chain of a node ("Kva må eg kunne før dette?", a closed section in the card, shown on the map with "Vis på kartet"),
   (b) a løype from loeyper.yaml, picked in "Fleire val" and followed with Førre / Neste.
   The nodes of the active path carry the numbers 1…n as badges, everything else fades. The path is state of this layer only (not stored);
   it stays while other nodes are chosen. In the student view each step shows the mark of the layer "Kva kan eg?" (a coloured dot);
   in the teacher view the lists have no dots. Marks are only read (ctx.layer('eigenvurdering').mark), never written. */
(function () {
  'use strict';

  const MARKS = { ikkje: 'Kan ikkje enno', delvis: 'Kan delvis', heilt: 'Kan godt' };
  let active = null; // { kind: 'chain', id } | { kind: 'loeype', id } | null
  let cursor = -1; // index of the step last chosen in the active løype (-1: none yet)
  let path = null; // the active path as prepare() resolved it: { title, ids }
  let numbers = new Map(); // id -> number on the map
  let ui = null;

  const loeyper = (ctx) => (ctx.data.loeyper || []).map((l) => ({ ...l, ids: (l.nodar || []).filter((id) => ctx.byId.has(id)) }));
  const shown = (ctx, id) => ctx.state.showFk || !ctx.isFk(ctx.byId.get(id)); // "Vis forkunnskapar" off hides the forkunnskap nodes
  const chainOf = (ctx, id) => ctx.alg.prerequisiteChain(ctx.graph(), id).filter((p) => ctx.byId.has(p) && !ctx.isKm(ctx.byId.get(p)));

  // The active path as ids in order and a title; null when there is none (or the node / løype is gone from this map).
  function resolve(ctx) {
    if (!active) return null;
    if (active.kind === 'chain') {
      const n = ctx.byId.get(active.id);
      return n ? { title: `Føresetnader for «${n.namn}»`, ids: [...chainOf(ctx, n.id), n.id] } : null;
    }
    const l = loeyper(ctx).find((x) => x.id === active.id);
    return l ? { title: l.namn, ids: l.ids } : null;
  }

  function setActive(ctx, next) {
    active = next;
    cursor = -1;
    ctx.update();
    if (active) { const p = resolve(ctx); if (p) ctx.frame(p.ids.filter((id) => shown(ctx, id))); }
  }
  const clear = (ctx) => { active = null; cursor = -1; ctx.update(); };

  // The mark of the student on a node, or null in the teacher view (and when the layer "Kva kan eg?" is missing or the node is unmarked)
  function markOf(ctx, id) {
    if (ctx.mode !== 'elev') return null;
    const l = ctx.layer('eigenvurdering');
    return l && l.mark ? l.mark(id) : null;
  }
  // A step in a list: the link of the core, with a dot for the student's mark (student view only) and a tag for forkunnskap
  function stepItem(ctx, id, opts) {
    const { h } = ctx, n = ctx.byId.get(id);
    const li = ctx.nodeLink(id);
    li.classList.add('sti-step');
    li.dataset.id = id;
    if (opts && opts.now) { li.classList.add('sti-now'); li.setAttribute('aria-current', 'step'); }
    // one row: the dot of the mark (student view only), the link of the core and the tag for forkunnskap, so a long name wraps inside its own column
    const row = h('span', { class: 'sti-row' }, [...li.childNodes]);
    if (ctx.mode === 'elev') {
      const m = markOf(ctx, id);
      row.prepend(m
        ? h('span', { class: 'sti-dot sti-' + m, title: MARKS[m], role: 'img', 'aria-label': MARKS[m] })
        : h('span', { class: 'sti-dot sti-ingen', title: 'Ikkje markert', role: 'img', 'aria-label': 'Ikkje markert' }));
    }
    if (ctx.isFk(n) && shown(ctx, id)) row.append(h('span', { class: 'sti-tag' }, 'forkunnskap')); // a hidden one is already named "(forkunnskap)" by the core
    li.append(row);
    return li;
  }

  // ---------- Førre / Neste ----------
  // Where the student is in the løype: the chosen node when it is a step, else the step chosen last (-1: none yet)
  function position(ctx) {
    const i = path ? path.ids.indexOf(ctx.state.sel) : -1;
    if (i >= 0) cursor = i;
    return cursor;
  }
  function stepTo(ctx, dir) {
    const ids = path && active && active.kind === 'loeype' ? path.ids : [];
    let i = position(ctx) + dir;
    while (i >= 0 && i < ids.length && !shown(ctx, ids[i])) i += dir; // a hidden forkunnskap step is skipped
    if (i < 0 || i >= ids.length) return;
    cursor = i;
    ctx.select(ids[i], { center: true });
  }
  const canStep = (ctx, dir) => {
    if (!active || active.kind !== 'loeype' || !path) return false;
    for (let i = position(ctx) + dir; i >= 0 && i < path.ids.length; i += dir) if (shown(ctx, path.ids[i])) return true;
    return false;
  };
  function navList(ctx) {
    const { h } = ctx;
    const mk = (dir, text, attr) => {
      const b = h('button', { type: 'button', class: 'btn sti-nav', 'data-sti': attr }, text);
      b.disabled = !canStep(ctx, dir);
      b.addEventListener('click', () => stepTo(ctx, dir));
      return b;
    };
    return [mk(-1, 'Førre', 'forrige'), mk(1, 'Neste', 'neste')];
  }
  const removeButton = (ctx) => {
    const b = ctx.h('button', { type: 'button', class: 'btn sti-nav', 'data-sti': 'fjern' }, 'Fjern sti');
    b.addEventListener('click', () => clear(ctx));
    return b;
  };

  // ---------- "Fleire val": the løyper ----------
  function buildSection(ctx) {
    const { h } = ctx;
    ui = {
      active: h('div', { class: 'sti-active', 'data-sti-active': '' }),
      list: h('ul', { class: 'sti-routes' }),
      steps: h('div', { class: 'sti-stepsbox' }),
    };
    return h('div', { class: 'sti-sec' },
      h('p', { class: 'note' }, 'Ei løype er ei rekkjefølgje av omgrep og metodar som passar til eit føremål. Vel ei, så får stega nummer på kartet.'),
      ui.active, ui.list, ui.steps);
  }

  function renderSection(ctx) {
    if (!ui) return;
    const { h } = ctx, routes = loeyper(ctx);
    // an active chain (from a card) is named here too, with the way out
    ui.active.replaceChildren(...(active && active.kind === 'chain' && path
      ? [h('p', { class: 'sti-now-title' }, h('strong', null, 'Aktiv sti: '), path.title), removeButton(ctx)] : []));
    ui.active.hidden = !(active && active.kind === 'chain' && path);

    ui.list.replaceChildren(...(routes.length ? routes.map((l) => {
      const on = active && active.kind === 'loeype' && active.id === l.id;
      const b = h('button', { type: 'button', class: 'sti-route', 'aria-pressed': String(!!on), 'data-loeype': l.id },
        h('span', { class: 'sti-rname' }, ctx.rich(l.namn)),
        l.skildring ? h('span', { class: 'sti-rdesc' }, ctx.rich(l.skildring)) : null,
        h('span', { class: 'note' }, [(l.maalgruppe || []).length ? `For ${l.maalgruppe.map(ctx.fagLabel).join(', ')}` : null, `${l.ids.length} steg`].filter(Boolean).join(' · ')));
      b.addEventListener('click', () => setActive(ctx, on ? null : { kind: 'loeype', id: l.id }));
      return h('li', null, b);
    }) : [h('li', { class: 'empty' }, 'Dette kartet har ingen løyper enno.')]));

    const route = active && active.kind === 'loeype' && path ? path : null;
    ui.steps.hidden = !route;
    ui.steps.replaceChildren(...(route ? [
      h('h3', null, 'Stega i «', ctx.rich(route.title), '»'),
      h('ol', { class: 'sti-list', 'data-sti-steps': '' }, route.ids.map((id, i) => stepItem(ctx, id, { now: ctx.state.sel === id }))),
      h('div', { class: 'sti-actions' }, navList(ctx), removeButton(ctx)),
    ] : []));
  }

  // ---------- The card ----------
  // While a path is active the card says so, offers the way out and, for a løype, Førre / Neste. This bar sits at the top of the card
  // (cardSlot is per layer, so it is a small layer of its own, below): choosing a node closes "Fleire val", and on a phone the steps must stay in reach.
  function barCard(n, ctx) {
    if (!active || !path || ctx.isKm(n)) return null;
    const { h } = ctx, loeype = active.kind === 'loeype', at = loeype ? path.ids.indexOf(n.id) : -1;
    return h('div', { class: 'sti-bar', 'data-sti-bar': '' },
      h('p', { class: 'sti-now-title' }, h('strong', null, loeype ? 'Løype: ' : 'Sti: '), ctx.rich(path.title),
        loeype && at >= 0 ? h('span', { class: 'note' }, ` · steg ${at + 1} av ${path.ids.length}`) : null),
      h('div', { class: 'sti-actions' }, loeype ? navList(ctx) : [], removeButton(ctx)));
  }

  // "Kva må eg kunne før dette?": the prerequisite chain of the node in learning order, closed until opened
  function nodeCard(n, ctx) {
    if (ctx.isKm(n)) return null;
    const { h } = ctx, chain = chainOf(ctx, n.id);
    if (!chain.length) return null;
    const here = active && active.kind === 'chain' && active.id === n.id;
    const show = h('button', { type: 'button', class: 'btn sti-nav', 'data-sti': 'vis' }, 'Vis på kartet');
    show.addEventListener('click', () => setActive(ctx, { kind: 'chain', id: n.id }));
    return ctx.fold('stiar-foer', 'Kva må eg kunne før dette?', [
      h('ol', { class: 'sti-list', 'data-sti-chain': '' }, chain.map((id) => stepItem(ctx, id))),
      here ? h('p', { class: 'note' }, 'Kjeda står på kartet.') : h('div', { class: 'sti-actions' }, show),
    ], chain.length);
  }

  fagkart.registerLayer({
    id: 'stiar',
    label: 'Løyper',
    priority: 'sti',
    cardSlot: 'bottom',
    prepare(ctx) {
      path = resolve(ctx);
      if (active && !path) { active = null; cursor = -1; }
      numbers = new Map(path ? path.ids.map((id, i) => [id, i + 1]) : []);
    },
    nodeStyle(n, ctx, el) {
      if (!active || ctx.isKm(n)) return null;
      const k = numbers.get(n.id);
      if (k) return el.grey ? null : { badge: { tone: 'new', text: String(k), size: 12 }, keep: true }; // keep: a selection does not dim the steps
      return { fade: true };
    },
    nodeCard,
    toolbar: (ctx) => buildSection(ctx),
    render: (ctx) => renderSection(ctx),
    status: (ctx) => (active && path ? (active.kind === 'loeype' ? ctx.lab(path.title) : 'føresetnadskjede') : ''),
  });

  fagkart.registerLayer({ id: 'stiar-linje', label: 'Aktiv sti', priority: 5, cardSlot: 'top', nodeCard: barCard });
})();
