// The walk-through for students: the first time a student opens a map in the student view, a few areas of the screen are lit up one at a time,
// each with a short text. Skippable, and started again from the help box ("Vis gjennomgangen").
// A plain script (no modules, no libraries): it only uses what app.js exposes (window.__fk.state) and the ids in template.html.
(function () {
  'use strict';
  const KEY = 'fagkart.gjennomgang'; // per page, not per map; the value "ferdig" means done or skipped
  const $ = (id) => document.getElementById(id);
  const STEPS = [
    { id: '#levelBtns', text: 'Kartet har tre nivå: Tema, Kart og Detalj. Zoom inn og ut, eller trykk her for å byte. Trykk på eit tema for å sjå berre det.' },
    { id: '#cy', text: 'Trykk på eit omgrep eller ein metode for å få forklaring og sjå kva det byggjer på.' },
    { id: '#evBtn', text: 'Slå på for å markere kva du kan. Kartet blir farga etter markeringane dine. Dei ligg berre i denne nettlesaren, så lagre ei kopi no og då.' },
    { id: '#moreBtn', text: 'Her finn du neste steg, løyper å følgje, og «Last ned» så du ikkje mistar markeringane.' },
    { id: '#q', text: 'Skriv eit ord her for å finne eit omgrep eller ein metode.' },
  ];

  const isHost = () => { try { const q = new URLSearchParams(location.search).get('vising'); return q != null && q.trim().toLowerCase() === 'faglogg'; } catch (e) { return false; } };
  const isStudent = () => !isHost() && !!(window.__fk && window.__fk.state && window.__fk.state.elev);
  let doneThisSession = false; // storage blocked: still do not nag again in this visit
  function isDone() {
    if (doneThisSession) return true;
    try { if (localStorage.getItem(KEY) === 'ferdig') return true; } catch (e) { /* storage blocked */ }
    try { if (sessionStorage.getItem(KEY) === 'ferdig') return true; } catch (e) { /* storage blocked */ }
    return false;
  }
  function markDone() {
    doneThisSession = true;
    try { localStorage.setItem(KEY, 'ferdig'); } catch (e) { try { sessionStorage.setItem(KEY, 'ferdig'); } catch (e2) { /* nothing to do: the flag above holds for this visit */ } }
  }
  // An element that is hidden (the attribute, or display:none somewhere above) has no box
  function visibleTarget(sel) {
    const el = document.querySelector(sel);
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? el : null;
  }

  let ui = null; // { root, steps, i, back, spot, bubble } while the walk-through is open

  function start() {
    if (ui || !isStudent()) return;
    const steps = STEPS.filter((s) => visibleTarget(s.id));
    if (!steps.length) return;
    const back = document.activeElement;
    const root = document.createElement('div');
    root.className = 'fktour';
    root.innerHTML = '<div class="fktour-block"></div><div class="fktour-spot"></div>'
      + '<div class="fktour-bubble" role="dialog" aria-modal="true" aria-label="Gjennomgang" aria-describedby="fktourText">'
      + '<p class="fktour-text" id="fktourText"></p>'
      + '<div class="fktour-foot"><span class="fktour-count" id="fktourCount"></span>'
      + '<span class="fktour-btns"><button type="button" class="btn" data-t="skip">Hopp over</button><button type="button" class="btn" data-t="prev">Førre</button><button type="button" class="btn primary" data-t="next">Neste</button></span></div>'
      + '</div>';
    document.body.append(root);
    ui = { root, steps, i: 0, back, spot: root.querySelector('.fktour-spot'), bubble: root.querySelector('.fktour-bubble') };
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]');
      if (!t) return;
      if (t.dataset.t === 'skip') finish();
      else if (t.dataset.t === 'prev') go(ui.i - 1);
      else go(ui.i + 1);
    });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    go(0);
  }

  function go(i) {
    if (!ui || i < 0) return;
    if (i >= ui.steps.length) { finish(); return; }
    ui.i = i;
    const last = i === ui.steps.length - 1;
    ui.root.querySelector('#fktourText').textContent = ui.steps[i].text;
    ui.root.querySelector('#fktourCount').textContent = `${i + 1} av ${ui.steps.length}`;
    ui.root.querySelector('[data-t="prev"]').hidden = i === 0;
    const next = ui.root.querySelector('[data-t="next"]');
    next.textContent = last ? 'Ferdig' : 'Neste';
    ui.root.querySelector('[data-t="skip"]').hidden = last;
    place();
    next.focus({ preventScroll: true });
  }

  // The spot goes around the element; the bubble goes below, above, right or left of it, whichever fits first without covering it.
  // A big element (the map) cannot be left uncovered: then the bubble sits at the bottom of it.
  function place() {
    if (!ui) return;
    const el = visibleTarget(ui.steps[ui.i].id);
    if (!el) { go(ui.i + 1); return; }
    const pad = 4, gap = 12, m = 8;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    const box = { l: Math.max(0, r.left - pad), t: Math.max(0, r.top - pad), r: Math.min(vw, r.right + pad), b: Math.min(vh, r.bottom + pad) };
    Object.assign(ui.spot.style, { left: box.l + 'px', top: box.t + 'px', width: box.r - box.l + 'px', height: box.b - box.t + 'px' });
    const b = ui.bubble;
    b.style.maxWidth = Math.min(340, vw - 2 * m) + 'px';
    b.style.left = '0px'; b.style.top = '0px';
    const bw = b.offsetWidth, bh = b.offsetHeight;
    const clampX = (x) => Math.max(m, Math.min(x, vw - bw - m));
    const clampY = (y) => Math.max(m, Math.min(y, vh - bh - m));
    const cy = clampY((box.t + box.b) / 2 - bh / 2);
    const tries = [
      [clampX(box.l), box.b + gap, box.b + gap + bh <= vh - m], // below
      [clampX(box.l), box.t - gap - bh, box.t - gap - bh >= m], // above
      [box.r + gap, cy, box.r + gap + bw <= vw - m], // right
      [box.l - gap - bw, cy, box.l - gap - bw >= m], // left
    ];
    const hit = tries.find((t) => t[2]);
    const pos = hit ? [hit[0], hit[1]] : [clampX((box.l + box.r) / 2 - bw / 2), vh - bh - m];
    b.style.left = pos[0] + 'px';
    b.style.top = pos[1] + 'px';
  }

  function onKey(e) {
    if (!ui) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); go(ui.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); go(ui.i - 1); }
    else if (e.key === 'Tab') { // keep the focus on the buttons of the bubble
      const bs = [...ui.bubble.querySelectorAll('button:not([hidden])')];
      const k = bs.indexOf(document.activeElement);
      e.preventDefault();
      bs[(k + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
    }
  }

  function finish() {
    if (!ui) return;
    const { root, back } = ui;
    ui = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    root.remove();
    markDone();
    const to = back && back !== document.body && document.contains(back) ? back : $('helpBtn');
    if (to) to.focus({ preventScroll: true });
  }

  function init() {
    // The button in the help box: only for students (the help box is the same page in the teacher view)
    const btn = $('tourBtn');
    if (btn) {
      btn.hidden = !isStudent();
      btn.addEventListener('click', () => { $('helpBox').hidden = true; $('helpBtn').setAttribute('aria-expanded', 'false'); start(); });
      $('helpBtn').addEventListener('click', () => { btn.hidden = !isStudent(); });
    }
    window.__tour = { start, finish, get open() { return !!ui; } };
    if (isStudent() && !isDone()) setTimeout(() => { if (!isDone()) start(); }, 350);
  }

  if (document.documentElement.dataset.ready === '1') init();
  else {
    const mo = new MutationObserver(() => { if (document.documentElement.dataset.ready === '1') { mo.disconnect(); init(); } });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ready'] });
  }
})();
