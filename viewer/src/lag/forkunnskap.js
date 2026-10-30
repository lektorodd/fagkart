/* Layer "forkunnskap": the subject switch (Alle · 1P · 1T …). For the chosen subject it marks the holes in the
   forkunnskap (red and yellow border), puts "nytt for 1P" badges on what the subject teaches, counts per klynge in
   the overview, and adds the subject pills to the card. The switch "Vis forkunnskapar" itself belongs to the core. */
(function () {
  'use strict';
  let fag = 'alle';
  const $ = (id) => document.getElementById(id);

  // a node the subject teaches: new, repetition or partly new for the chosen subject
  function newKind(n) {
    if (fag === 'alle' || !n.forkjennskap) return null;
    const v = n.forkjennskap[fag];
    return v === 'nei' ? 'new' : v === 'ja' ? 'rep' : v === 'delvis' ? 'part' : null;
  }
  const badgeText = (kind, ctx) => (kind === 'new' ? `nytt for ${ctx.fagLabel(fag)}` : kind === 'rep' ? 'repetisjon' : 'delvis nytt');

  function clusterCount(ctx, cid) {
    const list = ctx.clusterNodes.get(cid);
    if (cid === 'forkunnskap') {
      const nei = list.filter((n) => n.forkunnskap && n.forkunnskap[fag] === 'nei').length;
      const del = list.filter((n) => n.forkunnskap && n.forkunnskap[fag] === 'delvis').length;
      return { kind: 'fk', nei, del };
    }
    const tagged = list.filter((n) => n.forkjennskap && n.forkjennskap[fag]);
    return {
      kind: 'core', tagged: tagged.length,
      nei: tagged.filter((n) => n.forkjennskap[fag] === 'nei').length,
      del: tagged.filter((n) => n.forkjennskap[fag] === 'delvis').length,
    };
  }

  function fkPills(ctx, n) {
    const { h } = ctx;
    return h('div', { class: 'pills' }, ctx.fagList.map((f) => {
      const v = n.forkunnskap[f] || '?';
      return h('span', { class: 'pill v-' + v }, h('span', { class: 'mono' }, ctx.fagLabel(f)), v);
    }));
  }
  // where a node the subject teaches is new or repetition, per subject
  function forkjennskapPills(ctx, n) {
    const { h } = ctx;
    return h('div', { class: 'pills' }, ctx.fagList.filter((f) => n.forkjennskap[f]).map((f) => {
      const v = n.forkjennskap[f];
      const txt = v === 'nei' ? 'nytt' : v === 'ja' ? 'repetisjon' : v === 'delvis' ? 'delvis nytt' : v;
      return h('span', { class: 'pill ' + (v === 'nei' ? 'v-ny' : v === 'ja' ? 'v-ja' : 'v-delvis') }, h('span', { class: 'mono' }, ctx.fagLabel(f)), txt);
    }));
  }

  fagkart.registerLayer({
    id: 'forkunnskap',
    label: 'Forkunnskap frå',
    priority: 'markering',
    cardSlot: 'top',
    ghostClasses: ['fkok'], // the caption of a greyed forkunnskap node fades with it
    styles: (c, { mix }) => [
      { selector: '.fkok', style: { opacity: 0.55 } },
      { selector: '.hole-delvis', style: { 'background-color': mix(c.warn, c.surface, Math.min(0.4, c.tint * 2.2)), 'border-color': c.warn, 'border-width': 3.5 } },
      { selector: '.hole-nei', style: { 'background-color': mix(c.red, c.surface, Math.min(0.5, c.tint * 2.6)), 'border-color': c.red, 'border-width': 4 } },
    ],
    nodeStyle(n, ctx, el) {
      if (fag === 'alle' || el.grey) return null; // a grey node (another tema, in the tema view) stays grey
      if (ctx.isFk(n)) {
        const v = n.forkunnskap[fag];
        return { classes: v === 'nei' ? 'hole-nei' : v === 'delvis' ? 'hole-delvis' : 'fkok' };
      }
      if (ctx.isKm(n) || el.lvl !== 1) return null;
      const kind = newKind(n);
      return kind ? { badge: { tone: kind, text: badgeText(kind, ctx) } } : null;
    },
    clusterStyle(cid, ctx) {
      if (fag === 'alle') return null;
      const r = clusterCount(ctx, cid);
      if (r.kind === 'fk') {
        return { badge: { tone: r.nei ? 'hole' : 'ok', size: 13, text: r.nei || r.del ? `${r.nei} hol${r.del ? ` · ${r.del} delvis` : ''}` : 'ingen hol' } };
      }
      if (!r.tagged) return null;
      return { badge: { tone: r.nei ? 'new' : 'ok', size: 13,
        text: r.nei || r.del ? (r.del ? `${r.nei} nytt · ${r.del} delvis` : `${r.nei} nytt for ${ctx.fagLabel(fag)}`) : `ingen nye for ${ctx.fagLabel(fag)}` } };
    },
    nodeCard(n, ctx) {
      const { h } = ctx, out = [];
      if (ctx.isFk(n)) out.push(h('h3', null, 'Forkunnskap frå'), fkPills(ctx, n));
      if (n.forkjennskap && ctx.fagList.some((f) => n.forkjennskap[f])) out.push(h('h3', null, 'Nytt eller repetisjon'), forkjennskapPills(ctx, n));
      return out;
    },
    // the forkunnskap a competence goal builds on, through the nodes that serve it
    kmCard(k, ctx) {
      if (!ctx.state.showFk) return null;
      const { h } = ctx;
      const served = ctx.nodes.filter((n) => !ctx.isKm(n) && (n.km || []).includes(k.id));
      const fkIds = ctx.alg.reach(ctx.graph(), served.map((n) => n.id), { through: (id) => !ctx.isFk(ctx.byId.get(id)) })
        .filter((id) => ctx.isFk(ctx.byId.get(id)));
      return ctx.section('Forkunnskap målet byggjer på', fkIds.map((id) => {
        const n = ctx.byId.get(id);
        return h('li', null, h('button', { class: 'linkbtn', onclick: () => ctx.select(id, { center: true }) }, ctx.dotFor(n.type), ctx.rich(n.namn)), fkPills(ctx, n));
      }));
    },
    toolbar(ctx) {
      const seg = $('fagSeg');
      for (const f of ['alle', ...ctx.fagList]) {
        const b = ctx.h('button', { type: 'button', role: 'radio', 'aria-checked': String(f === fag), 'data-fag': f }, f === 'alle' ? 'Alle' : ctx.fagLabel(f));
        b.addEventListener('click', () => { fag = f; ctx.update(); });
        seg.append(b);
      }
      return null;
    },
    status: () => fag, // the raw key: screenshot.mjs and overlays read it
    render(ctx) {
      document.querySelectorAll('#fagSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.fag === fag)));
      // the explanation is not shown under the buttons any more: it is the tooltip of the choice
      const setNote = (text) => { $('fagNote').textContent = text; $('fagSeg').title = text; };
      if (fag === 'alle') {
        setNote(ctx.state.showFk
          ? 'Vel eit fag for å sjå kva forkunnskap elevane manglar og kva som er nytt i faget.'
          : 'Vel eit fag for å sjå kva som er nytt i faget.');
        return;
      }
      const parts = [];
      if (ctx.state.showFk) {
        const fk = ctx.nodes.filter(ctx.isFk);
        const nei = fk.filter((n) => n.forkunnskap[fag] === 'nei').length;
        const del = fk.filter((n) => n.forkunnskap[fag] === 'delvis').length;
        parts.push(`Frå ${ctx.fagLabel(fag)}: ${nei} manglar heilt (raud ramme), ${del} er delvis dekt (gul ramme).`);
      }
      const tagged = ctx.nodes.filter((n) => n.forkjennskap && n.forkjennskap[fag]);
      if (tagged.length) {
        const ny = tagged.filter((n) => n.forkjennskap[fag] === 'nei').length;
        const rep = tagged.filter((n) => n.forkjennskap[fag] === 'ja').length;
        parts.push(`I faget er ${ny} omgrep og metodar nye for ${ctx.fagLabel(fag)} og ${rep} er repetisjon.`);
      }
      if (!parts.length) parts.push(`Forkunnskapen er skjult, så det er ingenting å vise for ${ctx.fagLabel(fag)}.`);
      setNote(parts.join(' '));
    },
  });
})();
