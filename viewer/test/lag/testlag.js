/* Test layer (docs/ARKITEKTUR.md § Lag-API): colours every procedure and adds a section to the card that lists
   what you must know first, in learning order. Uses only fagkart.registerLayer; build with --lag=test/lag/testlag.js. */
fagkart.registerLayer({
  id: 'testlag',
  label: 'Testlag',
  priority: 'markering',
  nodeStyle: (n) => (n.type === 'prosedyre' ? { fill: '#ffe08a', ring: '#c98a00' } : null),
  nodeCard(n, ctx) {
    const chain = ctx.alg.prerequisiteChain(ctx.graph(), n.id).map((id) => ctx.byId.get(id));
    return ctx.h('section', { class: 'testlag' },
      ctx.h('h3', null, 'Lær først (testlag)'),
      chain.length ? ctx.h('ol', null, chain.map((m) => ctx.h('li', null, ctx.rich(m.namn)))) : ctx.h('p', { class: 'empty' }, 'Ingenting.'));
  },
  toolbar: (ctx) => ctx.h('p', { class: 'note' }, 'Prosedyrane er gule.'),
});
