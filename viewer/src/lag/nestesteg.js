/* Layer "nestesteg" ("Neste steg"): what the student can learn now ("klar til å lære") and the weak points ("svake punkt"),
   worked out from the marks of the layer "eigenvurdering" (read with ctx.layer('eigenvurdering').marks()). Student view only; it stores nothing.
   An unmarked node is unknown, not "ikkje": a forkunnskap node without a mark counts as known,
   a node of the subject without a mark counts as not mastered yet but is never called a weak point.
   The answer is the same with and without "Vis implisitte piler": an implied edge only repeats a longer chain, so the rules read
   the direct prerequisites of the reduced graph (a prerequisite that another prerequisite already builds on is left out).
   plan(ctx) is public (layer.plan) so the rules can be tested in Node. */
(function () {
  'use strict';

  const SHOW_FIRST = 8; // entries per list before "Vis fleire"
  const LIMITED = new Set(['ikkje', 'delvis']);

  let ctxRef = null;
  let show = false; // the switch "Vis på kartet"
  const more = { ready: false, weak: false }; // "Vis fleire" per list
  let ui = null;
  let cache = null; // { key, plan }

  // ---------- The rules (no DOM) ----------
  // The graph the rules read: the same nodes, but each node only has the prerequisites no other prerequisite of it builds on
  function reduced(alg, g) {
    const memo = new Map();
    const prereqs = (id) => {
      if (memo.has(id)) return memo.get(id);
      const ps = [...new Set(g.prereqs(id))].filter((p) => p !== id);
      const covered = new Set();
      for (const p of ps) for (const q of alg.reach(g, [p])) if (q !== p) covered.add(q);
      const out = ps.filter((p) => !covered.has(p));
      memo.set(id, out);
      return out;
    };
    return { ...g, prereqs };
  }

  // The marks of the student, read from the layer "eigenvurdering" (nothing when it is not there)
  function readMarks(ctx) {
    const ev = ctx.layer('eigenvurdering');
    return ev && typeof ev.marks === 'function' ? ev.marks() : {};
  }

  // { ready: ids in learning order, weak: [{ id, mark, count }] most builds-on first, unassessed: number, marked: number,
  //   missing(id): the direct prerequisites that are not mastered, mastered(id) }
  function plan(ctx) {
    const marks = readMarks(ctx);
    const key = JSON.stringify(marks) + '|' + !!ctx.state.showImplicit + '|' + !!ctx.state.showFk;
    if (cache && cache.key === key && cache.ctx === ctx) return cache.plan;

    const { alg } = ctx;
    const g0 = ctx.graph(), g = reduced(alg, g0);
    const inMap = ctx.nodes.filter((n) => !ctx.isKm(n));
    const subject = inMap.filter((n) => !ctx.isFk(n));
    const inSubject = new Set(subject.map((n) => n.id));
    const order = new Map(alg.topoOrder(g, inMap.map((n) => n.id)).map((id, i) => [id, i]));
    const byOrder = (a, b) => order.get(a) - order.get(b);

    // forkunnskap without a mark is known; everything else is what the student said (or nothing)
    const eff = new Map();
    for (const n of inMap) {
      const v = marks[n.id];
      if (v) eff.set(n.id, v); else if (ctx.isFk(n)) eff.set(n.id, 'heilt');
    }
    const mastered = (id) => eff.get(id) === 'heilt';

    const ready = alg.readyToLearn(g, eff, subject.map((n) => n.id)).sort(byOrder);
    const weak = inMap
      .filter((n) => LIMITED.has(marks[n.id]) && (ctx.state.showFk || !ctx.isFk(n)))
      .map((n) => ({ id: n.id, mark: marks[n.id], count: alg.reach(g0, [n.id], { dir: 'post' }).filter((d) => inSubject.has(d)).length }))
      .sort((a, b) => b.count - a.count || byOrder(a.id, b.id));
    const result = {
      ready,
      weak,
      unassessed: subject.filter((n) => !marks[n.id]).length,
      marked: inMap.filter((n) => marks[n.id]).length,
      mastered,
      missing: (id) => g.prereqs(id).filter((p) => !mastered(p)),
    };
    cache = { key, ctx, plan: result };
    return result;
  }

  // ---------- Views ----------
  const nPrereq = (k) => `${k} ${k === 1 ? 'føresetnad' : 'føresetnader'}`;
  const buildsOn = (k) => (k === 0 ? 'Ingen omgrep byggjer på dette' : `${k} omgrep byggjer på dette`);

  function listBlock(ctx, key, title, items, text, empty) {
    const { h } = ctx;
    const open = more[key], shown = open ? items : items.slice(0, SHOW_FIRST);
    const kids = [h('h3', { class: 'ns-h' }, title)];
    if (!items.length) {
      kids.push(h('p', { class: 'note' }, empty));
    } else {
      kids.push(h('ul', { class: 'links ns-list', 'data-ns-list': key }, shown.map((it) => {
        const li = ctx.nodeLink(it.id);
        const t = text(it);
        if (t) li.append(h('span', { class: 'ns-n' }, t));
        return li;
      })));
      if (items.length > SHOW_FIRST) {
        const b = h('button', { type: 'button', class: 'btn ns-more', 'aria-expanded': String(open), 'data-ns-more': key }, open ? 'Vis færre' : `Vis fleire (${items.length - SHOW_FIRST})`);
        b.addEventListener('click', () => { more[key] = !more[key]; ctxRef.update(); });
        kids.push(b);
      }
    }
    return h('div', { class: 'ns-block' }, kids);
  }

  function buildSection(ctx) {
    const { h } = ctx;
    const input = h('input', { type: 'checkbox', 'data-ns-show': '' });
    input.addEventListener('change', () => { show = input.checked; ctxRef.update(); });
    ui = {
      input,
      intro: h('p', { class: 'note' }),
      lists: h('div', { class: 'ns-lists' }),
      rest: h('p', { class: 'note ns-rest' }),
    };
    return h('div', { class: 'ev-sec ns-sec' }, ui.intro, ui.lists, ui.rest,
      h('label', { class: 'switch', title: 'Klare omgrep får merket «klar», svake punkt får merket «svakt», og resten tonar ut.' }, input, h('span', { class: 'tr' }), h('span', null, 'Vis på kartet')));
  }

  function renderSection(ctx) {
    if (!ui) return;
    const p = plan(ctx);
    ui.input.checked = show;
    const start = !p.marked;
    ui.intro.hidden = !start;
    ui.intro.textContent = start ? 'Slå på «Kva kan eg?» og marker nokre omgrep (ikkje enno · delvis · godt), så får du forslag her.' : '';
    const blocks = [
      listBlock(ctx, 'ready', start ? 'Startpunkt' : 'Klar til å lære', p.ready.map((id) => ({ id })), () => '',
        start ? 'Ingen startpunkt.' : 'Ingenting er klart akkurat no.'),
    ];
    if (!start) {
      blocks.push(listBlock(ctx, 'weak', 'Svake punkt', p.weak, (it) => buildsOn(it.count),
        'Ingen svake punkt: du har ikkje markert noko som «ikkje enno» eller «delvis».'));
    }
    ui.lists.replaceChildren(...blocks);
    ui.rest.textContent = p.unassessed === 1 ? '1 omgrep eller metode i faget er ikkje markert enno.' : p.unassessed ? `${p.unassessed} omgrep og metodar i faget er ikkje markerte enno.` : 'Alt er markert.';
  }

  fagkart.registerLayer({
    id: 'nestesteg',
    label: 'Neste steg',
    modes: ['elev'],
    priority: 'markering',
    cardSlot: 'bottom',
    plan,
    init(ctx) { ctxRef = ctx; },
    nodeStyle(n, ctx, el) {
      if (!show || el.grey || ctx.isKm(n)) return null;
      const p = plan(ctx);
      if (p.ready.includes(n.id)) return { badge: { tone: 'new', text: 'klar' } };
      if (p.weak.some((w) => w.id === n.id)) return { badge: { tone: 'hole', text: 'svakt' } };
      return { fade: true };
    },
    nodeCard(n, ctx) {
      if (ctx.isKm(n) || ctx.isFk(n)) return null;
      const p = plan(ctx);
      if (p.mastered(n.id)) return null;
      const { h } = ctx, miss = p.missing(n.id);
      if (!miss.length) return h('p', { class: 'ns-card ns-ok' }, 'Du har det du treng for å lære dette');
      return h('details', { class: 'ns-card ns-miss' }, h('summary', null, `Manglar: ${nPrereq(miss.length)}`), h('ul', { class: 'links' }, miss.map((id) => ctx.nodeLink(id))));
    },
    toolbar: (ctx) => buildSection(ctx),
    render: (ctx) => renderSection(ctx),
    status: (ctx) => {
      if (!show) return '';
      const k = plan(ctx).ready.length;
      return k === 1 ? '1 klar' : `${k} klare`;
    },
  });
})();
