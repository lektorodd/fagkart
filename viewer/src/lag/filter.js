/* Layer "filter": the chips Tema · Type · Kjerneelement. The positions are fixed, so what does not match is faded
   (a tema that has nothing left is dimmed far out). */
(function () {
  'use strict';
  const f = { klynge: new Set(), type: new Set(), kjerne: new Set() };
  const $ = (id) => document.getElementById(id);
  let klyngeKey = null; // the clusters the klynge chips were made for

  const typeOk = (n) => !f.type.size || f.type.has(n.type);
  const kjerneOk = (n) => !f.kjerne.size || (n.kjerneelement || []).some((k) => f.kjerne.has(k));

  function chipGroup(ctx, containerId, key, items, withDot) {
    const box = $(containerId);
    box.replaceChildren();
    for (const [id, label, type] of items) {
      const b = ctx.h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-id': id }, withDot && type ? ctx.dotFor(type) : null, label);
      b.addEventListener('click', () => {
        if (f[key].has(id)) f[key].delete(id); else f[key].add(id);
        ctx.update({ refit: true });
      });
      box.append(b);
    }
  }

  fagkart.registerLayer({
    id: 'filter',
    label: 'Filter',
    priority: 'markering',
    prepare(ctx) {
      if (!ctx.state.showFk) f.klynge.delete('forkunnskap'); // its chip is gone with the tema
    },
    nodeStyle(n, ctx, el) {
      if (ctx.isKm(n) || el.grey) return null;
      return (!f.klynge.size || f.klynge.has(ctx.groupOf(n))) && typeOk(n) && kjerneOk(n) ? null : { fade: true };
    },
    toolbar(ctx) {
      const types = ['omgrep', 'prosedyre', 'forklaring', 'representasjon'].filter((t) => ctx.nodes.some((n) => n.type === t));
      chipGroup(ctx, 'chType', 'type', types.map((t) => [t, ctx.TYPE_LABEL[t], t]), true);
      chipGroup(ctx, 'chKjerne', 'kjerne', (ctx.data.kjerneelement || []).map((k) => [k.id, ctx.lab(k.namn)]));
      $('clearFilters').addEventListener('click', () => { for (const s of Object.values(f)) s.clear(); ctx.update({ refit: true }); });
      return null;
    },
    render(ctx) {
      const clusters = ctx.clusters(), key = clusters.join('|');
      if (key !== klyngeKey) { klyngeKey = key; chipGroup(ctx, 'chKlynge', 'klynge', clusters.map((k) => [k, ctx.klyngeLabel(k)])); }
      for (const [cid, key] of [['chKlynge', 'klynge'], ['chType', 'type'], ['chKjerne', 'kjerne']]) {
        $(cid).querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(f[key].has(b.dataset.id))));
      }
      const nf = f.klynge.size + f.type.size + f.kjerne.size;
      $('clearFilters').hidden = nf === 0;
      $('stFilter').textContent = nf ? `${nf} aktive` : 'ingen';
    },
  });
})();
