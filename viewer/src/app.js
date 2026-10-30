/* Fagkart viewer. Reads the dist JSON (fagkart/1) embedded in the page and renders it with Cytoscape.
   One zoom surface with three levels, not separate views. The positions are fixed (computed by build.mjs, layout.mjs):
     Tema    far out: one box per tema (klynge) with name, counts and the arrows between the temaa
     Kart    the boxes have opened and show the level 1 nodes (concepts and rules)
     Detalj  close up: the level 2 nodes show around them
   The zoom alone decides the level (renderLevels); the buttons Tema · Kart · Detalj only fly to a level.
   A click on a tema opens the tema view (state.tema): one tema at a time, its nodes big in a frame, the nodes of other temaa it is tied to
   small and grey outside it, only the arrows between them. It has its own fixed layout (layout.tema, from temalayout.mjs) and replaces the
   elements of the surface; "Alle tema", Escape and the level buttons go back.
   The switch "Vis forkunnskapar" (state.showFk) leaves the forkunnskap nodes, their edges and their tema out of every level;
   there is a second fixed layout for it, so the map tightens instead of leaving a hole. */
(function () {
  'use strict';

  const data = JSON.parse(document.getElementById('fagkart-data').textContent);
  const KODE = data.kode || data.laereplan; // the map code (kart/<KODE>/); older builds have no kode, and there the curriculum code was the map code
  const $ = (id) => document.getElementById(id);
  // Layers (layers.js, inlined before this script) register through window.fagkart.registerLayer; see docs/ARKITEKTUR.md.
  // The built-in ones (viewer/src/lag/) and any extra ones come after this script; the page starts once the fonts are loaded.
  const LAYERS = createLayerRegistry();
  let started = false;
  // Plain-text label of a text with LaTeX (texlabel.js): the map, tema boxes, page title, search. Cached.
  const labCache = new Map();
  const lab = (s) => { let v = labCache.get(s); if (v === undefined) { v = texLabel(s); labCache.set(s, v); } return v; };
  // Positions of the map, computed by build.mjs (layout.mjs). null when the map has no nodes to draw.
  // A layout carries the one without the forkunnskap tema as `utanForkunnskap` (null when the map has no forkunnskap), and the wide one
  // carries the pair packed for a tall stage as `smal` (a phone held upright): pickLayouts() takes the pair that fits the screen.
  const LAYOUT_RAW = (() => { try { return JSON.parse($('fagkart-layout').textContent); } catch (e) { return null; } })();
  const PORTRAIT = window.matchMedia('(max-aspect-ratio: 19/20)');
  let LAYOUT_FULL = LAYOUT_RAW, LAYOUT_NOFK = null;
  let LAYOUT = LAYOUT_FULL; // the layout of the current state of the switch

  // ---------- Labels (Nynorsk) ----------
  const TYPE_LABEL = { omgrep: 'Omgrep', prosedyre: 'Prosedyre', forklaring: 'Forklaring', representasjon: 'Representasjon', kompetansemaal: 'Kompetansemål' };
  const VERB_LABEL = { kjenne_til: 'Kjenne til', bruke: 'Bruke', forklare: 'Forklare', vurdere: 'Vurdere' };
  const EDGE_DEFS = [
    ['byggjer_paa', 'Byggjer på'],
    ['brukar', 'Brukar'],
    ['doeme_paa', 'Døme på'],
    ['representerast_som', 'Representerast som'],
    ['forvekslast_med', 'Forvekslast med'],
    ['dekkjer', 'Dekkjer kompetansemål'],
  ];
  const FLOW_TYPES = new Set(['byggjer_paa', 'brukar', 'doeme_paa', 'representerast_som']);

  // ---------- Data model ----------
  const nodes = data.nodar.filter((n) => !n.utgaatt);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kantar = (data.kantar || []).filter((k) => byId.has(k.fra) && byId.has(k.til));
  const isKm = (n) => n.type === 'kompetansemaal';
  const isFk = (n) => !!n.forkunnskap;
  const groupOf = (n) => (isFk(n) ? 'forkunnskap' : n.klynge || 'anna');
  const fagList = data.forkunnskapsfag || [];
  // a background key may be a route such as '1T-S1' (1T, then S1); it is shown as '1T → S1'
  const fagLabel = (f) => String(f).replace(/-/g, ' → ');
  const kjerneNamn = new Map((data.kjerneelement || []).map((k) => [k.id, lab(k.namn)]));
  const kmNodes = nodes.filter(isKm);

  const EDGE_TYPES = new Set(EDGE_DEFS.map(([t]) => t));
  // graph.js (inlined before this script): the implied byggjer_paa edges only count while they are shown (state.showImplicit)
  const GRAPH = makeGraph(nodes.map((n) => n.id), kantar);
  const GRAPH_IMPL = makeGraph(nodes.map((n) => n.id), kantar, { implicit: true });
  const graph = () => (state.showImplicit ? GRAPH_IMPL : GRAPH);
  const relOut = (t, id) => graph().out(t, id);
  const relIn = (t, id) => graph().inn(t, id);

  function pretty(slug) {
    const s = String(slug).replace(/[-_]/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const klyngeNamn = new Map((data.klyngjer || data.klynger || []).map((k) => [k.id, lab(k.namn)]));
  const klyngeLabel = (id) => lab(klyngeNamn.get(id) || '') || (id === 'forkunnskap' ? 'Forkunnskap' : pretty(id));
  const norm = (s) => String(s).toLowerCase();

  // ---------- Temaa (the klyngjer of the data) ----------
  // Order: forkunnskap first, then the order of data.klyngjer, then anything only found on nodes.
  const CLUSTERS = (() => {
    const ids = [];
    if (nodes.some(isFk)) ids.push('forkunnskap');
    for (const k of data.klyngjer || data.klynger || []) if (!ids.includes(k.id)) ids.push(k.id);
    for (const n of nodes) if (!isKm(n) && !ids.includes(groupOf(n))) ids.push(groupOf(n));
    return ids.filter((id) => nodes.some((n) => !isKm(n) && groupOf(n) === id));
  })();
  const clusterNodes = new Map(CLUSTERS.map((id) => [id, nodes.filter((n) => !isKm(n) && groupOf(n) === id)]));
  const clusterKm = new Map(CLUSTERS.map((id) => [id, new Set(clusterNodes.get(id).flatMap((n) => n.km || []))]));
  // metaCount.get("A|B") = number of explicit byggjer_paa edges from a node in A to a node in B (A != B)
  const metaCount = new Map();
  for (const k of kantar) {
    if (k.type !== 'byggjer_paa' || k.implisitt) continue;
    const a = byId.get(k.fra), b = byId.get(k.til);
    if (isKm(a) || isKm(b)) continue;
    const ga = groupOf(a), gb = groupOf(b);
    if (ga === gb) continue;
    metaCount.set(ga + '|' + gb, (metaCount.get(ga + '|' + gb) || 0) + 1);
  }
  const hasTema = CLUSTERS.length >= 2;
  const hasKart = !!(LAYOUT_RAW && LAYOUT_RAW.nodes && LAYOUT_RAW.areas && Object.keys(LAYOUT_RAW.nodes).length);
  const hasFk = nodes.some(isFk);
  // "Vis forkunnskapar": the choice is remembered per viewer; ?forkunnskap=av in the URL wins over it.
  const FK_KEY = 'fagkart.visForkunnskap';
  function loadShowFk() {
    if (!hasFk) return true;
    try {
      const q = new URLSearchParams(location.search).get('forkunnskap');
      if (q != null) { const v = q.trim().toLowerCase(); if (v === 'av') return false; if (v === 'pa' || v === 'på') return true; }
    } catch (e) { /* no URL access: use the stored choice */ }
    try { if (localStorage.getItem(FK_KEY) === 'av') return false; } catch (e) { /* storage blocked: default */ }
    return true;
  }
  function saveShowFk(on) { try { localStorage.setItem(FK_KEY, on ? 'pa' : 'av'); } catch (e) { /* storage blocked: the choice lasts for this visit */ } }
  // "Lærar | Elev": ?vising=elev or ?vising=laerar in the URL wins over the remembered choice (the link for the students has ?vising=elev)
  const VISING_KEY = 'fagkart.vising';
  // Host mode: ?vising=faglogg means the page sits in an iframe in Faglogg, which sends overlays in and gets the chosen node out (postMessage,
  // see docs/ARKITEKTUR.md § Integrasjonar). The page stores nothing of the overlay and has no "Lærar | Elev" switch; the host picks the text field.
  const HOST = (() => {
    try { const q = new URLSearchParams(location.search).get('vising'); return q != null && q.trim().toLowerCase() === 'faglogg'; } catch (e) { return false; }
  })();
  // Rooms (docs/FORMAT.md § Rom, innspel/README.md): ?rom=<id> opens the page in a room, and the layer "kommentarar" exists only then. The rooms live in
  // the service (innspel/api/, same origin as the maps): a hosted page asks it for the open rooms of this map (rom?kart=<KODE>) and remembers the list
  // (fagkart.<KODE>.romliste), so a room opens without the service too. A downloaded copy (file://) has only the remembered list. No list, no room:
  // the message "Fann ikkje rommet". The room is remembered per map (fagkart.<KODE>.rom); the URL wins. A room always opens in the teacher view.
  // Never in host mode. No network call is made unless a room is asked for (link or remembered), and nothing but the id of the room (and a name
  // for the form, &namn=) is in the URL.
  const ROM_KEY = `fagkart.${KODE}.rom`;
  const ROMLISTE_KEY = `fagkart.${KODE}.romliste`;
  const ROOM = { room: null, unknown: null, offline: false }; // set by loadRoom() before the page starts: the room, or the id of a room that was asked for and is not there
  const ROOM_ASKED = (() => { // the room in the link (as written), or null
    if (HOST) return null;
    try { const q = new URLSearchParams(location.search).get('rom'); return q != null && q.trim() ? q.trim() : null; } catch (e) { return null; }
  })();
  // A room as the service gives it, or null when it is not one for this map
  function cleanRoom(r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id) || typeof r.namn !== 'string' || !r.namn || r.kart !== KODE) return null;
    const out = { id: r.id, namn: r.namn, kart: r.kart };
    if (Array.isArray(r.kategoriar) && r.kategoriar.every((k) => typeof k === 'string' && k)) out.kategoriar = r.kategoriar;
    if (typeof r.merknad === 'string' && r.merknad) out.merknad = r.merknad;
    return out;
  }
  async function loadRoom() {
    if (HOST) return;
    let stored = null;
    try { stored = localStorage.getItem(ROM_KEY); } catch (e) { /* storage blocked: no remembered room */ }
    const want = ROOM_ASKED ? ROOM_ASKED.toLowerCase() : stored;
    if (!want) return; // no room: nothing is asked of anyone
    let rooms = null;
    const base = typeof innspelBase === 'function' ? innspelBase(location) : null; // builds without src/innspel.js have no service
    if (base) {
      try {
        const list = await innspelKall(base, `rom?kart=${encodeURIComponent(KODE)}`, { timeout: 4000 });
        if (Array.isArray(list)) {
          rooms = list.map(cleanRoom).filter(Boolean);
          try { localStorage.setItem(ROMLISTE_KEY, JSON.stringify(rooms)); } catch (e) { /* storage blocked: the list lasts for this visit */ }
        }
      } catch (e) { ROOM.offline = true; /* no service, no net: the remembered list */ }
    }
    if (!rooms) {
      try { const l = JSON.parse(localStorage.getItem(ROMLISTE_KEY) || '[]'); rooms = Array.isArray(l) ? l.map(cleanRoom).filter(Boolean) : []; } catch (e) { rooms = []; }
    }
    const found = rooms.find((r) => r.id === want) || null;
    if (ROOM_ASKED) {
      if (!found) { ROOM.unknown = ROOM_ASKED; return; }
      try { localStorage.setItem(ROM_KEY, found.id); } catch (e) { /* storage blocked: the room lasts for this visit */ }
    }
    ROOM.room = found;
  }
  // Out of the room: forget it and open the page again without ?rom= (the layer has forgotten its token first)
  function leaveRoom() {
    try { localStorage.removeItem(ROM_KEY); } catch (e) { /* storage blocked: nothing was stored */ }
    const u = new URL(location.href);
    u.searchParams.delete('rom');
    u.searchParams.delete('namn');
    location.replace(u.href);
  }
  // The student link (?vising=elev) has no "Lærar | Elev" switch: the students have no use for the teacher view. Tidying, not a lock: without
  // the parameter the page has the switch again.
  const ELEV_LINK = (() => {
    try {
      const q = new URLSearchParams(location.search).get('vising');
      if (q != null) return q.trim().toLowerCase() === 'elev';
    } catch (e) { /* no URL access: no student link */ }
    return false;
  })();
  function loadElev() {
    if (HOST) return false; // the teacher's text until the host says otherwise (fagkart:vising)
    try {
      const q = new URLSearchParams(location.search).get('vising');
      if (q != null) { const v = q.trim().toLowerCase(); if (v === 'elev') return true; if (v === 'laerar' || v === 'lærar') return false; }
    } catch (e) { /* no URL access: use the stored choice */ }
    if (ROOM_ASKED) return false; // the link to a room opens the teacher view
    try { return localStorage.getItem(VISING_KEY) === 'elev'; } catch (e) { return false; } // storage blocked: the teacher view
  }
  function saveElev(elev) { try { localStorage.setItem(VISING_KEY, elev ? 'elev' : 'laerar'); } catch (e) { /* storage blocked: the choice lasts for this visit */ } }
  // "Tekststorleik": how big the text of the map is at Kart and Detalj (it moves the zoom anchors), remembered per viewer
  const TEXT_KEY = 'fagkart.tekststorleik';
  const TEXT_SIZES = [['liten', 'Liten', 0.85], ['normal', 'Normal', 1], ['stor', 'Stor', 1.25]];
  function loadTextSize() {
    try { const v = localStorage.getItem(TEXT_KEY); if (TEXT_SIZES.some(([k]) => k === v)) return v; } catch (e) { /* storage blocked: default */ }
    return 'normal';
  }
  // "Vis alle omgrep og metodar": every node and arrow is drawn at every zoom (the zoom no longer hides the levels), remembered per viewer
  const ALT_KEY = 'fagkart.visAlt';
  function loadShowAll() { try { return localStorage.getItem(ALT_KEY) === 'pa'; } catch (e) { return false; } }
  function saveShowAll(on) { try { localStorage.setItem(ALT_KEY, on ? 'pa' : 'av'); } catch (e) { /* storage blocked: the choice lasts for this visit */ } }
  // "Kva kan eg?" in the top bar (student view): on, the map is line work and the colours of the self-assessment are the only ones; off, the
  // plain map. Remembered per map; the first time it is off
  const EV_KEY = `fagkart.${KODE}.evvising`;
  function loadEv() { try { return localStorage.getItem(EV_KEY) === 'pa'; } catch (e) { return false; } }
  function saveEv(on) { try { localStorage.setItem(EV_KEY, on ? 'pa' : 'av'); } catch (e) { /* storage blocked: the choice lasts for this visit */ } }
  function saveTextSize(v) { try { localStorage.setItem(TEXT_KEY, v); } catch (e) { /* storage blocked: the choice lasts for this visit */ } }

  // ---------- State ----------
  // The core's view state. Layers keep their own settings; the few fields a layer sets here are marked.
  const state = {
    level: 'tema', // tema | kart | detalj: set by the zoom (renderLevels), read by layers (ctx.level); always detalj in the tema view
    tema: null, // the tema that is open in the tema view (id), or null on the zoom surface; set by openTema / leaveTema, read by layers (ctx.tema)
    strek: false, // line work: the map drawn without its own colours (grey borders, plain fill, outlined temaa), so the colours of an overlay are the only ones. Host mode, while Faglogg has an overlay on; student view, while "Kva kan eg?" is on (setStrek)
    elev: loadElev(), // student view; the choice is remembered, ?vising=elev | laerar in the URL wins. In host mode: which text the card shows (set by the host, never stored)
    ev: !HOST && loadEv(), // "Kva kan eg?" is on (student view only): read by the layer eigenvurdering, set by setEv
    showImplicit: false, // set by the layer "implisitte": graph() counts the implied edges while it is on
    showKoplingar: false, // set by the layer "koplingar": the arrows that are not byggjer_paa are drawn while it is on (the legend follows)
    tekst: loadTextSize(), // liten | normal | stor: the text size of the map
    alt: loadShowAll(), // true: all nodes at every zoom; the level (buttons, hint) still follows the zoom
    showFk: loadShowFk(), // false: the forkunnskap nodes, all their edges and their tema are left out everywhere
    rom: null, // the room the page is open in ({ id, namn, kart, kategoriar?, merknad? } from the service), or null: set by start(), read by the layer kommentarar
    sel: null,
    km: null,
    q: '',
  };

  function pickLayouts() {
    const base = LAYOUT_RAW && PORTRAIT.matches && LAYOUT_RAW.smal ? LAYOUT_RAW.smal : LAYOUT_RAW;
    LAYOUT_FULL = base;
    LAYOUT_NOFK = (base && base.utanForkunnskap) || null;
    LAYOUT = !state.showFk && LAYOUT_NOFK ? LAYOUT_NOFK : LAYOUT_FULL;
  }
  pickLayouts();
  state.strek = !HOST && state.elev && state.ev;
  const mode = () => (HOST ? 'faglogg' : state.elev ? 'elev' : 'laerar'); // which layers are available (registerLayer({ modes }))
  // What the switch hides: every node with a `forkunnskap` field. Edges follow their nodes.
  const visNode = (n) => state.showFk || !isFk(n);
  const activeClusters = () => (state.showFk ? CLUSTERS : CLUSTERS.filter((c) => c !== 'forkunnskap'));
  const metaPairs = () => [...metaCount].filter(([key]) => state.showFk || !key.split('|').includes('forkunnskap'));

  // ---------- Tiny DOM helper ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'onclick') el.addEventListener('click', v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }

  // ---------- Math in text ----------
  // Text fields hold LaTeX ($...$, $$...$$) and `code`; everything else is plain text (never HTML).
  // segments() and texLabel() come from texlabel.js, inlined before this script.
  function rich(str) {
    const f = document.createDocumentFragment();
    for (const sg of segments(str)) {
      if (sg.kind === 'text') { f.append(document.createTextNode(sg.src)); continue; }
      if (sg.kind === 'code') { f.append(h('code', null, sg.src)); continue; }
      const disp = sg.kind === 'display';
      const el = document.createElement('span');
      try {
        if (typeof katex === 'undefined') throw new Error('KaTeX missing');
        el.innerHTML = katex.renderToString(sg.src, { throwOnError: true, displayMode: disp, strict: 'ignore', trust: false });
        el.className = disp ? 'tex tex-d' : 'tex';
      } catch (e) {
        el.className = 'tex-err';
        el.title = String(e.message || e).split('\n')[0];
        el.textContent = disp ? `$$${sg.src}$$` : `$${sg.src}$`;
      }
      f.append(el);
    }
    return f;
  }
  // search matches both the label form and the raw name
  const nameHit = (n, q) => norm(n.namn).includes(q) || norm(lab(n.namn)).includes(q);

  // ---------- Kva er nytt (endringar.js) ----------
  // The version log of the map (dist/<KODE>.endringar.json, put in the page by build.mjs), or null. The box sits in the help box ("?"), after the version;
  // it is drawn again when the view changes between teacher and student (the student view leaves the names of the changed fields out).
  const ENDRINGAR = (() => { try { return JSON.parse($('fagkart-endringar').textContent); } catch (e) { return null; } })();
  let nyttElev = null; // the view the box was drawn for
  function renderNytt() {
    const box = $('nytt');
    if (!box || nyttElev === state.elev) return;
    nyttElev = state.elev;
    const view = endringarView(ENDRINGAR, { elev: state.elev });
    box.textContent = '';
    box.hidden = !view;
    if (!view) return;
    // a name that is in the map is a button that chooses the node; a deleted one (or one that is gone since) is plain text
    const pick = (id) => {
      const n = byId.get(id);
      if (!n) return;
      if (!visNode(n)) setShowFk(true, false);
      setHelp(false);
      select(id, { center: true });
    };
    const row = (r, live) => h('li', null,
      live && byId.has(r.id) ? h('button', { class: 'linkbtn', type: 'button', onclick: () => pick(r.id) }, rich(r.namn)) : h('span', null, rich(r.namn)),
      r.felt && r.felt.length ? h('span', { class: 'note' }, ` · ${r.felt.join(', ')}`) : null);
    // a long list shows its first rows, the rest is one click away
    const SHOWN = 8;
    const list = (title, rows, live) => {
      if (!rows.length) return [];
      const fold = rows.length > SHOWN + 2;
      const ul = (part) => h('ul', { class: 'nytt-liste' }, part.map((r) => row(r, live)));
      return [h('h5', null, `${title} (${rows.length})`), ul(fold ? rows.slice(0, SHOWN) : rows),
        fold ? h('details', { class: 'nytt-fleire' }, h('summary', null, `Vis ${rows.length - SHOWN} til`), ul(rows.slice(SHOWN))) : null];
    };
    const body = (v, heading) => {
      const parts = [h(heading, null, `Kva er nytt i ${v.versjon}`), h('p', { class: 'note' }, v.innspel ? `${v.dato} · etter ${v.innspel} innspel` : v.dato)];
      if (v.samandrag) parts.push(h('p', { class: 'nytt-samandrag' }, rich(v.samandrag)));
      if (!v.utrekna) return parts;
      parts.push(...list('Nytt', v.nye, true), ...list('Endra', v.endra, true), ...list('Sletta', v.sletta, false));
      if (!v.nye.length && !v.endra.length && !v.sletta.length) parts.push(h('p', { class: 'note' }, 'Ingen nodar er nye, endra eller sletta.'));
      if (v.piler.nye || v.piler.fjerna) parts.push(h('p', { class: 'note' }, `${v.piler.nye} nye piler · ${v.piler.fjerna} fjerna`));
      return parts;
    };
    box.append(h('div', { class: 'nytt-v' }, body(view.naa, 'h3')));
    if (view.eldre.length) {
      box.append(h('details', { class: 'nytt-eldre' }, h('summary', null, 'Tidlegare versjonar'),
        view.eldre.map((v) => h('div', { class: 'nytt-v' }, body(v, 'h4')))));
    }
  }
  // the help box ("?"): open or closed
  function setHelp(open) {
    $('helpBox').hidden = !open;
    $('helpBtn').setAttribute('aria-expanded', String(open));
  }

  // ---------- Colors ----------
  function tokens() {
    const css = getComputedStyle(document.documentElement);
    const t = (k) => css.getPropertyValue(k).trim();
    return {
      ink: t('--lo-ink'), inkStrong: t('--lo-ink-strong'), surface: t('--lo-surface'), white: t('--lo-white'), cream: t('--lo-cream'),
      muted: t('--lo-muted'), borderStrong: t('--lo-border-strong'), red: t('--lo-red'), warn: t('--lo-warn'),
      mint: t('--lo-mint'), mintDeep: t('--lo-mint-deep'), blue: t('--lo-blue'), blueDark: t('--lo-blue-dark'), green: t('--lo-green'), violet: t('--lo-violet'),
      tavle: t('--lo-tavle'), onAccent: t('--lo-on-accent'), tint: parseFloat(t('--tint')) || 0.14,
    };
  }
  function mix(a, b, w) {
    const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const A = p(a), B = p(b);
    return '#' + A.map((v, i) => Math.round(v * w + B[i] * (1 - w)).toString(16).padStart(2, '0')).join('');
  }
  // The colour of a tema: the Lektorodd palette, picked by the id alone (temaSlot in tema.js), so it is the same on the tema box,
  // the area and the poster, in every map and on every visit. Forkunnskap is always the quiet grey.
  function temaColor(cid, c) {
    c = c || tokens();
    if (cid === 'forkunnskap') return c.muted;
    return [c.blue, c.green, c.violet, c.warn, c.red, c.mintDeep, c.blueDark, mix(c.red, c.violet, 0.5)][temaSlot(cid)];
  }

  const SANS = '"Source Sans 3", system-ui, sans-serif';
  const MONO = '"JetBrains Mono", ui-monospace, monospace';
  const DISPLAY = '"Space Grotesk", "Source Sans 3", sans-serif';

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  function buildStyle() {
    const c = tokens();
    const areaCol = (cid) => temaColor(cid, c);
    // tt: how much the tema is a box of its own (1 at Tema, 0 once it has opened into its area)
    // the area is solid: the paper under it is plain, so nothing shines through
    const areaTint = (cid, tt) => mix(areaCol(cid), c.surface, lerp(cid === 'forkunnskap' ? 0.12 : c.tint * 1.5, cid === 'forkunnskap' ? 0.14 : 0.24, tt));
    const areaLine = (cid, tt) => (state.strek ? mix(c.ink, c.surface, 0.42) : mix(areaCol(cid), c.surface, lerp(0.55, 0.95, tt)));
    const typeCol = { omgrep: c.blue, prosedyre: c.green, forklaring: c.violet, representasjon: c.warn };
    // Line work (state.strek): the type stays in the shape and a grey border, the fill is plain paper, the temaa are outlines and the
    // arrows grey, so every colour on the page comes from the overlay. The rules below take their colours through these.
    const strek = state.strek, line = mix(c.ink, c.surface, 0.55);
    const tBorder = (col, w) => (strek ? line : w == null ? col : mix(col, c.surface, w));
    const tFill = (col, w) => (strek ? c.surface : mix(col, c.surface, w));
    const eCol = (col) => (strek ? line : col);
    const pill = (bg, fg) => ({ 'background-opacity': 1, 'background-color': bg, color: fg, shape: 'round-rectangle', 'corner-radius': 9,
      'font-family': SANS, 'font-size': 'data(fs)', 'font-weight': 700, 'text-max-width': '400px' });
    const st = [
      { selector: 'node', style: {
        shape: 'round-rectangle', width: 'data(w)', height: 'data(h)', padding: 0, label: 'data(label)',
        'text-wrap': 'wrap', 'text-max-width': '94px', 'text-valign': 'center', 'text-halign': 'center', 'text-justification': 'center',
        'font-family': SANS, 'font-size': 14, 'font-weight': 600, 'line-height': 1.15, color: c.ink,
        'background-color': c.surface, 'border-width': 1.6, 'border-color': c.muted, 'min-zoomed-font-size': 5,
        'overlay-opacity': 0, 'underlay-opacity': 0, 'underlay-color': c.mint, 'underlay-padding': 7, 'underlay-shape': 'round-rectangle',
      } },
      ...Object.entries(typeCol).map(([t, col]) => ({ selector: `node[type="${t}"]`, style: { 'border-color': tBorder(col), 'background-color': tFill(col, c.tint) } })),
      { selector: 'node[type="prosedyre"]', style: { shape: 'cut-rectangle' } },
      { selector: 'node[type="forklaring"]', style: { shape: 'barrel' } },
      { selector: 'node[type="representasjon"]', style: { shape: 'round-rectangle', 'corner-radius': 22 } },
      // forkunnskap: dashed border, plain paper fill
      { selector: 'node[?fk]', style: { 'border-style': 'dashed', 'border-width': 2, 'background-color': c.white } },
      // ghost nodes carry the badges next to a real node or a tema box; they never take events
      { selector: 'node.ghost', style: { events: 'no', 'background-opacity': 0, 'border-width': 0, width: 'data(w)', height: 'data(h)', label: 'data(label)',
        'text-wrap': 'wrap', 'text-valign': 'center', 'text-halign': 'center', 'text-justification': 'center', 'overlay-opacity': 0, 'z-index': 30, 'min-zoomed-font-size': 4 } },
      { selector: 'node.ghost[role="pill-new"]', style: pill(c.blue, c.onAccent) },
      { selector: 'node.ghost[role="pill-rep"]', style: pill(c.mint, '#15202B') },
      { selector: 'node.ghost[role="pill-part"]', style: pill(c.warn, '#15202B') },
      { selector: 'node.ghost[role="pill-hole"]', style: pill(c.red, c.onAccent) },
      { selector: 'node.ghost[role="pill-ok"]', style: pill(c.mint, '#15202B') },
      { selector: 'edge', style: {
        width: 1.8, 'line-color': c.muted, 'curve-style': 'bezier', 'control-point-step-size': 36, 'target-arrow-shape': 'triangle',
        'target-arrow-color': c.muted, 'arrow-scale': 1, opacity: 0.85 } },
      { selector: 'edge[type="byggjer_paa"]', style: { width: 2, 'line-color': c.muted, 'target-arrow-color': c.muted } },
      { selector: 'edge[type="brukar"]', style: { width: 1.7, 'line-color': eCol(c.green), 'target-arrow-color': eCol(c.green), 'target-arrow-shape': 'vee' } },
      { selector: 'edge[type="doeme_paa"]', style: { width: 2, 'line-color': eCol(c.violet), 'target-arrow-color': eCol(c.violet), 'target-arrow-shape': 'circle', 'line-style': 'dotted' } },
      { selector: 'edge[type="representerast_som"]', style: { width: 2, 'line-color': eCol(c.warn), 'target-arrow-color': eCol(c.warn), 'target-arrow-shape': 'diamond' } },
      { selector: 'edge[type="forvekslast_med"]', style: { width: 2.2, 'line-color': eCol(c.red), 'line-style': 'dashed', 'line-dash-pattern': [7, 5], 'target-arrow-shape': 'none', opacity: 0.9 } },
      { selector: 'edge[type="dekkjer"]', style: { width: 1.2, 'line-color': eCol(c.mintDeep), 'target-arrow-color': eCol(c.mintDeep), 'target-arrow-shape': 'triangle-tee', 'line-style': 'dotted', opacity: 0.8 } },
      { selector: 'edge[?fkedge]', style: { opacity: 0.38, width: 1.3 } },
      { selector: 'edge[?impl]', style: { 'line-style': 'dotted', opacity: 0.55 } },
      // ---- the arrows between the tema boxes: width and label are the number of byggjer_paa edges. cpd bends the arrow around the other boxes ----
      { selector: 'edge[?meta]', style: {
        width: 'data(w)', 'line-color': c.muted, 'line-style': 'solid', 'target-arrow-color': c.muted, 'target-arrow-shape': 'triangle', 'arrow-scale': 1.2, opacity: 'data(op)', 'z-index': 30 } },
      // the number on such an arrow is a node of its own (kind mlab), so it can sit where no other arrow or box is
      { selector: 'node[kind="mlab"]', style: {
        shape: 'round-rectangle', width: 'data(w)', height: 'data(h)', 'corner-radius': 'data(cr)', padding: 0, events: 'no', 'background-color': c.cream, 'background-opacity': 1, 'border-width': 0,
        label: 'data(label)', 'text-valign': 'center', 'text-halign': 'center', 'font-family': MONO, 'font-size': 'data(fs)', 'font-weight': 700, color: c.inkStrong,
        opacity: 'data(op)', 'z-index': 40, 'overlay-opacity': 0, 'underlay-opacity': 0, 'min-zoomed-font-size': 0 } },
      // ---- sizes, opacities and fonts of the nodes come from data that renderLevels() sets from the zoom ----
      // [cw][ch][cr][bw][lop] keep the mappings off the 1P/1T badges, which carry `kart` but none of these fields
      { selector: 'node[?kart][cw][ch][cr][bw][lop]', style: {
        width: 'data(cw)', height: 'data(ch)', 'corner-radius': 'data(cr)', 'border-width': 'data(bw)', 'font-size': 'data(fs)',
        'text-opacity': 'data(lop)', opacity: 'data(op)', 'text-max-width': '320px', 'line-height': 1.15, 'min-zoomed-font-size': 4 } },
      ...Object.entries(typeCol).map(([t, col]) => ({ selector: `node[?kart][lvl=2][type="${t}"]`, style: {
        'background-color': tFill(col, c.tint * 0.55), 'border-color': tBorder(col, 0.6) } })),
      { selector: 'node[?kart][lvl=2]', style: { 'font-weight': 500, 'border-style': 'solid', shape: 'round-rectangle', color: c.ink } },
      { selector: 'node[?kart][lvl=2][?fk]', style: { 'background-color': c.white, 'border-style': 'dashed' } },
      // the tema: a box far out that opens into its area, in one colour all the way
      { selector: 'node[kind="carea"][bgop]', style: {
        shape: 'round-rectangle', 'corner-radius': 'data(cr)', width: 'data(cw)', height: 'data(ch)', padding: 0, events: 'no',
        'background-color': (e) => areaTint(e.data('cid'), e.data('tt')), 'background-opacity': strek ? 0 : 'data(bgop)',
        'border-width': 'data(abw)', 'border-color': (e) => areaLine(e.data('cid'), e.data('tt')), 'border-opacity': 'data(bop)', 'border-style': 'solid',
        'z-index': 0, 'z-compound-depth': 'bottom', 'overlay-opacity': 0, 'underlay-opacity': 0 } },
      { selector: 'node[kind="carea"][?fk]', style: { 'border-style': 'dashed' } },
      // the name of a tema is its own node, so it can move from the middle of the box to the top of the area
      { selector: 'node[kind="clabel"]', style: {
        shape: 'rectangle', width: 2, height: 2, 'background-opacity': 0, 'border-width': 0, events: 'no', 'z-index': 60,
        label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 'data(tmw)', 'text-valign': 'center', 'text-halign': 'center', 'text-justification': 'center',
        'font-family': DISPLAY, 'font-size': 'data(fs)', 'font-weight': 600, 'line-height': 1.12, color: c.inkStrong,
        'text-opacity': 'data(lop)', 'overlay-opacity': 0, 'min-zoomed-font-size': 0 } },
      // the counts and the kompetansemål in the box (Tema level only)
      { selector: 'node[kind="ctext"]', style: {
        shape: 'rectangle', width: 2, height: 2, 'background-opacity': 0, 'border-width': 0, events: 'no', 'z-index': 61,
        label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 'data(tmw)', 'text-valign': 'center', 'text-halign': 'center', 'text-justification': 'center',
        'font-family': SANS, 'font-size': 'data(fs)', 'font-weight': 600, 'line-height': 1.15, color: c.inkStrong,
        'text-opacity': 'data(lop)', 'overlay-opacity': 0, 'min-zoomed-font-size': 0 } },
      { selector: 'node[kind="ctext"][role="km"]', style: { 'font-family': MONO, 'font-weight': 500, 'line-height': 1.25, color: c.muted } },
      { selector: 'edge[?kart][op]', style: { opacity: 'data(op)', 'curve-style': 'bezier', 'arrow-scale': 0.9 } },
      // ---- the tema view: bigger boxes, the nodes of other temaa grey and small, a frame in the colour of the tema ----
      { selector: 'node[?tv][kind="node"]', style: { 'font-size': 'data(fs)', 'text-max-width': '320px', 'line-height': 1.15, 'border-width': 2, 'corner-radius': 11, 'min-zoomed-font-size': 4 } },
      { selector: 'node[?tv][kind="node"][type="representasjon"]', style: { 'corner-radius': 20 } },
      ...Object.entries(typeCol).map(([t, col]) => ({ selector: `node[?tv][lvl=2][type="${t}"]`, style: {
        'background-color': tFill(col, c.tint * 0.55), 'border-color': tBorder(col, 0.6) } })),
      { selector: 'node[?tv][kind="node"][lvl=2]', style: { 'font-weight': 500, 'border-width': 1.4 } },
      { selector: 'node[?tv][kind="node"][lvl=2][?fk]', style: { 'background-color': c.white } },
      { selector: 'node[kind="tframe"]', style: {
        shape: 'round-rectangle', 'corner-radius': 40, width: 'data(w)', height: 'data(h)', padding: 0, events: 'no',
        'background-color': (e) => areaTint(e.data('cid'), 0), 'background-opacity': strek ? 0 : 1, 'border-width': 1.5, 'border-color': (e) => areaLine(e.data('cid'), 0), 'border-style': 'solid',
        'z-index': 0, 'z-compound-depth': 'bottom', 'overlay-opacity': 0, 'underlay-opacity': 0 } },
      { selector: 'node[kind="tframe"][?fk]', style: { 'border-style': 'dashed' } },
      // a node of another tema: small and grey, the name of its tema under it (a ghost node, role cap)
      { selector: 'node.grey', style: {
        shape: 'round-rectangle', 'corner-radius': 7, 'font-weight': 600, 'line-height': 1.15, 'text-max-width': '200px', 'text-margin-y': 'data(tmy)',
        color: c.muted, 'background-color': mix(c.muted, c.surface, 0.09), 'border-color': mix(c.muted, c.surface, 0.5), 'border-width': 1.2, 'border-style': 'solid', opacity: 0.92 } },
      { selector: 'node.grey[?fk]', style: { 'border-style': 'dashed' } },
      { selector: 'node.ghost[role="cap"]', style: { 'font-family': SANS, 'font-size': 10, 'font-weight': 500, 'line-height': 1.15, color: c.muted, 'text-max-width': '200px', 'min-zoomed-font-size': 3 } },
      { selector: 'edge[?tv]', style: { 'curve-style': 'bezier', 'arrow-scale': 1.05, opacity: 0.9 } },
      { selector: 'edge[?tv][?greyedge]', style: { opacity: 0.55, width: 1.5 } },
      // an arrow with a route from the build or the router runs in horizontal and vertical stretches: the ends are a place on the box
      // (percent of its size), the bends a weight along the line between the middles of the boxes and a distance from it (route.js toSegments)
      { selector: 'edge[?rt]', style: {
        'curve-style': 'round-segments', 'segment-radii': 7, 'edge-distances': 'node-position', 'segment-weights': (e) => e.data('sw'), 'segment-distances': (e) => e.data('sd'),
        'source-endpoint': (e) => e.data('se'), 'target-endpoint': (e) => e.data('te') } },
      { selector: 'node.ghost[?kart][op]', style: { opacity: 'data(op)' } },
      // layers: the plain colours of nodeStyle, then the rules of each layer in priority order. The states below win over them.
      { selector: 'node[lyFill]', style: { 'background-color': 'data(lyFill)' } },
      { selector: 'node[lyRing]', style: { 'border-color': 'data(lyRing)' } },
      ...LAYERS.all().flatMap((l) => (l.styles ? l.styles(c, { mix }) || [] : [])),
      // states
      { selector: '.match', style: { 'underlay-opacity': 0.85 } },
      { selector: '.sel', style: { 'border-width': 4, 'border-color': c.inkStrong, 'underlay-opacity': 0.55, 'z-index': 20 } },
      { selector: 'edge.nbr', style: { opacity: 1, width: 2.6, 'z-index': 15 } },
      { selector: '.dim', style: { opacity: 0.2 } },
      { selector: '.hide', style: { display: 'none' } },
      // faded and filtered elements keep their zoom-dependent opacity
      { selector: 'node[?kart][opd].dim, edge[?kart][opd].dim', style: { opacity: 'data(opd)' } },
      { selector: 'node[?kart][opf].fl', style: { opacity: 'data(opf)' } },
      { selector: '[?tv].fl', style: { opacity: 0.15 } },
      { selector: 'edge[?kart][opn].nbr', style: { opacity: 'data(opn)', width: 2.6 } },
      { selector: '.zoff', style: { display: 'none' } },
    ];
    return st;
  }

  // ---------- The map ----------
  let cy = null;
  const narrow = () => window.matchMedia('(max-width: 1000px)').matches;
  const realNodes = () => cy.nodes('[kind="node"]');
  const ownerOf = (n) => byId.get(n.id());

  // Sizes are measured from the wrapped label, because Cytoscape's `width: label` is deprecated.
  let measureCtx = null;
  function measure(text, font, px, maxW, lineH) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    const lines = [];
    for (const para of String(text).split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/)) {
        const trial = cur ? cur + ' ' + word : word;
        if (cur && measureCtx.measureText(trial).width > maxW) { lines.push(cur); cur = word; } else cur = trial;
      }
      lines.push(cur);
    }
    const w = Math.max(...lines.map((l) => measureCtx.measureText(l).width));
    return { lines, w: Math.ceil(w), h: Math.ceil(lines.length * px * lineH) };
  }
  // Lay out short parts ("4 omgrep", "km03") in lines that break between the parts only, at most `max` lines (a cut list ends in …)
  function packParts(parts, sep, font, px, maxW, lineH, max) {
    measure('x', font, px, maxW, lineH); // sets the font of the shared canvas
    const lines = [];
    let cur = '';
    for (const p of parts) {
      const t = cur ? cur + sep + p : p;
      if (cur && measureCtx.measureText(t).width > maxW) { lines.push(cur); cur = p; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > max) {
      lines.length = max;
      let last = lines[max - 1] + ' …';
      while (last.length > 4 && measureCtx.measureText(last).width > maxW) last = last.slice(0, -3).trimEnd() + ' …';
      lines[max - 1] = last;
    }
    return { lines, h: lines.length * px * lineH };
  }

  // ----- element builders -----
  // A ghost is an extra text node glued to a real node (or a tema box) at an offset; it takes part in dim/hide but never in events.
  function ghost(of, role, label, w, h, dx, dy, extra) {
    return { group: 'nodes', classes: 'ghost', data: { id: `g:${of}:${role}`, kind: 'ghost', of, role, label, w, h, dx, dy, ...extra }, position: { x: 0, y: 0 } };
  }

  // The route of an arrow (layout.routes, from the fra node to the til node) as the data the segments style reads.
  // Empty when the layout has no route for it: the arrow is then drawn as a plain line.
  function routeData(key, k, source, target) {
    const pts = LAYOUT.routes && LAYOUT.routes[key], a = LAYOUT.nodes[source], b = LAYOUT.nodes[target];
    if (!pts || !a || !b) return { rt: false };
    return { rt: true, ...toSegments(source === k.fra ? pts : pts.slice().reverse(), a, b) };
  }
  // Take in the routes of the current layout (the layout changed)
  function applyRoutes() {
    cy.batch(() => cy.edges('[?kart]').forEach((e) => {
      const info = edgeInfo(e), key = e.id();
      e.data(routeData(key, info, e.data('source'), e.data('target')));
    }));
  }

  // ----- the zoom surface -----
  // Positions, sizes and label lines come from the build (layout.mjs). The browser only draws them.
  // fade: 1 at rest; 0..1 while the forkunnskap elements fade in or out (the switch). dim: the temaa that are dimmed far out. hot: the tema under the mouse.
  const KART = { key: '', s1: 0, s2: 0, level: 'tema', fade: 1, dim: new Set(), hot: null };
  // The zoom anchors: t = the whole map in the stage (Tema), k = readable level 1 nodes (Kart), d = readable level 2 nodes (Detalj).
  // k and d follow the size of the text on the screen (level 1 at 14 px and level 2 at 12 px in the layout), not the size of the map:
  // at Normal the level 1 text is about 12.6 px at Kart, and the level 2 nodes come in at about 13 px. A big screen that already
  // shows the whole map large only pushes Kart a little past Tema, so the boxes have room to open.
  const Z = { t: 0.6, k: 0.9, d: 1.08 };
  const textScale = () => (TEXT_SIZES.find(([k]) => k === state.tekst) || TEXT_SIZES[1])[2];
  function anchorsFor(zt) {
    const k = Math.max(Math.max(zt * 1.3, 0.9) * textScale(), zt * 1.15); // Kart always a step past Tema, so the boxes can open
    return { k, d: k * 1.2 };
  }
  // A map that is not an "overview map" (no nivaa) is laid out flat: every node is level 1 and the explicit edges are the ones drawn at Kart
  const FLAT = !(data.oversiktskantar || []).length;
  const OVK = FLAT ? kantar : data.oversiktskantar;
  const inKart = (id) => !!(LAYOUT && LAYOUT.nodes[id] && byId.has(id) && visNode(byId.get(id)));
  const areaIds = () => Object.keys(LAYOUT.areas).filter((cid) => state.showFk || cid !== 'forkunnskap');

  function setAnchors(zt) {
    Z.t = zt; Object.assign(Z, anchorsFor(zt));
    if (cy) { cy.minZoom(zt * 0.7); cy.maxZoom(Math.max(2.5, Z.d * 1.4)); }
  }

  function buildKartElements() {
    const els = [];
    for (const cid of areaIds()) {
      const a = LAYOUT.areas[cid], isF = cid === 'forkunnskap';
      els.push({ group: 'nodes', data: { id: 'a:' + cid, kind: 'carea', cid, label: '', fk: isF, w: a.w, h: a.h, cw: a.w, ch: a.h, cr: 46, abw: 1.5, bgop: 0.5, bop: 1, tt: 0 }, position: { x: a.x, y: a.y } });
      els.push({ group: 'nodes', data: { id: 'l:' + cid, kind: 'clabel', cid, fk: isF, label: klyngeLabel(cid), band: a.band, fs: 22, tmw: a.w - 56, lop: 0.65 }, position: { x: a.x, y: a.y } });
      for (const role of ['meta', 'km']) els.push({ group: 'nodes', data: { id: (role === 'meta' ? 'm:' : 'q:') + cid, kind: 'ctext', role, cid, fk: isF, label: '', fs: 12, tmw: 100, lop: 0 }, position: { x: a.x, y: a.y } });
    }
    for (const [id, p] of Object.entries(LAYOUT.nodes)) {
      const n = byId.get(id);
      if (!n || !visNode(n)) continue;
      els.push({ group: 'nodes', data: {
        id, kind: 'node', kart: true, lvl: p.l, label: p.lines.join('\n'), type: n.type, fk: isFk(n), grp: groupOf(n), km: n.km || [],
        w0: p.w, h0: p.h, w: p.w, h: p.h, cw: p.w, ch: p.h, cr: 9, bw: 1.6, fs: p.l === 1 ? 14 : 12, lop: 1, op: 1, opd: 0.2, opf: 0.12 }, position: { x: p.x, y: p.y } });
    }
    // The arrows of the map (src/kartkantar.js): the overview arrows of level 1, drawn from the prerequisite to what builds on it (in a
    // flat map all the arrows), and all the real arrows between the nodes; the ones an overview arrow already shows only keep that arrow
    // alive when zoomed in. Each gets its route from the build, so it keeps clear of the boxes.
    for (const e of kartEdges(data, inKart)) {
      const k = e.k, { source, target } = arrowEnds(k, e.ov);
      const cross = groupOf(byId.get(k.fra)) !== groupOf(byId.get(k.til));
      const fk = isFk(byId.get(k.fra)) || isFk(byId.get(k.til));
      const eb = k.type === 'forvekslast_med' ? 0.9 : e.ov ? (cross ? 0.26 : 0.85) : (cross ? 0.12 : 0.75);
      els.push({ group: 'edges', data: { id: e.key, source, target, type: k.type, kart: true, ov: e.ov, keep: e.keep, impl: !!k.implisitt, flow: FLOW_TYPES.has(k.type), fkedge: fk,
        eb, op: e.ov ? 1 : 0, opd: e.ov ? 0.2 : 0, opn: 1, ...routeData(e.key, k, source, target) } });
    }
    // the arrows between the tema boxes
    for (const [key, n] of metaPairs()) {
      const [a, b] = key.split('|'); // a builds on b: b is the prerequisite and goes first
      if (!LAYOUT.areas[a] || !LAYOUT.areas[b]) continue;
      const id = `t:${b}>${a}`, fk = a === 'forkunnskap' || b === 'forkunnskap';
      els.push({ group: 'edges', classes: 'zoff', data: { id, source: 'a:' + b, target: 'a:' + a, meta: true, src: b, dst: a, fkedge: fk, count: n, w: 2, type: 'meta', op: 0, rt: false } });
      els.push({ group: 'nodes', classes: 'zoff', data: { id: 'ml:' + id, kind: 'mlab', of: id, fk, label: String(n), w: 20, h: 14, cr: 6, fs: 12, op: 0 }, position: { x: LAYOUT.areas[a].x, y: LAYOUT.areas[a].y } });
    }
    return els;
  }

  // ----- Tema: the compact box of each tema, in model units for the current zoom -----
  // The box is drawn as big on the screen at the Tema zoom whatever the map's size, so everything is divided by Z.t.
  let TM = {};
  function buildTema() {
    const sp = 1 / Z.t, nar = narrow(), out = {};
    for (const cid of areaIds()) {
      const a = LAYOUT.areas[cid], list = clusterNodes.get(cid) || [], isF = cid === 'forkunnskap';
      const cw = Math.min(a.w - 28, (nar ? 128 : 230) * sp), pad = Math.min(11 * sp, cw * 0.07), gap = 5 * sp, room = a.h - 16, tw = cw - pad * 2;
      const name = klyngeLabel(cid), mfs = (nar ? 12 : 13) * sp, kfs = (nar ? 10.5 : 11.5) * sp;
      const kmIds = [...clusterKm.get(cid)].map((id) => byId.get(id)).filter(Boolean).map((k) => k.namn).sort();
      const kmParts = isF ? ['det faget føreset'] : kmIds.length ? kmIds : ['ingen kompetansemål'];
      // what the box holds, from the most to the least; the first that fits the area wins (a small area on a narrow screen holds the name only)
      const ladder = [{ meta: 3, km: true }, { meta: 3, km: false }, { meta: 2, km: false }, { meta: 0, km: false }];
      let res = null;
      for (let step = 0; step < ladder.length && !res; step++) {
        const cfg = ladder[step], last = step === ladder.length - 1;
        // the name as large as fits: three lines at most, no word wider than the box; it may shrink a little before a part is dropped
        for (let nfs = (nar ? 14 : 17) * sp, minNfs = (last ? 11 : (nar ? 14 : 17) * 0.8) * sp; nfs >= minNfs * 0.999; nfs *= 0.94) {
          const nm = measure(name, `600 ${nfs}px ${DISPLAY}`, nfs, tw, 1.12);
          if (nm.lines.length > 3 || nm.w > tw + 1) continue;
          const mt = cfg.meta && countParts(list).length ? packParts(countParts(list), ' · ', `600 ${mfs}px ${SANS}`, mfs, tw, 1.15, cfg.meta) : { lines: [], h: 0 };
          const km = cfg.km ? packParts(kmParts, ' · ', `500 ${kfs}px ${MONO}`, kfs, tw, 1.25, 2) : { lines: [], h: 0 };
          const nameH = nm.lines.length * nfs * 1.12;
          const ch = pad + nameH + (mt.h ? gap + mt.h : 0) + (km.h ? gap + km.h : 0) + pad;
          if (ch > room && !(last && nfs * 0.94 < minNfs)) continue; // too tall: try a smaller name, and at the smallest accept it
          const top = -ch / 2;
          res = {
            cw, ch, tw, nfs, mfs, kfs, nameLines: nm.lines, metaText: mt.lines.join('\n'), kmText: km.lines.join('\n'),
            nameY: top + pad + nameH / 2, metaY: top + pad + nameH + gap + mt.h / 2, kmY: top + pad + nameH + (mt.h ? gap + mt.h : 0) + gap + km.h / 2,
          };
          break;
        }
      }
      if (!res) { // not even the name fits: draw it small anyway
        let nfs = 11 * sp, nm = measure(name, `600 ${nfs}px ${DISPLAY}`, nfs, tw, 1.12);
        while (nm.w > tw + 1 && nfs > 4 * sp) { nfs *= 0.94; nm = measure(name, `600 ${nfs}px ${DISPLAY}`, nfs, tw, 1.12); } // a long word in a narrow box
        const ch = pad * 2 + nm.lines.length * nfs * 1.12;
        res = { cw, ch, tw, nfs, mfs, kfs, nameLines: nm.lines, metaText: '', kmText: '', nameY: 0, metaY: 0, kmY: 0 };
      }
      out[cid] = res;
    }
    return out;
  }
  // The arrows between the tema boxes run around the boxes in between (route.js, the same router the build uses for the map), and the
  // number of each arrow sits on a straight stretch of it where it covers no box and no other number. Sizes are in model units, so they
  // are multiplied by 1/Z.t like the boxes.
  function routeMeta() {
    const sp = 1 / Z.t;
    const boxes = Object.entries(TM).map(([cid, t]) => { const a = LAYOUT.areas[cid]; return { id: cid, x1: a.x - t.cw / 2, x2: a.x + t.cw / 2, y1: a.y - t.ch / 2, y2: a.y + t.ch / 2, x: a.x, y: a.y, w: t.cw, h: t.ch }; });
    const byBox = new Map(boxes.map((b) => [b.id, b]));
    const metas = cy.edges('[?meta]').toArray().filter((e) => byBox.has(e.data('src')) && byBox.has(e.data('dst')));
    const len = (e) => { const a = byBox.get(e.data('src')), b = byBox.get(e.data('dst')); return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); };
    metas.sort((p, q) => len(p) - len(q) || p.id().localeCompare(q.id()));
    const res = routeEdges({ obstacles: boxes, edges: metas.map((e) => ({ id: e.id(), from: e.data('src'), to: e.data('dst') })), step: 7 * sp, pad: 9 * sp, turn: 5, margin: 50 * sp });
    const placed = []; // the numbers so far: [x1, y1, x2, y2]
    // the badge of a box ("nytt for 1P") sits on its top right corner: a number keeps off that too
    const badged = new Set(cy.nodes('.ghost[?area]').map((g) => g.data('of')));
    const badgeZones = boxes.filter((b) => badged.has('a:' + b.id)).map((b) => ({ x1: b.x2 - 150 * sp, x2: b.x2, y1: b.y1 - 24 * sp, y2: b.y1 }));
    const hit = (r, list, m) => list.some((q) => r[0] < q.x2 + m && r[2] > q.x1 - m && r[1] < q.y2 + m && r[3] > q.y1 - m);
    const asBox = (r) => ({ x1: r[0], y1: r[1], x2: r[2], y2: r[3] });
    cy.batch(() => {
      for (const e of metas) {
        const r = res.get(e.id());
        if (!r) continue;
        const S = byBox.get(e.data('src')), T = byBox.get(e.data('dst'));
        e.data({ rt: true, ...toSegments(r.pts, S, T) });
        const lab = cy.getElementById('ml:' + e.id());
        if (lab.empty()) continue;
        const fs = 12 * sp, text = String(e.data('count')), m = measure(text, `700 ${fs}px ${MONO}`, fs, 4000, 1), w = Math.max(m.w + 9 * sp, 16 * sp), h = fs * 1.35;
        const total = pathLength(r.pts);
        // along the arrow from the middle outwards: first a straight stretch away from the bends where nothing is covered, then anywhere
        // that covers nothing; then beside the arrow where it covers nothing (boxes too close, or two arrows side by side); then on the
        // arrow sideways out of the arrow (below), then on the arrow over another number, then beside it over another number; the middle if there is no such place
        const fr = Array.from({ length: 33 }, (_, i) => 0.04 + i * 0.03).sort((p, q) => Math.abs(p - 0.5) - Math.abs(q - 0.5));
        const rectAt = (p, dx, dy) => [p.x + dx - w / 2, p.y + dy - h / 2, p.x + dx + w / 2, p.y + dy + h / 2];
        const onBox = (rect, tight) => hit(rect, boxes, tight ? 0 : 2 * sp) || (!tight && hit(rect, badgeZones, 0));
        let at = null;
        const tryPasses = (passes) => { for (const pass of passes) {
          for (const f of fr) {
            const p = pointAlong(r.pts, total * f);
            if (!p) continue;
            if (pass === 0 && (p.at < w / 2 + 6 * sp || p.run - p.at < w / 2 + 6 * sp)) continue; // keep off the bends
            const beside = pass >= 3 ? [[(w / 2 + 3 * sp) * (p.vertical ? 1 : 0), (h / 2 + 2 * sp) * (p.vertical ? 0 : 1)], [-(w / 2 + 3 * sp) * (p.vertical ? 1 : 0), -(h / 2 + 2 * sp) * (p.vertical ? 0 : 1)]] : [[0, 0]];
            for (const [dx, dy] of beside) {
              const rect = rectAt(p, dx, dy);
              if (onBox(rect, pass >= 2) || ((pass < 2 || pass === 3) && hit(rect, placed.map(asBox), 4 * sp))) continue;
              at = { p: { x: p.x + dx, y: p.y + dy }, rect }; break;
            }
            if (at) break;
          }
          if (at) break;
        } };
        tryPasses([0, 1, 3]);
        // still nothing (two boxes right above each other with two arrows in the gap between them): slide the number sideways from the
        // arrow, further and further out, to the first spot that covers no box and no other number; only then over another number
        if (!at) {
          const far = 240 * sp;
          for (const f of fr) {
            const p = pointAlong(r.pts, total * f);
            if (!p) continue;
            const near = p.vertical ? w / 2 + 3 * sp : h / 2 + 2 * sp;
            for (let d = near; d <= far && !at; d += 4 * sp) {
              for (const sign of [1, -1]) {
                const rect = rectAt(p, p.vertical ? sign * d : 0, p.vertical ? 0 : sign * d);
                if (onBox(rect, true) || hit(rect, badgeZones, 0) || hit(rect, placed.map(asBox), 4 * sp)) continue;
                at = { p: { x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 }, rect }; break;
              }
            }
            if (at) break;
          }
        }
        if (!at) tryPasses([2, 4]);
        if (!at) { const p = pointAlong(r.pts, total / 2); at = { p, rect: rectAt(p, 0, 0) }; }
        placed.push(at.rect);
        lab.data({ w, h, fs, cr: 5 * sp });
        lab.position({ x: at.p.x, y: at.p.y });
      }
    });
  }
  function layoutTema() {
    TM = buildTema();
    cy.batch(() => {
      for (const [cid, t] of Object.entries(TM)) {
        const set = (id, d) => { const el = cy.getElementById(id); if (el.nonempty()) el.data(d); };
        set('l:' + cid, { label: t.nameLines.join('\n'), nfs: t.nfs, tw: t.tw });
        set('m:' + cid, { label: t.metaText, fs: t.mfs, tmw: t.tw + 8 });
        set('q:' + cid, { label: t.kmText, fs: t.kfs, tmw: t.tw + 8 });
      }
    });
    // the arrows and their numbers are as big on the screen at every map size
    const sp = 1 / Z.t;
    cy.batch(() => cy.edges('[?meta]').forEach((e) => e.data({ w: Math.round((1.4 + Math.sqrt(e.data('count')) * 0.95) * sp * 10) / 10 })));
    cy.batch(() => cy.nodes('.ghost[?area]').forEach((g) => { // the badges of the boxes follow the zoom of the Tema level too
      const fs = g.data('fs0') * sp, m = measure(g.data('label'), `700 ${fs}px ${SANS}`, fs, 4000, 1);
      g.data({ fs, w: m.w + 14 * sp, h: Math.round(fs * 1.6) });
    }));
    routeMeta();
  }
  const areaNode = (cid) => cy.getElementById('a:' + cid);

  // Sizes, opacities and positions from the zoom: boxes far out, areas with nodes in the middle, satellites close up.
  // forced = { s1, s2 } draws a level whatever the zoom is (the poster).
  function renderLevels(zIn, force, forced) {
    if (!cy || state.tema) return; // the tema view has no levels: its boxes are drawn as the layout has them
    const z = zIn || cy.zoom();
    const z1 = smooth(z, Z.t * 1.05, Z.k * 0.95); // 0 = Tema, 1 = the tema boxes have opened
    const z2 = smooth(z, Z.k * 1.03, Z.d * 0.97); // 1 = the level 2 nodes are in
    // what is drawn: the levels of the zoom, a fixed level (the poster), or everything ("Vis alle omgrep og metodar")
    const all = !forced && state.alt;
    const s1 = forced ? forced.s1 : all ? 1 : z1, s2 = forced ? forced.s2 : all ? 1 : z2;
    const level = forced ? (s1 < 0.5 ? 'tema' : s2 > 0.5 ? 'detalj' : 'kart') : z1 < 0.5 ? 'tema' : z2 > 0.5 ? 'detalj' : 'kart';
    const key = [s1.toFixed(3), s2.toFixed(3), all ? level : '', Z.t.toFixed(3), KART.fade.toFixed(3), [...KART.dim].join(','), KART.hot || ''].join('|');
    if (key === KART.key && !force) return;
    KART.key = key; KART.s1 = s1; KART.s2 = s2;
    const tt = 1 - smooth(s1, 0, 0.5), open = smooth(s1, 0.1, 0.85), nodeIn = smooth(s1, 0.3, 0.9);
    const fkf = (el) => (el.data(el.isEdge() ? 'fkedge' : 'fk') ? KART.fade : 1); // the forkunnskap elements fade with the switch
    cy.batch(() => {
      cy.nodes('[kind="carea"]').forEach((ar) => {
        const cid = ar.data('cid'), t = TM[cid], f = fkf(ar), w = ar.data('w'), h = ar.data('h'), ax = ar.position('x'), ay = ar.position('y');
        const dimF = lerp(1, KART.dim.has(cid) ? 0.3 : 1, tt);
        ar.data({
          cw: t ? lerp(t.cw, w, open) : w, ch: t ? lerp(t.ch, h, open) : h, cr: lerp(16, 46, open), tt,
          bgop: f * dimF, bop: f * dimF,
          abw: lerp(2.6, 1.5, open) + (KART.hot === cid ? 1.6 * tt : 0), top: tt * f * dimF,
        });
        if (!t) return;
        const l = cy.getElementById('l:' + cid), band = l.data('band');
        l.data({ fs: lerp(t.nfs, 22, open), tmw: lerp(t.tw + 8, w - 56, open), lop: Math.min(1, lerp(1, 0.65, open) * lerp(1, 0.75, s2) * f * dimF * (KART.hot === cid && tt < 0.5 ? 1.5 : 1)) });
        l.position({ x: ax, y: lerp(ay + t.nameY, ay - h / 2 + band / 2 + 2, open) });
        for (const [role, id] of [['meta', 'm:'], ['km', 'q:']]) {
          const q = cy.getElementById(id + cid), lop = (1 - smooth(s1, 0, 0.3)) * f * dimF;
          q.data('lop', lop);
          q.position({ x: ax, y: ay + t[role + 'Y'] });
          q.toggleClass('zoff', lop < 0.02);
        }
      });
      cy.nodes('.ghost[?area]').forEach((g) => { // the badges of the tema boxes follow the top right corner of their box
        const p = cy.getElementById(g.data('of'));
        if (p.empty()) return;
        g.data({ dx: p.data('cw') / 2 - g.data('w') / 2 - 6, dy: -p.data('ch') / 2 - 1 });
        g.position({ x: p.position('x') + g.data('dx'), y: p.position('y') + g.data('dy') });
      });
      cy.nodes('[kind="node"][?kart]').forEach((n) => {
        const w0 = n.data('w0'), h0 = n.data('h0'), f = fkf(n);
        if (n.data('lvl') === 1) {
          const sc = lerp(0.35, 1, nodeIn);
          n.data({ cw: w0 * sc, ch: h0 * sc, cr: 9, bw: lerp(2.4, 1.6, nodeIn), lop: smooth(s1, 0.55, 0.95) * f, op: nodeIn * f, opd: 0.2 * nodeIn * f, opf: 0.12 * nodeIn * f });
          n.toggleClass('zoff', nodeIn * f < 0.02);
        } else {
          const sc = lerp(0.55, 1, s2);
          n.data({ cw: w0 * sc, ch: h0 * sc, cr: 8, bw: 1.1, lop: smooth(s2, 0.5, 1) * f, op: s2 * f, opd: s2 * 0.2 * f, opf: s2 * 0.12 * f });
          n.toggleClass('zoff', s2 * f < 0.02);
        }
      });
      // while the map glides, the ends of an edge can lie on top of each other: Cytoscape cannot draw that, so the edge waits
      const clash = (e) => {
        if (!tween) return false;
        const a = e.source(), b = e.target();
        const m = 16; // an arrow needs a little room between its ends as well
        return Math.abs(a.position('x') - b.position('x')) < (a.data('cw') + b.data('cw')) / 2 + m && Math.abs(a.position('y') - b.position('y')) < (a.data('ch') + b.data('ch')) / 2 + m;
      };
      cy.edges().forEach((e) => {
        if (e.data('meta')) {
          const dimF = KART.dim.has(e.data('src')) || KART.dim.has(e.data('dst')) ? 0.25 : 1;
          const op = (1 - smooth(s1, 0, 0.2)) * 0.9 * fkf(e) * dimF; // gone before the boxes start to grow into each other
          e.data('op', op);
          const off = op < 0.02 || clash(e);
          e.toggleClass('zoff', off);
          const lab = cy.getElementById('ml:' + e.id());
          if (lab.nonempty()) { lab.data('op', op); lab.toggleClass('zoff', off); }
        } else if (e.data('kart')) {
          const eb = e.data('eb');
          // close up with no node chosen the arrows are calmer, so the names can be read
          const calm = state.sel ? 1 : lerp(1, 0.5, s2);
          const op = (e.data('ov') ? eb * nodeIn * (e.data('keep') ? 1 : 1 - s2) : eb * s2) * fkf(e) * calm;
          // close up with a node chosen, the arrows that are not the node's or its neighbours' fade out altogether
          e.data({ op, opd: op * 0.25 * (state.sel ? 1 - smooth(s2, 0.25, 0.75) : 1), opn: Math.min(1, op * 1.6 + (op > 0.02 ? 0.3 : 0)) });
          e.toggleClass('zoff', op < 0.02 || clash(e));
        }
      });
      syncKartGhosts();
    });
    state.level = level;
    if (level !== KART.level) { KART.level = level; renderHint(); renderLevelButtons(); }
    scheduleViewport();
  }
  // the badges follow their node: gone while the node is, faded with its opacity otherwise
  function syncKartGhosts() {
    if (state.tema) return; // the badges of the tema view stay as addBadge made them
    cy.nodes('.ghost[?kart]').forEach((g) => {
      const p = cy.getElementById(g.data('of'));
      if (p.empty()) return;
      const area = !!g.data('area');
      const op = area ? p.data('top') : p.data('op') * smooth(KART.s1, 0.7, 1);
      g.data({ op, opd: op * 0.2, opf: op * 0.12 });
      g.toggleClass('zoff', op < 0.02 || p.hasClass('zoff'));
    });
  }
  let levelFrame = 0;
  const scheduleLevels = () => { if (!levelFrame) levelFrame = requestAnimationFrame(() => { levelFrame = 0; renderLevels(); }); };
  // HTML that follows the nodes (ctx.stageLayer): the layers place it in the hook viewport, which runs once per frame after a pan, a zoom,
  // a change of the levels or an update
  let viewportFrame = 0;
  const syncViewport = () => {
    viewportFrame = 0;
    if (!started) return;
    const layer = $('stageLayer'), c = $('cy'); // the layer sits beside #cy (the tema bar above it comes and goes): keep it over the map
    if (layer && c && layer.style.top !== `${c.offsetTop}px`) layer.style.top = `${c.offsetTop}px`;
    LAYERS.call(mode(), 'viewport', api);
  };
  const scheduleViewport = () => { if (!viewportFrame) viewportFrame = requestAnimationFrame(syncViewport); };
  // A real node as it is on the screen now (for the hook viewport): the box in pixels of the stage, its opacity, and whether it is dimmed.
  // null when the node is not drawn (hidden, out at this zoom, a grey neighbour in the tema view, not on the map).
  function nodeBox(id) {
    if (!cy) return null;
    const n = cy.getElementById(id);
    if (n.empty() || n.data('kind') !== 'node' || n.data('grey') || n.hasClass('hide') || n.hasClass('zoff') || !n.visible()) return null;
    const op = n.effectiveOpacity();
    if (op < 0.02) return null;
    const b = n.renderedBoundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });
    return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2, w: b.w, h: b.h, op, dim: n.hasClass('dim'), sel: n.hasClass('sel') };
  }

  // The zoom and the pan that show a whole layout at Tema: the map fits the stage, but never below a readable zoom
  // (a narrow screen starts at the top left and the map reaches past the edge).
  function kartView(layout) {
    const b = layout.bounds, pad = narrow() ? 12 : 24, W = cy.width(), H = cy.height();
    const zFit = Math.min((W - pad * 2) / (b.x2 - b.x1), (H - pad * 2) / (b.y2 - b.y1));
    const zMin = narrow() ? 0.2 : 0.38;
    const z = clamp(Math.max(zFit, zMin), 0.1, 1.2);
    const cx = W / 2 - ((b.x1 + b.x2) / 2) * z, cyy = H / 2 - ((b.y1 + b.y2) / 2) * z;
    const pan = zFit >= zMin ? { x: cx, y: cyy } : { x: pad - b.x1 * z, y: (b.y2 - b.y1) * z <= H - pad * 2 ? cyy : pad - b.y1 * z };
    return { zt: z, zoom: z, pan };
  }
  // Take in a new stage size or layout: new anchors, new box sizes
  function refreshAnchors() {
    cy.resize();
    const v = kartView(LAYOUT);
    setAnchors(v.zt);
    layoutTema();
    KART.key = '';
    return v;
  }
  function fitKart() {
    if (state.tema) { fitTemaView(); return; }
    const v = refreshAnchors();
    cy.viewport({ zoom: v.zoom, pan: v.pan });
    renderLevels(0, true);
  }

  // ----- the tema view: one tema at a time -----
  // The nodes of a tema (level 1 and 2 together) big in a frame in the colour of the tema, the nodes of other temaa it is tied to by a
  // byggjer_paa arrow small and grey outside it with the name of their tema under them, and only the arrows between these. Positions and
  // routes are fixed, from the build (temalayout.mjs); the view replaces the elements of the zoom surface (rebuild) while state.tema is set.
  // The way in is a zoom on the tema and a short fade of the stage; the way out is the same backwards (not with prefers-reduced-motion).
  const TV = { z: 0, token: 0, fading: false }; // z: the zoom that fits the view; token: a newer opening or leaving cancels an older one; fading: a tema is about to open from the surface
  const temaLayout = (cid) => (LAYOUT && LAYOUT.tema && LAYOUT.tema[cid]) || null;
  const canTema = (cid) => !!(cy && hasTema && temaLayout(cid));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function fadeStage(to, ms, token) {
    const el = $('cy');
    el.style.transition = `opacity ${ms}ms ease`;
    el.style.opacity = String(to);
    return sleep(ms).then(() => { if (to === 1 && token === TV.token) { el.style.opacity = ''; el.style.transition = ''; } });
  }
  const resetStage = () => { $('cy').style.opacity = ''; $('cy').style.transition = ''; };

  // The route of an arrow of the tema view, as the data the segments style reads (see routeData for the zoom surface)
  function temaRouteData(TL, key, k, source, target) {
    const pts = TL.routes[key], a = TL.nodes[source], b = TL.nodes[target];
    if (!pts || !a || !b) return { rt: false };
    return { rt: true, ...toSegments(source === k.fra ? pts : pts.slice().reverse(), a, b) };
  }
  function buildTemaElements(cid) {
    const TL = temaLayout(cid), els = [], f = TL.frame, isF = cid === 'forkunnskap', has = new Set();
    els.push({ group: 'nodes', data: { id: 'f:' + cid, kind: 'tframe', cid, fk: isF, label: '', w: f.w, h: f.h }, position: { x: f.x, y: f.y } });
    els.push({ group: 'nodes', data: { id: 'l:' + cid, kind: 'clabel', cid, fk: isF, label: klyngeLabel(cid), fs: 22, tmw: f.w - 56, lop: 0.65 }, position: { x: f.x, y: f.y - f.h / 2 + f.band / 2 } });
    for (const [id, p] of Object.entries(TL.nodes)) {
      const n = byId.get(id);
      if (!n || !visNode(n)) continue;
      const grey = p.role !== 'own';
      has.add(id);
      els.push({ group: 'nodes', classes: grey ? 'grey' : '', data: {
        id, kind: 'node', tv: true, grey, lvl: p.l, label: p.lines.join('\n'), type: n.type, fk: isFk(n), grp: groupOf(n), km: n.km || [],
        w0: p.w, h0: p.h, w: p.w, h: p.h, fs: grey ? 12 : p.l === 1 ? 16 : 14, tmy: grey ? -(p.capH + 3) / 2 : 0 }, position: { x: p.x, y: p.y } });
      if (grey) els.push(ghost(id, 'cap', p.cap.join('\n'), p.w, p.capH, 0, (p.nameH + 3) / 2, { tv: true }));
    }
    // the arrows (src/kartkantar.js, the same list the build routed): between the nodes of the tema, and byggjer_paa to and from the grey ones
    for (const e of temaMembers(data, cid, { withoutForkunnskap: !state.showFk }).edges) {
      const k = e.k, { source, target } = arrowEnds(k, false);
      if (!has.has(source) || !has.has(target)) continue;
      els.push({ group: 'edges', data: { id: e.key, source, target, type: k.type, tv: true, impl: !!k.implisitt, flow: FLOW_TYPES.has(k.type), fkedge: false, greyedge: e.grey,
        ...temaRouteData(TL, e.key, k, source, target) } });
    }
    return els;
  }

  // The zoom and the pan that show the whole view; never below a readable zoom (then the view starts at its top left and reaches past the edge)
  function temaView() {
    // room at the bottom for the zoom buttons and the "?"
    const b = temaLayout(state.tema).bounds, pad = narrow() ? 12 : 28, top = pad, bottom = pad + (narrow() ? 38 : 30), W = cy.width(), H = cy.height();
    const zFit = Math.min((W - pad * 2) / (b.x2 - b.x1), (H - top - bottom) / (b.y2 - b.y1));
    const zMin = (narrow() ? 0.5 : 0.55) * textScale(), z = clamp(Math.max(zFit, zMin), 0.1, 1.25 * textScale());
    const mid = { x: W / 2 - ((b.x1 + b.x2) / 2) * z, y: (top + H - bottom) / 2 - ((b.y1 + b.y2) / 2) * z };
    return { zoom: z, pan: {
      x: (b.x2 - b.x1) * z <= W - pad * 2 ? mid.x : pad - b.x1 * z,
      y: (b.y2 - b.y1) * z <= H - top - bottom ? mid.y : top - b.y1 * z } };
  }
  function fitTemaView() {
    cy.resize();
    const v = temaView();
    TV.z = v.zoom;
    cy.minZoom(v.zoom * 0.5); cy.maxZoom(2.5);
    cy.viewport({ zoom: v.zoom, pan: v.pan });
  }
  // A chosen node that lies outside the stage (a long view on a small screen) is brought in
  function revealNode(id) {
    requestAnimationFrame(() => {
      cy.resize();
      const n = cy.getElementById(id);
      if (n.empty()) return;
      const p = n.renderedPosition(), m = 50;
      if (p.x < m || p.y < m || p.x > cy.width() - m || p.y > cy.height() - m) cy.animate({ center: { eles: n } }, { duration: reduceMotion() ? 0 : 220 });
    });
  }

  // The name of the tema, what is in it and its competence goals, and the way back
  function renderTemaBar() {
    const on = !!state.tema, bar = $('temaBar');
    bar.hidden = !on;
    $('stage').classList.toggle('intema', on);
    if (!on) return;
    const cid = state.tema;
    bar.style.setProperty('--tc', temaColor(cid));
    $('temaName').textContent = klyngeLabel(cid);
    $('temaCount').textContent = countText(clusterNodes.get(cid).filter(visNode));
    const goals = [...clusterKm.get(cid)].map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.namn.localeCompare(b.namn));
    $('temaGoals').replaceChildren(...goals.map((k) => h('button', { class: 'kmchip', type: 'button', 'aria-pressed': String(state.km === k.id), title: `${k.namn}: ${lab(k.tekst)}`,
      onclick: () => selectKm(k.id, true) }, k.namn)));
  }

  // Swap the surface for the view of a tema (no animation): the choice that does not belong to the tema is let go
  function enterTemaNow(cid, opts) {
    cy.stop();
    finishTween();
    if (state.km && !clusterKm.get(cid).has(state.km)) state.km = null;
    const want = opts.sel && byId.get(opts.sel), keep = state.sel && groupOf(byId.get(state.sel)) === cid ? state.sel : null;
    state.sel = want && visNode(want) && !isKm(want) && groupOf(want) === cid ? want.id : keep;
    if (want && state.sel === want.id) { LAYERS.call(mode(), 'onSelect', want, api); state.km = null; }
    state.tema = cid; state.level = 'detalj'; KART.hot = null;
    $('cy').style.cursor = '';
    renderTemaBar();
    cy.resize();
    rebuild();
    update();
    fitTemaView();
    if (state.sel) revealNode(state.sel);
  }
  // ... and back: the surface is built again and stands on the tema we came from, at the Kart zoom
  function exitTemaNow(cid) {
    cy.stop();
    state.tema = null;
    renderTemaBar();
    cy.resize();
    setAnchors(kartView(LAYOUT).zt);
    rebuild();
    const a = LAYOUT.areas[cid] || LAYOUT.areas[Object.keys(LAYOUT.areas)[0]];
    cy.viewport({ zoom: Z.k, pan: { x: cy.width() / 2 - a.x * Z.k, y: cy.height() / 2 - a.y * Z.k } });
    KART.key = '';
    renderLevels(0, true);
    update();
  }

  // Open a tema: from the surface by zooming in on it, from another tema sideways. opts.sel: a node of the tema to choose.
  async function openTema(cid, opts) {
    opts = opts || {};
    if (!cy) return;
    if (!canTema(cid)) { if (state.tema) leaveTema({ then: opts.sel ? () => select(opts.sel, { center: true }) : null }); else focusArea(cid); return; }
    if (state.tema === cid) { if (opts.sel) select(opts.sel, { center: true }); return; }
    const my = ++TV.token, anim = !reduceMotion();
    finishTween();
    if (anim) {
      TV.fading = !state.tema; // on the surface until the swap
      if (!state.tema) { const a = LAYOUT.areas[cid]; cy.resize(); glide(Z.k, { x: a.x, y: a.y }, 230); await sleep(120); }
      if (my !== TV.token) return;
      await fadeStage(0, 110, my);
      if (my !== TV.token) return;
    } else resetStage();
    TV.fading = false;
    enterTemaNow(cid, opts);
    if (anim) await fadeStage(1, 150, my);
  }
  // Leave the tema view for the surface: opts.level (tema, the default, kart or detalj) is where the view lands, opts.then replaces that
  async function leaveTema(opts) {
    opts = opts || {};
    if (!state.tema) { if (opts.then) opts.then(); return; }
    const my = ++TV.token, cid = state.tema, anim = !reduceMotion();
    if (anim) { await fadeStage(0, 110, my); if (my !== TV.token) return; } else resetStage();
    exitTemaNow(cid);
    if (anim) { await fadeStage(1, 130, my); if (my !== TV.token) return; }
    if (opts.then) { opts.then(); return; }
    const level = opts.level || 'tema';
    if (level !== 'tema') goLevel(level); else if (anim) goTema(); else fitKart();
  }

  // ----- the switch "Vis forkunnskapar": glide from one fixed layout to the other, then fit -----
  const TWEEN_MS = 400;
  let tween = null;
  const finishTween = () => { if (tween) tween.end(); };
  const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  const fkParts = () => { // everything that belongs to the forkunnskap tema; its edges go with the nodes
    const gone = cy.nodes('[?fk]');
    const badges = cy.nodes('.ghost').filter((g) => { const p = cy.getElementById(g.data('of')); return p.nonempty() && gone.contains(p); });
    return gone.union(badges);
  };

  function transitionKart(on) {
    const to = on ? LAYOUT_FULL : LAYOUT_NOFK, was = LAYOUT.areas;
    LAYOUT = to; // everything that looks positions up (search, goals, the tema buttons) follows the target at once
    cy.resize();
    if (on) { // the forkunnskap elements come back at their places in the full layout, invisible until the glide has begun
      KART.fade = 0;
      cy.add(buildKartElements().filter((el) => cy.getElementById(el.data.id).empty()));
    }
    applyRoutes(); // the arrows take the routes of the target layout
    // the view keeps its level: the zoom scales with the anchors, and the middle of the stage stays on the same spot of the same tema
    const vt = kartView(to), z0 = cy.zoom(), v0 = { zoom: z0, pan: { ...cy.pan() }, zt: Z.t };
    const here = stageCentre(), from = nearestArea(here, was);
    const v1 = { zt: vt.zt, zoom: z0 * (vt.zt / Z.t) };
    const home = from && to.areas[from.cid] ? { a: to.areas[from.cid] } : nearestArea(here, to.areas);
    const centre1 = from && home ? { x: home.a.x + (here.x - from.a.x), y: home.a.y + (here.y - from.a.y) } : here;
    v1.pan = { x: cy.width() / 2 - centre1.x * v1.zoom, y: cy.height() / 2 - centre1.y * v1.zoom };
    const nodes0 = [], areas0 = [];
    for (const [id, p] of Object.entries(to.nodes)) {
      const n = cy.getElementById(id);
      if (n.nonempty()) nodes0.push({ n, from: { ...n.position() }, to: p });
    }
    for (const [cid, a] of Object.entries(to.areas)) {
      const area = areaNode(cid);
      if (area.empty()) continue;
      areas0.push({ area, a, from: { x: area.position('x'), y: area.position('y'), w: area.data('w'), h: area.data('h') } });
    }
    const f0 = on ? 0 : 1, f1 = on ? 1 : 0;
    const apply = (e) => {
      cy.batch(() => {
        for (const m of nodes0) m.n.position({ x: lerp(m.from.x, m.to.x, e), y: lerp(m.from.y, m.to.y, e) });
        for (const m of areas0) {
          m.area.position({ x: lerp(m.from.x, m.a.x, e), y: lerp(m.from.y, m.a.y, e) });
          m.area.data({ w: lerp(m.from.w, m.a.w, e), h: lerp(m.from.h, m.a.h, e) });
        }
        KART.fade = lerp(f0, f1, e);
        Z.t = lerp(v0.zt, v1.zt, e); Object.assign(Z, anchorsFor(Z.t));
        cy.viewport({ zoom: lerp(v0.zoom, v1.zoom, e), pan: { x: lerp(v0.pan.x, v1.pan.x, e), y: lerp(v0.pan.y, v1.pan.y, e) } });
        placeGhosts();
        renderLevels(0, true);
      });
    };
    const end = () => {
      if (tween && tween.raf) cancelAnimationFrame(tween.raf);
      tween = null;
      apply(1);
      if (!on) cy.remove(fkParts()); // the edges of the nodes go with them
      KART.fade = 1;
      setAnchors(v1.zt);
      layoutTema();
      cy.viewport({ zoom: v1.zoom, pan: v1.pan });
      KART.key = '';
      renderLevels(0, true);
      placeGhosts();
    };
    finishTween();
    tween = { end, raf: 0 };
    layoutTema(); // the box sizes of the target, so the tema elements that come back have something to draw
    apply(0);
    if (reduceMotion()) { end(); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (!tween || tween.end !== end) return;
      const t = Math.min(1, (now - t0) / TWEEN_MS);
      if (t >= 1) { end(); return; }
      apply(t * t * (3 - 2 * t));
      tween.raf = requestAnimationFrame(step);
    };
    tween.raf = requestAnimationFrame(step);
  }

  // ----- flying around: the level buttons, a tema box, a node, a competence goal -----
  // Bounding box in model coordinates (the nodes may be hidden at this zoom, so the positions come from the build)
  function kartBox(ids) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const id of ids) {
      const p = LAYOUT.nodes[id];
      if (!p) continue;
      x1 = Math.min(x1, p.x - p.w / 2); x2 = Math.max(x2, p.x + p.w / 2); y1 = Math.min(y1, p.y - p.h / 2); y2 = Math.max(y2, p.y + p.h / 2);
    }
    return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null;
  }
  const fitZoom = (b) => {
    const pad = narrow() ? 30 : 70;
    return Math.min((cy.width() - pad * 2) / (b.x2 - b.x1), (cy.height() - pad * 2) / (b.y2 - b.y1));
  };
  const glide = (zoom, centre, ms) => {
    cy.stop();
    cy.animate({ zoom, pan: { x: cy.width() / 2 - centre.x * zoom, y: cy.height() / 2 - centre.y * zoom } }, { duration: ms || 350, easing: 'ease-in-out-sine' });
  };
  function flyTo(b, minZ, maxZ) {
    requestAnimationFrame(() => {
      cy.resize();
      glide(clamp(fitZoom(b), minZ, maxZ), { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }, 320);
    });
  }
  function goTema() {
    const v = refreshAnchors();
    cy.stop();
    cy.animate({ zoom: v.zoom, pan: v.pan }, { duration: 350, easing: 'ease-in-out-sine' });
  }
  // The model point in the middle of the stage, and the tema nearest to it
  const stageCentre = () => ({ x: (cy.width() / 2 - cy.pan().x) / cy.zoom(), y: (cy.height() / 2 - cy.pan().y) / cy.zoom() });
  function nearestArea(p, areas) {
    let best = null;
    for (const [cid, a] of Object.entries(areas || LAYOUT.areas)) {
      const d = Math.hypot(Math.max(0, Math.abs(p.x - a.x) - a.w / 2), Math.max(0, Math.abs(p.y - a.y) - a.h / 2));
      if (!best || d < best.d) best = { cid, d, a };
    }
    return best;
  }
  // The buttons Tema · Kart · Detalj: Tema shows the whole map; the other two zoom in on the chosen node,
  // or on the tema nearest to the middle of the stage when you come from Tema, or else where you are.
  function goLevel(level) {
    if (!cy) return;
    if (state.tema) { leaveTema({ level }); return; } // the buttons are the way back from a tema to the surface
    if (TV.fading) { TV.token++; TV.fading = false; resetStage(); } // a tema that is about to open is let go: you asked for a level of the surface
    finishTween();
    if (level === 'tema') { goTema(); return; }
    cy.resize();
    const z = level === 'kart' ? Z.k : Z.d, sel = state.sel && LAYOUT.nodes[state.sel];
    let c = sel ? { x: sel.x, y: sel.y } : stageCentre();
    if (!sel && KART.level === 'tema') { const a = nearestArea(c); if (a) c = { x: a.a.x, y: a.a.y }; }
    glide(z, c, 380);
  }
  function focusKartNode(id) {
    if (state.tema) { revealNode(id); return; }
    const p = LAYOUT.nodes[id];
    if (!p) return;
    // a satellite needs the Detalj zoom to show; a core node needs at least Kart
    const z = Math.max(cy.zoom(), p.l === 2 ? Z.d * 0.95 : Z.k * 0.95);
    requestAnimationFrame(() => { cy.resize(); glide(z, p, 320); });
  }
  // The tema opens: Kart zoom on its area
  function focusArea(cid) {
    const a = LAYOUT.areas[cid];
    if (!a) return;
    flyTo({ x1: a.x - a.w / 2, x2: a.x + a.w / 2, y1: a.y - a.h / 2, y2: a.y + a.h / 2 }, Z.k, Z.k);
  }
  // The tema box under a model point while the boxes are shown (Tema level only)
  function areaAt(pos) {
    if (state.tema || KART.level !== 'tema') return null;
    for (const cid of areaIds()) {
      const ar = areaNode(cid);
      if (ar.empty() || ar.hasClass('zoff')) continue;
      if (Math.abs(pos.x - ar.position('x')) <= ar.data('cw') / 2 && Math.abs(pos.y - ar.position('y')) <= ar.data('ch') / 2) return cid;
    }
    return null;
  }

  // The name of a tema on the surface once its box has opened (the band at the top of the area): a click there opens the tema view
  function bandAt(pos) {
    if (state.tema || KART.level === 'tema') return null;
    for (const cid of areaIds()) {
      const a = LAYOUT.areas[cid];
      if (canTema(cid) && Math.abs(pos.x - a.x) <= a.w / 2 && pos.y >= a.y - a.h / 2 && pos.y <= a.y - a.h / 2 + a.band) return cid;
    }
    return null;
  }

  function placeGhosts() {
    cy.nodes('.ghost').forEach((g) => {
      const p = cy.getElementById(g.data('of'));
      if (p.empty()) return;
      g.position({ x: p.position('x') + g.data('dx'), y: p.position('y') + g.data('dy') });
    });
  }
  // The classes a ghost (badge) takes over from its node: the core's states and the ghostClasses of the layers
  let ghostSharedList = null;
  const ghostShared = () => ghostSharedList || (ghostSharedList = [...new Set(['hide', 'dim', 'fl', ...LAYERS.all().flatMap((l) => l.ghostClasses || [])])]);
  function syncGhosts() {
    cy.nodes('.ghost').forEach((g) => {
      const p = cy.getElementById(g.data('of'));
      if (p.empty()) return;
      for (const cls of ghostShared()) g.toggleClass(cls, p.hasClass(cls));
    });
    syncKartGhosts();
  }

  // (Re)build the map
  function rebuild() {
    finishTween();
    badgeKey = '';
    cy.elements().remove();
    if (state.tema) { // the tema view: its own elements and fixed positions, nothing of the zoom surface
      cy.add(buildTemaElements(state.tema));
      cy.autoungrabify(true);
      TM = {};
      placeGhosts();
      return;
    }
    cy.add(buildKartElements());
    cy.autoungrabify(true);
    KART.key = '';
    layoutTema();
    placeGhosts();
    renderLevels(0, true);
  }

  // ---------- Layers: visibility and marks ----------
  // Every update asks the active layers once per real node (nodeStyle) and per edge (edgeStyle); layers.js merges the answers.
  function layerSpecs() {
    const m = mode();
    LAYERS.call(m, 'prepare', api);
    const specs = new Map();
    realNodes().forEach((n) => specs.set(n.id(), LAYERS.nodeStyle(m, ownerOf(n), api, { grey: !!n.data('grey'), kart: true, lvl: n.data('lvl') })));
    return specs;
  }
  // An edge as the layers see it: the kant of the map (ids e<i> and o<i> for the edges of level 1), with implisitt as drawn
  function edgeInfo(e) {
    const id = e.id(), k = (id[0] === 'o' ? OVK : kantar)[+id.slice(1)] || {};
    return { type: e.data('type'), fra: k.fra, til: k.til, implisitt: !!e.data('impl') };
  }
  // dekkjer is never drawn: a chosen kompetansemål marks its nodes instead
  function edgeOff(e) {
    return e.data('type') === 'dekkjer' || !!LAYERS.edgeStyle(mode(), edgeInfo(e), api).hide;
  }

  // hide removes a node from the map; fade only dims it (the positions are fixed)
  function applyVisibility(specs) {
    specs = specs || layerSpecs();
    realNodes().forEach((n) => {
      const s = specs.get(n.id());
      n.toggleClass('hide', !!s.hide);
      n.toggleClass('fl', !!s.fade);
      n.toggleClass('keep', !!s.keep); // a layer keeps the node open for the dimming of a selection (a step on a path)
    });
    cy.edges('[!meta]').forEach((e) => e.toggleClass('hide', edgeOff(e)));
    cy.edges('[?meta]').removeClass('hide'); // the arrows between the tema boxes (byggjer på) and their labels are always shown
    cy.nodes('[kind="mlab"]').removeClass('hide');
    // a grey node of the tema view shows only while an arrow that is on ties it to a node of the tema that shows
    cy.nodes('.grey').forEach((n) => n.toggleClass('hide', !n.connectedEdges().some((e) => !e.hasClass('hide') && !e.connectedNodes().some((m) => m.id() !== n.id() && m.hasClass('hide')))));
    syncGhosts();
  }

  // A badge ("nytt for 1P") sits on the top right corner of its node or tema box. tone: new | rep | part | hole | ok
  function addBadge(parent, role, text, fs) {
    const area = parent.data('kind') === 'carea', fs0 = fs || 11;
    fs = fs0 * (area ? 1 / Z.t : 1); // a tema box is drawn as big on the screen at every map size, so its badge is too
    const m = measure(text, `700 ${fs}px ${SANS}`, fs, 4000, 1);
    const w = m.w + 14 * fs / fs0, hh = Math.round(fs * 1.6);
    const pw = area ? parent.data('cw') : parent.data('w0'), ph = area ? parent.data('ch') : parent.data('h0');
    const g = cy.add(ghost(parent.id(), role, text, w, hh, pw / 2 - w / 2 - 6, -ph / 2 - 1, { fs, fs0, kart: !state.tema, tv: !!state.tema, area, op: 1, opd: 0.2, opf: 0.12 }));
    g.position({ x: parent.position('x') + g.data('dx'), y: parent.position('y') + g.data('dy') });
  }
  const setData = (el, k, v) => {
    if (v != null) { if (el.data(k) !== v) el.data(k, v); } else if (el.data(k) !== undefined) el.removeData(k);
  };

  // Classes, colours and badges from the layers
  function applyMarks(specs) {
    cy.nodes('.ghost[role^="pill-"]').remove();
    realNodes().forEach((n) => {
      const s = specs.get(n.id());
      const prev = n.scratch('_lyClasses') || '', cls = s.classes.join(' ');
      if (prev !== cls) { if (prev) n.removeClass(prev); if (cls) n.addClass(cls); n.scratch('_lyClasses', cls); }
      setData(n, 'lyFill', s.fill);
      setData(n, 'lyRing', s.ring);
    });
    cy.nodes('[kind="carea"]').forEach((b) => {
      const s = LAYERS.clusterStyle(mode(), b.data('cid'), api);
      if (s.badge) addBadge(b, 'pill-' + s.badge.tone, s.badge.text, s.badge.size);
    });
    realNodes().forEach((n) => {
      const b = specs.get(n.id()).badge;
      if (b) addBadge(n, 'pill-' + b.tone, b.text, b.size);
    });
    syncGhosts();
    // the numbers on the arrows between the boxes keep off the badges of the boxes: place them again when the badges change
    const key = cy.nodes('.ghost[?area]').map((g) => g.data('of')).sort().join();
    if (key !== badgeKey) { badgeKey = key; if (Object.keys(TM).length) routeMeta(); }
  }
  let badgeKey = '';

  function applyFocus() {
    cy.elements().removeClass('dim sel nbr match');
    const R = realNodes();
    let focus = null;
    if (state.sel) {
      const node = cy.getElementById(state.sel);
      const edges = node.connectedEdges().not('.hide');
      const around = edges.connectedNodes().not('.hide').union(node);
      // the arrows of the node, and the ones between its neighbours: close up only these stay (see renderLevels)
      focus = around.union(edges).union(around.edgesWith(around).not('.hide'));
      node.addClass('sel');
      edges.addClass('nbr');
    } else if (state.km) {
      const ns = R.filter((n) => !n.hasClass('hide') && ((n.data('km') || []).includes(state.km) || n.id() === state.km));
      focus = ns.union(ns.edgesWith(ns).not('.hide'));
      const kn = cy.getElementById(state.km);
      if (kn.nonempty()) kn.addClass('sel');
    }
    if (state.q) {
      const q = norm(state.q);
      const m = R.filter((n) => !n.hasClass('hide') && nameHit(ownerOf(n), q));
      m.addClass('match');
      if (!focus) focus = m.union(m.edgesWith(m));
    }
    if (focus) cy.elements().not('.hide').not('.ghost').not('[kind="carea"],[kind="tframe"],[kind="clabel"],[kind="ctext"],[kind="mlab"],[?meta]').not(focus).not('node.keep').addClass('dim');
    // far out the same focus dims the tema boxes it does not touch: the temaa that hold the nodes, and a tema the filters fade completely
    const hits = new Set();
    if (focus) for (const n of R.filter((x) => !x.hasClass('hide') && focus.contains(x))) hits.add(n.data('grp'));
    const fadedAll = (cid) => { const own = R.filter((n) => n.data('grp') === cid); return own.nonempty() && own.toArray().every((n) => n.hasClass('fl') || n.hasClass('hide')); };
    KART.dim = new Set(areaIds().filter((cid) => (focus && !hits.has(cid)) || fadedAll(cid)));
    syncGhosts();
    renderLevels(0, true);
  }

  // ---------- Detail panel ----------
  const panel = $('panel');
  const hiddenForStudent = (n, field) => state.elev && (field === 'tekst_laerar' || (n.berre_laerar || []).includes(field));

  function dotFor(type) { return h('span', { class: 'dot t-' + type, 'aria-hidden': 'true' }); }

  function nodeLink(id) {
    const n = byId.get(id);
    // a prerequisite that "Vis forkunnskapar" hides is still named, but greyed and not a link
    if (!visNode(n)) return h('li', null, h('span', { class: 'linkoff' }, dotFor(n.type), rich(n.namn), h('span', { class: 'note' }, '(forkunnskap)')));
    return h('li', null, h('button', { class: 'linkbtn', onclick: () => select(id, { center: true }) }, dotFor(n.type), rich(n.namn)));
  }
  function kmButton(id) {
    const k = byId.get(id);
    if (!k) return null;
    return h('li', null, h('button', { class: 'kmitem', onclick: () => selectKm(id) }, h('span', { class: 'kmid' }, k.namn), rich(k.tekst)));
  }
  function section(title, items) {
    if (!items || !items.length) return null;
    const f = document.createDocumentFragment();
    f.append(h('h3', null, title), h('ul', { class: 'links' }, items));
    return f;
  }
  // A closed section of the card (<details>). What the viewer opens is remembered per viewer (localStorage, may be blocked) by key.
  const FOLD_KEY = 'fagkart.opneSeksjonar';
  const openFolds = (() => { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch (e) { return new Set(); } })();
  function saveFolds() { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...openFolds])); } catch (e) { /* storage blocked: the choice lasts for this visit */ } }
  // content: an element or a list of them (nothing: no section); count: a short number or text to the right of the title
  function fold(key, title, content, count) {
    const kids = [].concat(content || []).filter((k) => k != null && k !== false);
    if (!kids.length) return null;
    const d = h('details', { class: 'fold', 'data-fold': key }, h('summary', null, title, count != null && count !== '' ? h('span', { class: 'count' }, String(count)) : null), h('div', { class: 'foldbody' }, kids));
    d.open = openFolds.has(key);
    d.addEventListener('toggle', () => { if (d.open) openFolds.add(key); else openFolds.delete(key); saveFolds(); });
    return d;
  }
  const linkList = (items) => (items && items.length ? h('ul', { class: 'links' }, items) : null);
  // the name of a tema in the panel: a button that opens the tema on the map
  function klyngeBtn(cid, extra) {
    if (!hasTema || !clusterNodes.has(cid) || !LAYOUT.areas[cid]) return h('span', null, klyngeLabel(cid));
    return h('button', { class: 'linkbtn', onclick: () => openTema(cid) }, klyngeLabel(cid), extra ? h('span', { class: 'note' }, extra) : null);
  }

  function renderPanel() {
    // keep what is open in the card that is about to be replaced (the toggle event of a section may not have come yet)
    panel.querySelectorAll('.fold').forEach((d) => { if (d.open) openFolds.add(d.dataset.fold); else openFolds.delete(d.dataset.fold); });
    panel.replaceChildren();
    // Element.append() would write a missing part (null) as the text "null"
    const add = (...kids) => panel.append(...kids.filter((k) => k != null && k !== false));
    const open = !!(state.sel || state.km);
    panel.classList.toggle('open', open);
    $('app').dataset.panel = open ? 'open' : 'closed';
    const closeBtn = h('button', { class: 'btn close', onclick: clearFocus, 'aria-label': 'Lukk detaljar' }, 'Lukk');

    if (!open) {
      add(
        h('h2', null, 'Detaljar'),
        h('p', { class: 'empty' }, 'Vel eit omgrep eller ein metode i kartet for å sjå forklaring, døme og kva han heng saman med. Du kan òg søkje på namn.'),
        h('p', { class: 'empty' }, 'Vel eit kompetansemål i lista for å sjå kva omgrep og metodar som tener det.'),
        h('p', { class: 'empty' }, 'Escape fjernar markeringa.'),
      );
      return;
    }

    if (state.elev && !HOST && !ELEV_LINK) add(h('span', { class: 'studentbar' }, 'Elevvising er på'));

    if (state.km && !state.sel) {
      const k = byId.get(state.km);
      const served = nodes.filter((n) => !isKm(n) && visNode(n) && (n.km || []).includes(k.id));
      const covering = activeClusters().filter((cid) => clusterKm.get(cid).has(k.id));
      add(
        h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h2', null, h('span', { class: 'kmid' }, k.namn), 'Kompetansemål')), closeBtn),
        h('p', null, rich(k.tekst)),
        k.verb && k.verb.length ? h('div', { class: 'pills' }, k.verb.map((v) => h('span', { class: 'pill' }, v))) : null,
        k.klynge ? h('p', { class: 'note' }, 'Tema: ' + klyngeLabel(k.klynge)) : null,
        hasTema ? section(`Tema som dekkjer målet (${covering.length})`, covering.map((cid) =>
          h('li', null, klyngeBtn(cid, ` ${countText(clusterNodes.get(cid).filter((n) => (n.km || []).includes(k.id)))}`)))) : null,
        section(`Omgrep og metodar som tener målet (${served.length})`, served.map((n) => nodeLink(n.id))),
        ...LAYERS.kmCards(mode(), k, api),
      );
      return;
    }

    // The card of a node, from what you need every time to what you open when you want it: the name and kind, the explanation
    // (the student's text in student view, the teacher's text otherwise), the example, and then closed sections.
    const n = byId.get(state.sel);
    const typ = h('span', { class: 'pill' }, dotFor(n.type), TYPE_LABEL[n.type] || n.type);
    const home = groupOf(n), homeBtn = hasTema && clusterNodes.has(home) && LAYOUT.areas[home]
      ? h('button', { class: 'pill linkpill', type: 'button', title: 'Opne temaet', onclick: () => openTema(home) }, klyngeLabel(home)) : null;
    add(
      h('div', { class: 'head' },
        h('div', { class: 'grow' }, h('h2', null, rich(n.namn)), h('div', { class: 'pills' }, typ, isFk(n) ? h('span', { class: 'pill' }, 'Forkunnskap') : null,
          n.verbnivaa ? h('span', { class: 'pill' }, 'Nivå: ' + (VERB_LABEL[n.verbnivaa] || n.verbnivaa)) : null, homeBtn)),
        closeBtn),
    );

    add(...LAYERS.cards(mode(), 'top', n, api));

    const tag = (field) => (!state.elev && (n.berre_laerar || []).includes(field) ? h('span', { class: 'tag' }, 'berre lærar') : null);
    const box = (title, text, cls, field) => (text && !hiddenForStudent(n, field)
      ? h('div', { class: 'callout ' + (cls || '') }, h('span', { class: 't' }, title, tag(field)), h('div', { class: 'body' }, rich(text))) : null);
    const bare = (text, field) => (text && !hiddenForStudent(n, field) ? h('div', { class: 'body' }, rich(text)) : null);

    // the main text: the student's in student view; for the teacher the teacher's, and the student's text is one section away
    const teacherMain = !state.elev && n.tekst_laerar && !hiddenForStudent(n, 'tekst_laerar');
    if (state.elev || !teacherMain) add(box('Forklaring', n.tekst_elev, 'mint', 'tekst_elev'));
    else add(box('Forklaring til lærar', n.tekst_laerar, '', 'tekst_laerar'));
    add(box('Døme', n.doeme, '', 'doeme'));

    const L = (ids) => ids.map(nodeLink);
    // forvekslast med: where the student reads, not as an arrow on the map
    const conf = [...relOut('forvekslast_med', n.id), ...relIn('forvekslast_med', n.id)];
    if (conf.length) add(h('div', { class: 'callout conf' }, h('span', { class: 't' }, 'Lett å blande med'), linkList(L(conf))));
    const rel = (title, ids) => (ids.length ? [title, ids] : null);
    const more = [ // the other arrows that are not byggjer på: together in one section
      rel('Brukar', relOut('brukar', n.id)), rel('Blir brukt av', relIn('brukar', n.id)),
      rel('Er døme på', relOut('doeme_paa', n.id)), rel('Har døme', relIn('doeme_paa', n.id)),
      rel('Representerast som', relOut('representerast_som', n.id)), rel('Er representasjon av', relIn('representerast_som', n.id)),
    ].filter(Boolean);
    const builds = relOut('byggjer_paa', n.id), basis = relIn('byggjer_paa', n.id);
    const folds = [
      !state.elev && teacherMain ? fold('elevtekst', 'Forklaring til eleven', bare(n.tekst_elev, 'tekst_elev')) : null,
      fold('misoppfatning', 'Vanleg misoppfatning', bare(n.misoppfatning, 'misoppfatning')),
      fold('km', 'Kompetansemål', n.km && n.km.length ? h('ul', { class: 'links' }, n.km.map(kmButton)) : null, n.km && n.km.length),
      fold('kjerneelement', 'Kjerneelement', n.kjerneelement && n.kjerneelement.length ? h('div', { class: 'pills' }, n.kjerneelement.map((k) => h('span', { class: 'pill' }, lab(kjerneNamn.get(k) || k)))) : null),
      fold('byggjer', 'Byggjer på', linkList(L(builds)), builds.length),
      fold('grunnlag', 'Er grunnlag for', linkList(L(basis)), basis.length),
      fold('koplingar', 'Andre koplingar', more.map(([t, ids]) => [h('h3', null, t), linkList(L(ids))]).flat(), more.reduce((t, [, ids]) => t + ids.length, 0)),
    ].filter(Boolean);
    if (folds.length) add(h('div', { class: 'folds' }, folds));
    if (!builds.length && !basis.length && !more.length && !conf.length) add(h('p', { class: 'empty', style: 'margin-top:.6rem' }, 'Ingen koplingar til andre omgrep og metodar.'));
    add(...LAYERS.cards(mode(), 'bottom', n, api));
    panel.scrollTop = 0;
  }

  // ---------- Sidebar ----------
  function buildSidebar() {
    // kompetansemaal list
    const list = $('kmList');
    for (const k of kmNodes) {
      const b = h('button', { class: 'kmitem', type: 'button', 'aria-pressed': 'false', 'data-km': k.id },
        h('span', { class: 'kmid' }, k.namn), rich(k.tekst), h('span', { class: 'kmcount' }));
      b.addEventListener('click', () => selectKm(k.id, true));
      list.append(h('li', null, b));
    }
    if (!kmNodes.length) list.append(h('li', { class: 'note' }, 'Ingen kompetansemål i dette kartet.'));

    // a searchable list of everything: every concept and method, by tema (the order of the map), a click chooses it
    const all = $('allList');
    const order = new Map(CLUSTERS.map((c, i) => [c, i]));
    const items = nodes.filter((n) => !isKm(n)).sort((a, b) => (order.get(groupOf(a)) ?? 99) - (order.get(groupOf(b)) ?? 99) || lab(a.namn).localeCompare(lab(b.namn), 'nn'));
    for (const n of items) {
      const b = h('button', { type: 'button', 'data-id': n.id }, dotFor(n.type), rich(n.namn), hasTema ? h('span', { class: 'rescl' }, klyngeLabel(groupOf(n))) : null);
      b.addEventListener('click', () => { closeMore(); select(n.id, { center: true }); });
      all.append(h('li', { 'data-q': norm(lab(n.namn)) + ' ' + norm(n.namn) + ' ' + norm(klyngeLabel(groupOf(n))) }, b));
    }
    all.append(h('li', { class: 'none', hidden: true, 'data-none': '1' }, 'Ingen treff'));
    $('allQ').addEventListener('input', renderAll);

    // the controls of the layers: a layer either wires its controls in the page or returns an element for its own section
    for (const l of LAYERS.all()) startLayerToolbar(l);
  }
  // The legend in the "?" box: the arrows that are drawn now. Byggjer på always; the others while the layer "koplingar" shows them
  // (dekkjer is never drawn). Built again when that changes.
  let legendKey = null;
  function renderLegend() {
    const shown = EDGE_DEFS.filter(([t]) => t === 'byggjer_paa' || (t !== 'dekkjer' && state.showKoplingar));
    const key = shown.map(([t]) => t).join();
    if (key === legendKey) return;
    legendKey = key;
    const leg = $('legend');
    const col = { byggjer_paa: 'var(--lo-muted)', brukar: 'var(--lo-green)', doeme_paa: 'var(--lo-violet)', representerast_som: 'var(--lo-warn)', forvekslast_med: 'var(--lo-red)' };
    const dash = { doeme_paa: '2 4', forvekslast_med: '7 5' };
    const ns = 'http://www.w3.org/2000/svg';
    leg.replaceChildren();
    for (const [t, label] of shown) {
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 38 12');
      svg.setAttribute('aria-hidden', 'true');
      const line = document.createElementNS(ns, 'line');
      for (const [k, v] of Object.entries({ x1: 1, y1: 6, x2: t === 'forvekslast_med' ? 37 : 30, y2: 6, 'stroke-width': 2.2 })) line.setAttribute(k, v);
      line.style.stroke = col[t];
      if (dash[t]) line.setAttribute('stroke-dasharray', dash[t]);
      svg.append(line);
      if (t !== 'forvekslast_med') {
        const head = document.createElementNS(ns, 'path');
        head.setAttribute('d', t === 'brukar' ? 'M26 1 L36 6 L26 11' : 'M28 1 L37 6 L28 11 Z');
        head.style.stroke = col[t];
        head.style.fill = t === 'brukar' ? 'none' : col[t];
        head.setAttribute('stroke-width', '1.6');
        svg.append(head);
      }
      leg.append(h('div', { class: 'legrow', 'data-et': t }, svg, label));
    }
  }
  // The controls of a layer go into "Fleire val", before the print button
  function startLayerToolbar(l) {
    const el = l.toolbar ? l.toolbar(api) : null;
    if (!el) return;
    $('side').insertBefore(h('details', { class: 'sec', open: true, 'data-layer': l.id }, h('summary', null, l.label || l.id), h('div', { class: 'body' }, el)), $('side').querySelector('.morefoot'));
  }
  // The list of everything: what does not match the box is hidden, and so is the forkunnskap while "Vis forkunnskapar" is off
  function renderAll() {
    const q = norm($('allQ').value.trim());
    let shown = 0;
    document.querySelectorAll('#allList li[data-id], #allList li[data-q]').forEach((li) => {
      const n = byId.get(li.firstChild.dataset.id), ok = visNode(n) && (!q || li.dataset.q.includes(q));
      li.hidden = !ok;
      if (ok) shown++;
    });
    document.querySelector('#allList [data-none]').hidden = shown > 0;
    $('stAll').textContent = String(nodes.filter((n) => !isKm(n) && visNode(n)).length);
  }

  // "Fleire val" in the student view: the sections of the student layers come first and open, "Visning" is closed and
  // "Vis implisitte piler" is hidden. The teacher view has "Visning" first and open. Done once per change of mode.
  const STUDENT_FIRST = ['eigenvurdering', 'nestesteg', 'stiar'];
  let sideMode = null;
  function arrangeSide(m) {
    const side = $('side'), vis = $('visningSec');
    const secs = STUDENT_FIRST.map((id) => side.querySelector(`[data-layer="${id}"]`)).filter(Boolean);
    if (m === 'elev') {
      for (const sec of secs) { side.insertBefore(sec, vis); sec.open = true; }
      vis.open = false;
    } else {
      const foot = side.querySelector('.morefoot');
      for (const sec of secs) side.insertBefore(sec, foot);
      vis.open = true;
    }
    $('swImplRow').hidden = m === 'elev';
  }
  function renderSidebar() {
    const m = mode();
    if (m !== sideMode) { sideMode = m; arrangeSide(m); }
    document.querySelectorAll('#kmList .kmitem').forEach((b) => {
      b.setAttribute('aria-pressed', String(state.km === b.dataset.km));
      b.querySelector('.kmcount').textContent = countText(nodes.filter((n) => !isKm(n) && visNode(n) && (n.km || []).includes(b.dataset.km)));
    });
    $('swFk').checked = state.showFk;
    $('swImpl').checked = state.showImplicit;
    renderLegend();
    const status = LAYERS.call(m, 'status', api).map((p) => p.value).filter(Boolean);
    $('stView').textContent = status.filter((v) => v !== 'alle').join(', ');
    $('stKm').textContent = `${kmNodes.length} mål`;
    document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode())));
    $('evBtn').hidden = m !== 'elev';
    $('evBtn').setAttribute('aria-pressed', String(state.ev));
    // a layer that is not available in this mode keeps its section, hidden
    const on = new Set(LAYERS.active(m).map((l) => l.id));
    document.querySelectorAll('#side [data-layer]').forEach((sec) => { sec.hidden = !on.has(sec.dataset.layer); });
    LAYERS.call(m, 'render', api);
    renderAll();
    // a dot on the button while a choice in "Fleire val" is not the plain one
    $('moreDot').hidden = !($('stView').textContent || $('stFilter').textContent.replace('ingen', '') || state.showImplicit || state.showKoplingar || state.alt || (hasFk && !state.showFk));
  }

  // ---------- Level buttons and hint ----------
  function renderLevelButtons() {
    document.querySelectorAll('#levelBtns button').forEach((b) => b.setAttribute('aria-pressed', String(!state.tema && b.dataset.level === KART.level)));
  }

  function renderHint() {
    let t = {
      tema: 'Klikk eit tema for å sjå berre det, eller zoom inn. Tala på pilene er kor mange «byggjer på»-piler som går mellom temaa.',
      kart: (state.showFk ? 'Stipla ramme er forkunnskap. ' : '') + 'Pilene går frå det du må kunne til det som byggjer på det. Zoom inn for utdjuping, eller klikk temanamnet for å sjå berre det temaet.',
      detalj: 'Utdjuping er synleg. Klikk eit omgrep eller ein metode for forklaring og kva han heng saman med.',
    }[KART.level];
    if (state.tema) t = 'Omgrepa og metodane i temaet står i ramma. Dei grå boksane høyrer til andre tema og heng saman med dette: klikk ein for å opne temaet hans. Pilene går frå det du må kunne til det som byggjer på det.';
    if (state.km) {
      const k = byId.get(state.km);
      t = state.tema || KART.level !== 'tema' ? `${k.namn}: omgrepa og metodane som tener målet er utheva.` : `${k.namn}: temaa som dekkjer målet er utheva. Klikk eit tema for å sjå omgrepa.`;
    }
    $('hint').textContent = t;
    // a competence goal is chosen: say so on the map, with one click to clear it
    const chip = $('focusChip');
    chip.hidden = !state.km;
    if (state.km) $('focusChipText').textContent = `Kompetansemål ${byId.get(state.km).namn}`;
  }

  // ---------- Search ----------
  const qInput = $('q'), resultsEl = $('results');
  let resIdx = -1, resIds = [];

  function renderResults() {
    resultsEl.replaceChildren();
    const q = norm(state.q.trim());
    if (!q) { resultsEl.hidden = true; qInput.setAttribute('aria-expanded', 'false'); return; }
    resIds = nodes.filter((n) => visNode(n) && nameHit(n, q)).slice(0, 8).map((n) => n.id);
    if (resIdx >= resIds.length) resIdx = resIds.length - 1;
    if (!resIds.length) resultsEl.append(h('li', { class: 'none', role: 'presentation' }, 'Ingen treff'));
    resIds.forEach((id, i) => {
      const n = byId.get(id);
      const b = h('button', { type: 'button', role: 'option', 'aria-selected': String(i === resIdx) }, dotFor(n.type), rich(n.namn),
        hasTema && !isKm(n) ? h('span', { class: 'rescl' }, klyngeLabel(groupOf(n))) : null);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => pickResult(id));
      resultsEl.append(h('li', { role: 'presentation' }, b));
    });
    resultsEl.hidden = false;
    qInput.setAttribute('aria-expanded', 'true');
  }
  function pickResult(id) {
    state.q = ''; qInput.value = ''; resIdx = -1; renderResults();
    qInput.blur();
    const n = byId.get(id);
    if (state.tema && n && !isKm(n) && groupOf(n) !== state.tema) { leaveTema({ then: () => select(id, { center: true }) }); return; } // outside the tema: back to the surface
    select(id, { center: true });
  }
  qInput.addEventListener('input', () => { state.q = qInput.value; resIdx = -1; renderResults(); update(); });
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { resIdx = Math.min(resIds.length - 1, resIdx + 1); renderResults(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { resIdx = Math.max(0, resIdx - 1); renderResults(); e.preventDefault(); }
    else if (e.key === 'Enter' && resIds.length) { pickResult(resIds[Math.max(0, resIdx)]); e.preventDefault(); }
    else if (e.key === 'Escape') { state.q = ''; qInput.value = ''; renderResults(); update(); e.stopPropagation(); }
  });
  qInput.addEventListener('focus', renderResults);
  qInput.addEventListener('blur', () => { resultsEl.hidden = true; });

  // ---------- Actions ----------
  // "Fleire val": closed at the start; a click on the button, Escape or a click outside closes it
  const moreOpen = () => $('app').dataset.more === 'open';
  function setMore(open) {
    $('app').dataset.more = open ? 'open' : 'closed';
    $('moreBtn').setAttribute('aria-expanded', String(open));
    $('backdrop').hidden = !(open && narrow());
    if (cy) requestAnimationFrame(() => cy.resize());
  }
  const closeMore = () => { if (moreOpen()) setMore(false); };
  function setMode(elev) { state.elev = elev; saveElev(elev); setStrek(elev && state.ev); update(); }
  function setEv(on) { state.ev = on; saveEv(on); setStrek(state.elev && on); update(); }
  function setShowAll(on) {
    state.alt = on;
    saveShowAll(on);
    $('swAlt').checked = on;
    if (cy && !state.tema) renderLevels(0, true);
  }
  // A new text size: the anchors move, and the view stays on its level (the tema view fits again)
  function setTextSize(v) {
    if (v === state.tekst || !TEXT_SIZES.some(([k]) => k === v)) return;
    state.tekst = v;
    saveTextSize(v);
    renderTextSize();
    if (!cy) return;
    if (state.tema) { fitTemaView(); return; }
    finishTween();
    const lv = KART.level;
    if (lv === 'tema') { fitKart(); return; }
    refreshAnchors();
    goLevel(lv);
  }
  function renderTextSize() {
    document.querySelectorAll('#tekstSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tekst === state.tekst)));
  }

  function ensureShown(id) {
    const n = cy.getElementById(id);
    if (n.nonempty() && n.hasClass('hide')) {
      // the layers that hide the node let it through
      LAYERS.call(mode(), 'reveal', byId.get(id), api);
      applyVisibility();
    }
  }

  // The switch "Vis forkunnskapar". At Kart and Detalj the map glides between its two layouts; at Tema it is built again.
  function setShowFk(on, persist) {
    if (!hasFk || on === state.showFk) { $('swFk').checked = state.showFk; return; }
    finishTween();
    state.showFk = on;
    if (persist !== false) saveShowFk(on);
    $('swFk').checked = on;
    if (!on && state.sel && isFk(byId.get(state.sel))) state.sel = null;
    if (state.tema) { // the tema view has a layout of its own for each state of the switch; the forkunnskap tema is gone with it
      if (LAYOUT_NOFK) LAYOUT = on ? LAYOUT_FULL : LAYOUT_NOFK;
      if (!on && state.tema === 'forkunnskap') { exitTemaNow('forkunnskap'); fitKart(); return; }
      rebuild();
      update();
      fitTemaView();
      return;
    }
    if (KART.level !== 'tema' && LAYOUT_FULL && LAYOUT_NOFK) {
      transitionKart(on);
      update();
      return;
    }
    if (LAYOUT_NOFK) LAYOUT = on ? LAYOUT_FULL : LAYOUT_NOFK;
    rebuild();
    if (state.sel && cy.getElementById(state.sel).empty()) state.sel = null;
    update();
    fitKart();
  }

  function select(id, opts) {
    opts = opts || {};
    const node = byId.get(id);
    if (!node || !visNode(node)) return;
    if (isKm(node)) { selectKm(id); return; }
    if (state.tema && groupOf(node) !== state.tema) { closeMore(); openTema(groupOf(node), { sel: id }); return; } // a node of another tema: that tema opens with it chosen
    LAYERS.call(mode(), 'onSelect', node, api);
    ensureShown(id);
    state.sel = id; state.km = null;
    update();
    if (opts.center) focusKartNode(id);
    closeMore();
  }
  function selectKm(id, toggle) {
    if (toggle && state.km === id && !state.sel) { clearFocus(); return; }
    state.km = id; state.sel = null;
    closeMore();
    // a goal the open tema does not cover is shown on the surface, where the temaa that cover it are lit
    if (state.tema && !clusterKm.get(state.tema).has(id)) { leaveTema({ then: () => selectKm(id) }); return; }
    update();
    if (state.tema) return; // the nodes of the tema that serve the goal are lit in the view
    // the nodes that serve the goal: Kart level when they fit that close, else the whole map with the temaa that hold them lit
    const b = kartBox(Object.keys(LAYOUT.nodes).filter((nid) => inKart(nid) && (byId.get(nid).km || []).includes(id)));
    if (!b) return;
    requestAnimationFrame(() => { cy.resize(); if (fitZoom(b) >= Z.k * 0.85) flyTo(b, Z.k, Z.k * 1.1); else goTema(); });
  }
  function clearFocus() { state.sel = null; state.km = null; update(); }

  // Frame a set of nodes at a readable zoom
  function frame(eles) {
    eles = eles.nodes().not('.hide');
    if (!eles.length) return;
    if (state.tema) { // the view is one picture: bring the nodes in at a readable zoom
      const bb = eles.boundingBox(), z = clamp(Math.min((cy.width() - 100) / (bb.x2 - bb.x1), (cy.height() - 100) / (bb.y2 - bb.y1)), cy.zoom() * 0.9, Math.max(cy.zoom(), 1.1));
      glide(z, { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 }, 320);
      return;
    }
    const b = kartBox(eles.map((n) => n.id()));
    if (b) flyTo(b, Z.k * 0.85, Z.k * 1.1);
  }

  // A node that is chosen far out comes into view at Kart level; otherwise the map only pans when the node is near the edge
  function ensureVisible(n) {
    if (!n || n.empty()) return;
    requestAnimationFrame(() => {
      cy.resize();
      const p = n.renderedPosition(), w = cy.width(), hh = cy.height(), m = 70;
      const out = p.x < m || p.y < m || p.x > w - m || p.y > hh - m;
      if (!state.tema && cy.zoom() < Z.k * 0.8) focusKartNode(n.id());
      else if (out) cy.animate({ center: { eles: n } }, { duration: 200 });
    });
  }

  function update(opts) {
    opts = opts || {};
    const specs = layerSpecs();
    applyVisibility(specs);
    applyMarks(specs);
    applyFocus();
    renderPanel();
    renderSidebar();
    renderNytt();
    renderLevelButtons();
    renderHint();
    renderTemaBar();
    if (HOST) hostNotify();
    if (opts.refit && KART.level === 'tema' && !state.tema) fitKart(); // a change of the filters keeps your place unless the whole map is in view
    requestAnimationFrame(() => cy.resize());
    scheduleViewport();
  }

  // ---------- Poster (print) ----------
  // The map at the Kart level as one sharp image, always in the light palette, so the sheet looks the same on any screen.
  let posterTema = null; // the tema view that was open when the poster was made: it comes back after printing
  function preparePoster() {
    if (!cy) return false;
    finishTween();
    if (state.tema) { posterTema = state.tema; resetStage(); exitTemaNow(state.tema); } // the poster is the zoom surface
    const root = document.documentElement, theme = root.dataset.theme;
    const dimmed = cy.elements('.dim, .fl, .sel, .nbr, .match');
    const kept = dimmed.map((e) => [e, e.classes()]);
    const before = { zoom: cy.zoom(), pan: { ...cy.pan() } };
    root.dataset.theme = 'light';
    let uri;
    try {
      cy.style(buildStyle());
      dimmed.removeClass('dim fl sel nbr match');
      cy.nodes('.ghost').addClass('zoff');
      renderLevels(0, true, { s1: 1, s2: 0 });
      uri = cy.png({ full: true, scale: 2, bg: tokens().cream, output: 'base64uri' });
    } finally {
      if (theme === undefined) delete root.dataset.theme; else root.dataset.theme = theme;
      cy.style(buildStyle());
      for (const [e, cls] of kept) e.classes(cls);
      cy.nodes('.ghost').removeClass('zoff');
      cy.viewport(before);
      renderLevels(0, true);
    }
    $('posterTitle').textContent = `Fagkart ${lab(data.namn || '')} (${KODE})`.replace('  ', ' ');
    $('posterNote').textContent = `Versjon ${data.versjon || '?'}. Pila går frå det du må kunne til det som byggjer på det. Raud stipla line: blir ofte forveksla.${hasFk && !state.showFk ? ' Utan forkunnskap.' : ''}`;
    $('posterImg').src = uri;
    $('poster').classList.add('ready');
    return true;
  }

  // ---------- Layer API ----------
  // What a layer gets as ctx in every hook: the map, helpers for the card and a few actions. Layers never see Cytoscape.
  const api = {
    data, kode: KODE, nodes, byId, kmNodes, fagList, fagLabel, isFk, isKm, groupOf, lab, rich, h, dotFor, klyngeLabel, nodeLink, section, fold, TYPE_LABEL,
    clusters: () => activeClusters(), clusterNodes, clusterKm,
    graph, // graph.js over the edges of the map, with the implied edges while they are shown
    alg: { reach, topoOrder, prerequisiteChain, shortestPath, readyToLearn }, // the algorithms of graph.js
    state, // the core's view state: read it, but only change the fields your layer owns
    get tema() { return state.tema; }, // the tema that is open in the tema view (its id), or null on the zoom surface
    get level() { return state.level; }, // tema | kart | detalj
    get view() { return 'kart'; }, // kept for older layers: there is one surface now, so this is always 'kart'; use level
    get mode() { return mode(); },
    layer: (id) => LAYERS.get(id), // another layer by id (null when it is not registered), for what it exposes beyond the hooks
    leaveRoom, // out of the room (state.rom): forgets it and opens the page again without ?rom=
    // HTML over the map that follows the nodes: the element to put it in, and where a node is on the screen now (hook viewport)
    get stageLayer() { return $('stageLayer'); }, // beside #cy, kept over it; its children take pointer events, it does not
    nodeBox,
    update: (opts) => update(opts),
    rebuild: () => rebuild(),
    select: (id, opts) => select(id, opts),
    // ids of the real nodes that are not hidden, and an animated frame around some of them
    shownIds: () => realNodes().not('.hide').map((n) => n.id()),
    frame: (ids) => frame(cy.collection(ids.map((id) => cy.getElementById(id)))),
  };
  window.fagkart = {
    PRIORITY,
    registerLayer(def) {
      const l = LAYERS.register(def);
      if (started) { // late: the style, the controls and the map take the new layer in at once
        if (l.init) l.init(api);
        ghostSharedList = null;
        cy.style(buildStyle());
        startLayerToolbar(l);
        update();
      }
      return l.id;
    },
  };

  // ---------- Init ----------
  function init() {
    $('title').append(h('span', { class: 'mark' }, rich(data.namn || KODE)));
    const plan = data.laereplan && data.laereplan !== KODE ? ` · ${data.laereplan}` : ''; // S2 · MAT04-02: show the curriculum code too when it is not the map code
    $('meta').textContent = `${KODE}${plan}, versjon ${data.versjon || '?'}`;
    $('moreVersjon').textContent = $('helpVersjon').textContent = `${KODE} · versjon ${data.versjon || '?'}`; // the brand meta is hidden on a phone
    document.title = `Fagkart ${lab(data.namn || '')} (${KODE})`.replace('  ', ' ');
    if (!hasKart) { // nothing to draw
      $('cy').append(h('p', { class: 'empty', style: 'padding:1.5rem' }, 'Dette kartet har ingen omgrep å teikne enno.'));
      for (const id of ['levelBtns', 'modeSeg', 'moreBtn']) $(id).hidden = true;
      document.documentElement.dataset.ready = '1';
      if (HOST) startHost();
      return;
    }

    cy = cytoscape({
      container: $('cy'), elements: [], style: buildStyle(), layout: { name: 'preset' },
      minZoom: 0.08, maxZoom: 2.5, boxSelectionEnabled: false, autounselectify: true, pixelRatio: 'auto',
    });
    for (const l of LAYERS.all()) if (l.init) l.init(api);
    window.__cy = cy; // handy for debugging and the screenshot script
    window.__fk = { layers: LAYERS, state, CLUSTERS, metaCount, setShowFk, setTextSize, setShowAll, setStrek, setEv, select, goLevel, focusArea, areaAt, temaColor, preparePoster, Z, KART, openTema, leaveTema, TV, temaLayout,
      get TM() { return TM; }, get LAYOUT() { return LAYOUT; }, get LAYOUT_FULL() { return LAYOUT_FULL; }, get LAYOUT_NOFK() { return LAYOUT_NOFK; } };
    rebuild();

    buildSidebar();

    cy.on('tap', 'node', (e) => {
      const t = e.target;
      if (t.hasClass('ghost')) return;
      const id = t.id();
      if (t.data('grey')) { openTema(groupOf(byId.get(id)), { sel: id }); return; } // a grey node: its own tema opens with it chosen
      if (isKm(byId.get(id))) selectKm(id); else select(id, { center: false });
      ensureVisible(cy.getElementById(id));
    });
    // a tap on a tema box (far out) or on the name of a tema (once it has opened) opens the tema view; anywhere else on the background clears the choice
    cy.on('tap', (e) => {
      if (e.target !== cy) return;
      const cid = areaAt(e.position) || bandAt(e.position);
      if (cid) openTema(cid); else clearFocus();
    });
    cy.on('mouseover', 'node', (e) => { if (!e.target.hasClass('ghost')) $('cy').style.cursor = 'pointer'; });
    cy.on('mouseout', 'node', () => { $('cy').style.cursor = ''; });
    cy.on('mousemove', (e) => {
      if (e.target !== cy) return;
      const box = areaAt(e.position), cid = box || bandAt(e.position);
      $('cy').style.cursor = cid ? 'pointer' : '';
      if (cid !== KART.hot) { KART.hot = cid; renderLevels(0, true); }
    });
    cy.on('mouseout', (e) => { if (e.target === cy && KART.hot) { KART.hot = null; renderLevels(0, true); } });

    $('swFkRow').hidden = !hasFk;
    $('swFk').checked = state.showFk;
    $('swFk').addEventListener('change', (e) => setShowFk(e.target.checked));
    $('swAlt').checked = state.alt;
    $('swAlt').addEventListener('change', (e) => setShowAll(e.target.checked));
    $('modeSeg').hidden = HOST || ELEV_LINK; // the host picks the text field (fagkart:vising); the student link stays the student view
    document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode === 'elev')));
    $('evBtn').addEventListener('click', () => setEv(!state.ev));
    document.querySelectorAll('#levelBtns button').forEach((b) => b.addEventListener('click', () => goLevel(b.dataset.level)));
    for (const [k, label] of TEXT_SIZES) {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === state.tekst), 'data-tekst': k }, label);
      b.addEventListener('click', () => setTextSize(k));
      $('tekstSeg').append(b);
    }
    const zoomBy = (k) => {
      cy.stop();
      cy.animate({ zoom: { level: clamp(cy.zoom() * k, cy.minZoom(), cy.maxZoom()), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 200 });
    };
    $('zIn').addEventListener('click', () => zoomBy(1.3));
    $('zOut').addEventListener('click', () => zoomBy(1 / 1.3));
    $('printBtn').addEventListener('click', async () => {
      if (!preparePoster()) return;
      try { await $('posterImg').decode(); } catch (e) { /* print anyway */ }
      window.print();
    });
    window.addEventListener('beforeprint', () => preparePoster());
    window.addEventListener('afterprint', () => {
      $('poster').classList.remove('ready');
      if (posterTema) { const cid = posterTema; posterTema = null; openTema(cid); }
    });
    cy.on('zoom', scheduleLevels);
    cy.on('viewport', scheduleViewport); // a pan or a zoom, also while the map glides
    $('moreBtn').addEventListener('click', () => setMore(!moreOpen()));
    $('moreClose').addEventListener('click', () => { closeMore(); $('moreBtn').focus(); });
    $('backdrop').addEventListener('click', closeMore);
    // a click outside the drop-down closes it (the search box and the map count as outside)
    document.addEventListener('pointerdown', (e) => { if (moreOpen() && !narrow() && !e.target.closest('#side, #moreBtn')) closeMore(); });
    // the "?" in the corner of the map: what the arrows mean, and a line about the level you are at
    $('helpBtn').addEventListener('click', () => setHelp($('helpBox').hidden));
    // "Kva er nytt" in the strip for a newer version (oppdatering.js) reloads the page and leaves this mark: the help box is open on the new page
    try { if (sessionStorage.getItem('fagkart.nytt') === '1') { sessionStorage.removeItem('fagkart.nytt'); renderNytt(); setHelp(true); $('helpBox').scrollTop = Math.max(0, $('nytt').offsetTop - 8); } } catch (e) { /* storage blocked: the box stays closed */ }
    $('focusChipClear').addEventListener('click', clearFocus);
    $('temaBack').addEventListener('click', () => leaveTema());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.activeElement === qInput) return;
      if (moreOpen()) { closeMore(); $('moreBtn').focus(); return; }
      if (!$('helpBox').hidden) { $('helpBox').hidden = true; $('helpBtn').setAttribute('aria-expanded', 'false'); return; }
      if (state.tema && !state.sel && !state.km) { leaveTema(); return; } // nothing chosen: Escape goes back to all the temaa
      clearFocus();
    });

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const restyle = () => { cy.style(buildStyle()); renderLevels(0, true); renderTemaBar(); };
    if (mq.addEventListener) mq.addEventListener('change', restyle);
    // the box sizes depend on the screen width (the narrow layout), so take them in again when the breakpoint is crossed
    const nq = window.matchMedia('(max-width: 1000px)');
    if (nq.addEventListener) nq.addEventListener('change', () => { if (state.tema) { fitTemaView(); return; } refreshAnchors(); renderLevels(0, true); });
    // a phone turned upright (or back) takes the other pair of layouts
    if (PORTRAIT.addEventListener) PORTRAIT.addEventListener('change', () => {
      finishTween();
      const before = LAYOUT;
      pickLayouts();
      if (LAYOUT === before) return;
      rebuild();
      update();
      fitKart();
    });

    let first = true;
    new ResizeObserver(() => {
      if (!$('cy').clientWidth) return;
      cy.resize();
      if (first) { first = false; fitKart(); }
      else if (state.tema) { if (Math.abs(cy.zoom() - TV.z) < 0.002) { fitTemaView(); if (state.sel) revealNode(state.sel); } } // the view was whole: fit it again
      else if (KART.level === 'tema' && Math.abs(cy.zoom() - Z.t) < 0.002) fitKart(); // the stage changed size while the whole map was in view: fit it again
    }).observe($('cy'));

    if (ROOM.unknown != null) showRoomUnknown(ROOM.unknown);

    started = true;
    update();
    fitKart();
    document.documentElement.dataset.ready = '1';
    if (HOST) startHost();
    else selectFromLink();
  }

  // ?node=<id> in the link (the page of innspel/ links a comment this way): that node is chosen and centred once the page has settled (after the first
  // fit of the map, which would otherwise move it again). A level 2 node opens its tema, as for the host. An unknown or hidden id does nothing. Never in host mode.
  function selectFromLink() {
    let id = null;
    try { const q = new URLSearchParams(location.search).get('node'); id = q != null && q.trim() ? q.trim() : null; } catch (e) { /* no query */ }
    if (id) requestAnimationFrame(() => requestAnimationFrame(() => hostSelect(id)));
  }

  // ?rom= with an id the map has no room for: a line over the map until it is closed
  function showRoomUnknown(id) {
    const close = h('button', { type: 'button', class: 'btn small', 'aria-label': 'Lukk meldinga' }, 'Lukk');
    const text = ROOM.offline
      ? `Fekk ikkje kontakt med tenesta for rom, så rommet «${id}» kunne ikkje opnast. Kartet er opna utan rom. Prøv att seinare.`
      : `Fann ikkje rommet «${id}» for dette kartet. Kartet er opna utan rom.`;
    const el = h('div', { class: 'romhint', id: 'romHint', role: 'status' }, text, close);
    close.addEventListener('click', () => el.remove());
    $('stage').append(el);
  }

  // ---------- Host mode (Faglogg) ----------
  // In: fagkart:overlegg (to the layer "faglogg"), fagkart:vel, fagkart:vising. Out: fagkart:klar once, fagkart:valt at every change of the chosen node.
  // Only the parent window is believed. Nothing that comes in is stored, and nothing but map ids goes out (so the target origin is "*").
  let sentSel = null;
  const toParent = (msg) => { if (window.parent === window) return; try { window.parent.postMessage(msg, '*'); } catch (e) { /* no parent to tell */ } };
  function hostNotify() {
    if (state.sel === sentSel) return;
    sentSel = state.sel;
    toParent({ type: 'fagkart:valt', node: sentSel });
  }
  // The node is asked for by the host: a level 2 node needs its tema open to show, a level 1 node is just chosen
  function hostSelect(id) {
    const node = byId.get(id);
    if (!node || !visNode(node)) return;
    const p = LAYOUT.nodes[id], cid = groupOf(node);
    if (!isKm(node) && p && p.l === 2 && state.tema !== cid && canTema(cid)) openTema(cid, { sel: id }); else select(id, { center: true });
  }
  // Line work on or off (state.strek): the whole style is built again, the levels and the tema bar take the new colours in
  function setStrek(on) {
    on = !!on;
    if (state.strek === on) return;
    state.strek = on;
    if (!cy) return;
    cy.style(buildStyle());
    renderLevels(0, true);
    renderTemaBar();
  }
  function startHost() {
    window.addEventListener('message', (e) => {
      if (window.parent === window || e.source !== window.parent) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'fagkart:overlegg') {
        const l = LAYERS.get('faglogg');
        // with an overlay the map is line work, so its colours are the only ones; without one it is the plain map again
        if (l && l.setOverlay && l.setOverlay(m.overlegg)) setStrek(m.overlegg != null);
      } else if (m.type === 'fagkart:vel') {
        if (!cy) return;
        if (typeof m.node === 'string') hostSelect(m.node); else if (m.node === null) clearFocus();
      } else if (m.type === 'fagkart:vising') {
        if (m.vising === 'laerar' || m.vising === 'elev') { state.elev = m.vising === 'elev'; if (cy) update(); }
      }
    });
    toParent({ type: 'fagkart:klar', kart: KODE, kartversjon: String(data.versjon || '?') });
  }

  // Start once the layer scripts after this one have run (DOMContentLoaded) and the fonts are loaded
  function start() {
    const fontLoads = ['600 14px "Source Sans 3"', '400 14px "Source Sans 3"', '600 14px "Space Grotesk"', '700 14px "JetBrains Mono"', '500 12px "JetBrains Mono"']
      .map((f) => (document.fonts ? document.fonts.load(f) : Promise.resolve()));
    const fonts = Promise.race([Promise.all(fontLoads), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
    // the list of rooms (only when a room is asked for) is fetched while the fonts load; it never holds the page back for more than its timeout
    Promise.all([fonts, loadRoom().catch(() => {})]).then(() => { state.rom = ROOM.room; init(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
