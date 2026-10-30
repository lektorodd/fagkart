// Updates of a published map: registers the service worker (sw.js, offline after the first visit) and tells the reader when a newer version is out.
//  - Hosted (http/https): reads ./<KODE>.versjon.json; a newer version gives a strip at the top: "Last på nytt" asks the service worker for a fresh copy and reloads;
//    "Kva er nytt" does the same and leaves a mark so the new page opens the help box with the version log.
//  - A downloaded copy (file://): only when the address is set (publisering.json, baked in by build.mjs); the strip then links to the hosted map.
// A plain script (no modules, no libraries). All failures are silent, and the only thing sent is the request for the version file (no query string, no data).
(function () {
  'use strict';
  const ADRESSE = /*__ADRESSE__*/ ''; // the web address of this map's folder with a closing slash (…/s2/), or '' when it is not decided
  const HOUR = 60 * 60 * 1000;
  const root = document.documentElement;

  const isHost = () => { try { const q = new URLSearchParams(location.search).get('vising'); return q != null && q.trim().toLowerCase() === 'faglogg'; } catch (e) { return false; } };
  const hosted = location.protocol === 'http:' || location.protocol === 'https:';
  if (isHost() || !(hosted || (location.protocol === 'file:' && ADRESSE))) return;

  let KODE, OWN;
  try {
    const d = JSON.parse(document.getElementById('fagkart-data').textContent);
    KODE = d.kode || d.laereplan;
    OWN = String(d.versjon == null ? '?' : d.versjon);
  } catch (e) { return; }
  const KEY_CHECK = `fagkart.${KODE}.versjonsjekk`; // when the version file was last read
  const KEY_NEW = `fagkart.${KODE}.nyversjon`; // the newer version found then, so the strip comes back on a reload that still gives the old copy
  const KEY_LATER = `fagkart.${KODE}.oppdatering.seinare`; // sessionStorage: "Seinare"
  let later = false;

  const get = (st, k) => { try { return window[st].getItem(k); } catch (e) { return null; } };
  const set = (st, k, v) => { try { window[st].setItem(k, v); } catch (e) { /* storage blocked: nothing to do */ } };

  // Compare number by number ("2026.10" is newer than "2026.2"); a version that cannot be read is newer when it is different
  function isNewer(v, own) {
    if (v === own) return false;
    const a = v.split('.'), b = own.split('.');
    const num = (p) => /^\d+$/.test(p);
    if (!a.every(num) || !b.every(num)) return true;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = Number(a[i] || 0), y = Number(b[i] || 0);
      if (x !== y) return x > y;
    }
    return false;
  }

  function show(version) {
    const el = document.getElementById('oppdatering');
    if (!el || later || get('sessionStorage', KEY_LATER) === '1') return;
    el.textContent = '';
    const text = document.createElement('span');
    text.textContent = `Ny versjon av kartet (${version}).` + (hosted ? ' Last sida på nytt.' : '');
    el.append(text);
    if (hosted) {
      const reload = document.createElement('button');
      reload.type = 'button'; reload.className = 'btn primary'; reload.textContent = 'Last på nytt';
      reload.addEventListener('click', reloadFresh);
      el.append(reload);
      // the same, and the new page opens the help box at "Kva er nytt" (app.js reads the mark and removes it)
      const news = document.createElement('button');
      news.type = 'button'; news.className = 'btn'; news.textContent = 'Kva er nytt';
      news.addEventListener('click', () => { set('sessionStorage', 'fagkart.nytt', '1'); reloadFresh(); });
      el.append(news);
    } else {
      // the hosted map is the new version, and it works offline after one visit; a file to save is one "Lagre som" away
      const a = document.createElement('a');
      a.className = 'btn primary'; a.textContent = 'Opne ny versjon';
      a.href = ADRESSE;
      el.append(a);
    }
    const skip = document.createElement('button');
    skip.type = 'button'; skip.className = 'btn'; skip.textContent = 'Seinare';
    skip.addEventListener('click', () => { later = true; set('sessionStorage', KEY_LATER, '1'); el.hidden = true; });
    el.append(skip);
    el.hidden = false;
  }

  // Ask the service worker for a fresh copy of this page, then reload (after 3 s whatever happens)
  function reloadFresh() {
    let done = false;
    const go = () => { if (!done) { done = true; location.reload(); } };
    setTimeout(go, 3000);
    if (!('serviceWorker' in navigator)) return go();
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'fagkart:oppdatert') go(); });
    navigator.serviceWorker.ready
      .then((reg) => reg.active.postMessage({ type: 'fagkart:oppdater', url: location.href }))
      .catch(go);
  }

  function check() {
    const known = get('localStorage', KEY_NEW);
    if (known && isNewer(known, OWN)) show(known);
    const last = Number(get('localStorage', KEY_CHECK));
    const age = Date.now() - last;
    if (last && age >= 0 && age < HOUR) return;
    if (navigator.onLine === false) return; // offline: no request, and no error in the console
    const url = hosted ? new URL(`${KODE}.versjon.json`, location.href).href : `${ADRESSE}${KODE}.versjon.json`;
    fetch(url, { cache: 'no-store', credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || typeof j.versjon !== 'string' || (j.kart && j.kart !== KODE)) return;
        set('localStorage', KEY_CHECK, String(Date.now()));
        if (isNewer(j.versjon, OWN)) { set('localStorage', KEY_NEW, j.versjon); show(j.versjon); }
        else { try { localStorage.removeItem(KEY_NEW); } catch (e) { /* storage blocked */ } }
      })
      .catch(() => {});
  }

  function register() {
    if (!hosted || !('serviceWorker' in navigator)) return;
    const controlled = !!navigator.serviceWorker.controller; // read before the worker takes over this page
    navigator.serviceWorker.register('./sw.js')
      // The first visit was not served by the worker: have it keep this page now, so the next visit works offline
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => { if (!controlled && reg.active) reg.active.postMessage({ type: 'fagkart:oppdater', url: location.href }); })
      .catch(() => {});
  }

  function init() { register(); check(); }
  if (root.dataset.ready === '1') init();
  else {
    const mo = new MutationObserver(() => { if (root.dataset.ready === '1') { mo.disconnect(); init(); } });
    mo.observe(root, { attributes: true, attributeFilter: ['data-ready'] });
  }
})();
