/* Layer "koplingar": the switch "Vis andre koplingar". The arrows that are not byggjer_paa (brukar, doeme_paa,
   representerast_som, forvekslast_med) are hidden until it is on; the card lists them either way. The choice is remembered
   per viewer; in host mode (Faglogg) it starts off and is not stored. */
(function () {
  'use strict';
  const KEY = 'fagkart.koplingar';
  const TYPES = new Set(['brukar', 'doeme_paa', 'representerast_som', 'forvekslast_med']);
  const sw = () => document.getElementById('swKopl');
  const load = () => { try { return localStorage.getItem(KEY) === 'pa'; } catch (e) { return false; } }; // storage blocked: off
  const save = (on) => { try { localStorage.setItem(KEY, on ? 'pa' : 'av'); } catch (e) { /* storage blocked: the choice lasts for this visit */ } };

  fagkart.registerLayer({
    id: 'koplingar',
    label: 'Vis andre koplingar',
    priority: 'markering',
    init(ctx) { ctx.state.showKoplingar = ctx.mode !== 'faglogg' && load(); },
    edgeStyle: (e, ctx) => (TYPES.has(e.type) && !ctx.state.showKoplingar ? { hide: true } : null),
    toolbar(ctx) {
      sw().addEventListener('change', () => {
        ctx.state.showKoplingar = sw().checked;
        if (ctx.mode !== 'faglogg') save(ctx.state.showKoplingar);
        ctx.update();
      });
      return null;
    },
    render(ctx) { sw().checked = !!ctx.state.showKoplingar; },
  });
})();
