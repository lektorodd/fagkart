/* Layer "implisitte": the switch "Vis implisitte piler". Implied byggjer_paa edges (they follow from a longer chain)
   are hidden until it is on; while it is on, the graph (links in the card, filters) counts them too. */
(function () {
  'use strict';
  const sw = () => document.getElementById('swImpl');

  fagkart.registerLayer({
    id: 'implisitte',
    label: 'Vis implisitte piler',
    priority: 'markering',
    edgeStyle: (e, ctx) => (e.implisitt && !ctx.state.showImplicit ? { hide: true } : null),
    toolbar(ctx) {
      sw().addEventListener('change', () => { ctx.state.showImplicit = sw().checked; ctx.update(); });
      return null;
    },
  });
})();
