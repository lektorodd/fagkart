/* Layer "eigenvurdering" ("Kva kan eg?"): the student marks each concept or method as ikkje / delvis / heilt.
   The marks are an overlay (fagkart-overlegg/1, type "eigenvurdering", see docs/FORMAT.md § Overleggsformat): an object that lives in
   localStorage under fagkart.<KODE>.eigenvurdering and is the very same object "Last ned" writes to a file and "Opne fil" reads back.
   Privacy: no name fields (the overlay is always called "Mi eigenvurdering"), no network, nothing in the URL. Student view only.
   An unmarked node is unknown, not "ikkje". Marks on ids the map does not have (a new map version) are kept, counted as orphans
   and written back on download, never deleted.
   The button "Kva kan eg?" in the top bar (ctx.state.ev, set by the core) turns the layer's view on and off: on, the core draws the map as line
   work and the marks are the only colours; off, the plain map with no colours, buttons or counts of ours. The marks and the section in
   "Fleire val" stay either way, and other layers (nestesteg, stiar) read the marks either way. */
(function () {
  'use strict';

  const FORMAT = 'fagkart-overlegg/1';
  const NAME = 'Mi eigenvurdering'; // fixed on purpose: the file never carries a name
  const SCALE = ['ikkje', 'delvis', 'heilt'];
  const LABEL = { ikkje: 'Ikkje enno', delvis: 'Delvis', heilt: 'Godt' }; // read as "Eg kan dette …"; the stored values stay ikkje / delvis / heilt
  const NODE_ID = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/; // same as nodeId in schema/overlegg.schema.json
  const STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$/; // ISO 8601 with a zone
  const BACKUP = '.defekt';
  const BROKEN = 'Lagra markeringar kunne ikkje lesast. Den lagra teksten er teken vare på i nettlesaren, og du kan byrje på nytt.';
  const BLOCKED = 'Markeringane blir ikkje lagra i denne nettlesaren. Last ned fila før du lukkar sida.';
  const STORED = 'Markeringane ligg berre i denne nettlesaren. Slettar du nettlesardata, forsvinn dei. Lagre ei kopi no og då.';
  const STORED_SHORT = 'Markeringane ligg berre i denne nettlesaren.';
  const REMIND_AT = 10, REMIND_DAYS = 7; // a reminder to save a copy: 10 marks or more, and never saved, 10 more since, or 7 days since

  let kode = '', version = '', key = '', copyKey = '';
  let copy = null; // the last saved copy: { naar: ISO stamp, tal: marks then }, kept under fagkart.<KODE>.evkopi (never in the file)
  let ov = null; // the overlay object
  let broken = false; // the stored text could not be read: it is kept under the backup key and the section says so
  let canStore = true; // false once a read or a write of localStorage has failed: the marks live in memory only
  let pending = null; // an action waiting for a yes: { kind: 'clear' } or { kind: 'replace', next, notes }
  let msg = null; // { tone: 'ok' | 'err', text }: the answer to the last action in "Fleire val"
  let ui = null; // the elements of the section in "Fleire val"
  let ctxRef = null;

  const on = (ctx) => !!ctx.state.ev;
  const pad = (n) => String(n).padStart(2, '0');
  // local time with the offset, e.g. 2026-10-23T14:02:00+02:00
  function stampNow() {
    const d = new Date(), off = -d.getTimezoneOffset(), a = Math.abs(off);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  function stampText(s) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} kl. ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  }
  const isMark = (v) => typeof v === 'string' && SCALE.includes(v);
  const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

  const fresh = () => ({ format: FORMAT, kart: kode, kartversjon: version, namn: NAME, type: 'eigenvurdering', skala: SCALE.slice(), merke: {} });
  // The overlay as it is stored and downloaded: the fixed fields in a fixed order, then `oppdatert` when it has been changed
  function snapshot() {
    const o = { format: FORMAT, kart: kode, kartversjon: ov.kartversjon, namn: NAME, type: 'eigenvurdering', skala: SCALE.slice(), merke: { ...ov.merke } };
    if (ov.oppdatert) o.oppdatert = ov.oppdatert;
    return o;
  }

  // ---------- Storage (every access may throw: private window, blocked site data, iframe) ----------
  // What is stored now: { status: 'none' | 'ok' | 'bad' | 'blocked', overlay, raw }
  function readStored() {
    let raw;
    try { raw = localStorage.getItem(key); } catch (e) { return { status: 'blocked' }; }
    if (raw == null) return { status: 'none' };
    try {
      const r = readOverlay(JSON.parse(raw));
      if (r.overlay) return { status: 'ok', overlay: r.overlay };
    } catch (e) { /* not JSON: bad */ }
    return { status: 'bad', raw };
  }
  // A stored text that cannot be read is never written over without a trace: it stays untouched under <key>.defekt (the first one is kept)
  function keepBroken(raw) {
    broken = true;
    try { if (localStorage.getItem(key + BACKUP) == null) localStorage.setItem(key + BACKUP, raw); } catch (e) { /* storage blocked or full: nothing more to do */ }
  }
  // Before the map code existed, a map was stored under the curriculum code (S2 under MAT04-02), which S1 shares. Once, when the
  // key of the map code is empty and the old one is not: copy the marks of this map's nodes (id prefix <kode>/) to the new key as an overlay for
  // this map. The old key stays, since another map of the same curriculum may still read it. Nothing is copied when no mark is left.
  function migrateOldKey(laereplan) {
    if (!laereplan || laereplan === kode) return;
    try {
      if (localStorage.getItem(key) != null) return;
      const raw = localStorage.getItem(`fagkart.${laereplan}.eigenvurdering`);
      if (raw == null) return;
      const o = JSON.parse(raw);
      if (!isPlainObject(o) || o.format !== FORMAT || o.kart !== laereplan || !isPlainObject(o.merke)) return;
      const merke = {};
      for (const [id, v] of Object.entries(o.merke)) if (id.startsWith(`${kode}/`)) merke[id] = v;
      if (!Object.keys(merke).length) return;
      localStorage.setItem(key, JSON.stringify({ ...o, kart: kode, merke }));
    } catch (e) { /* storage blocked or unreadable: no migration */ }
  }
  function load() {
    migrateOldKey(ctxRef && ctxRef.data.laereplan);
    const s = readStored();
    if (s.status === 'blocked') canStore = false;
    if (s.status === 'bad') keepBroken(s.raw);
    return s.status === 'ok' ? s.overlay : fresh();
  }
  // Another tab (the iframe in itslearning and a tab of its own) may have written since this page read: take in what is stored
  // before a change is written, and when the storage event says so, so the marks of the other tab are not lost. True when taken in.
  function sync() {
    const s = readStored();
    if (s.status === 'bad') keepBroken(s.raw);
    if (s.status !== 'ok') return false;
    ov = s.overlay;
    return true;
  }
  function save() {
    try { localStorage.setItem(key, JSON.stringify(snapshot())); canStore = true; } catch (e) { canStore = false; }
  }
  // A change of the marks: stamp, keep, redraw
  function changed() {
    ov.kartversjon = version;
    ov.oppdatert = stampNow();
    save();
    ctxRef.update();
  }

  // Check an overlay (from a file or from storage). Returns { overlay, notes } or { error }.
  // Unknown values and ids that are no node ids are dropped (notes say how many); ids the map does not have are kept.
  function readOverlay(o) {
    if (!isPlainObject(o) || o.format !== FORMAT) return { error: 'Dette er ikkje ei fil med eigenvurdering frå Fagkart.' };
    if (o.type != null && o.type !== 'eigenvurdering') return { error: `Fila har type «${String(o.type)}», ikkje eigenvurdering.` };
    if (o.kart !== kode) return { error: `Fila er laga for kartet «${String(o.kart)}», ikkje for «${kode}». Ingenting er endra.` };
    if (!Array.isArray(o.skala) || o.skala.length !== SCALE.length || o.skala.some((v, i) => v !== SCALE[i])) return { error: 'Fila har ei anna skala enn den Fagkart brukar. Ingenting er endra.' };
    if (!isPlainObject(o.merke)) return { error: 'Fila har ingen gyldige markeringar (merke manglar eller har feil form). Ingenting er endra.' };
    const merke = {};
    let dropped = 0;
    for (const [id, v] of Object.entries(o.merke)) {
      if (NODE_ID.test(id) && isMark(v)) merke[id] = v; else dropped++;
    }
    const overlay = { ...fresh(), merke, kartversjon: typeof o.kartversjon === 'string' && o.kartversjon ? o.kartversjon : version };
    if (typeof o.oppdatert === 'string' && STAMP.test(o.oppdatert)) overlay.oppdatert = o.oppdatert;
    return { overlay, notes: dropped ? [`${dropped} ${dropped === 1 ? 'markering' : 'markeringar'} med ukjend verdi eller ID vart forkasta.`] : [] };
  }

  // ---------- Counting ----------
  // The nodes the student can mark and that are in the map now (forkunnskap only while it is shown)
  const scope = (ctx) => ctx.nodes.filter((n) => !ctx.isKm(n) && (ctx.state.showFk || !ctx.isFk(n)));
  function tally(list) {
    const t = { ikkje: 0, delvis: 0, heilt: 0, total: list.length };
    for (const n of list) { const v = ov.merke[n.id]; if (v) t[v]++; }
    t.marked = t.ikkje + t.delvis + t.heilt;
    t.none = t.total - t.marked;
    return t;
  }
  // Ids with a mark that the map has no node for: another map version, or a node that has gone out
  const orphans = (ctx) => Object.keys(ov.merke).filter((id) => !ctx.byId.has(id) || ctx.isKm(ctx.byId.get(id)));
  const nMarks = () => Object.keys(ov.merke).length;

  // ---------- Actions ----------
  function setMark(ctx, id, v) {
    sync(); // the marks of another tab first, then this one on top of them
    pending = null; msg = null;
    if (ov.merke[id] === v) delete ov.merke[id]; else ov.merke[id] = v; // the same button once more takes the mark away
    changed();
  }
  function clearAll() {
    pending = null;
    ov.merke = {};
    msg = { tone: 'ok', text: 'Alle markeringar er tømde.' };
    changed();
  }
  function applyFile(next, notes) {
    pending = null;
    ov = next;
    save();
    const extra = [];
    if (ov.kartversjon !== version) extra.push(`Fila er laga for versjon ${ov.kartversjon} av kartet.`);
    msg = { tone: 'ok', text: ['Fila er opna.', ...notes, ...extra].join(' ') };
    ctxRef.update();
  }
  async function openFile(file) {
    msg = null; pending = null;
    let text;
    try { text = await file.text(); } catch (e) { msg = { tone: 'err', text: 'Klarte ikkje lese fila.' }; ctxRef.update(); return; }
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { msg = { tone: 'err', text: 'Fila er ikkje gyldig JSON.' }; ctxRef.update(); return; }
    const r = readOverlay(parsed);
    if (r.error) { msg = { tone: 'err', text: r.error }; ctxRef.update(); return; }
    if (nMarks()) { pending = { kind: 'replace', next: r.overlay, notes: r.notes }; ctxRef.update(); return; } // the student has marks here: ask first
    applyFile(r.overlay, r.notes);
  }
  function download() {
    msg = null; pending = null;
    const d = new Date();
    const name = `eigenvurdering-${kode}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    msg = { tone: 'ok', text: `Lagra ${name}.` };
    copy = { naar: stampNow(), tal: nMarks() };
    try { localStorage.setItem(copyKey, JSON.stringify(copy)); } catch (e) { /* storage blocked: the reminder comes back next visit */ }
    ctxRef.update();
  }
  function loadCopy() {
    try { const o = JSON.parse(localStorage.getItem(copyKey) || 'null'); return isPlainObject(o) && typeof o.naar === 'string' ? o : null; } catch (e) { return null; }
  }
  // Time to remind about a copy: 10 marks or more, and never saved, 10 or more marks since the last copy, or the copy is over 7 days old
  function copyDue() {
    const n = nMarks();
    if (n < REMIND_AT) return false;
    if (!copy) return true;
    if (n - (copy.tal || 0) >= REMIND_AT) return true;
    const t = new Date(copy.naar).getTime();
    return Number.isNaN(t) || Date.now() - t > REMIND_DAYS * 86400000;
  }
  function remindLine(ctx) {
    const { h } = ctx, b = h('button', { type: 'button', class: 'btn small', 'data-ev-act': 'kopi' }, 'Lagre kopi');
    b.addEventListener('click', download);
    return h('p', { class: 'ev-remind', role: 'status' }, `Du har ${nMarks()} markeringar som berre ligg i denne nettlesaren. `, b);
  }

  // ---------- Views ----------
  function cardButtons(ctx, n) {
    const { h } = ctx, cur = ov.merke[n.id] || null;
    const group = h('div', { class: 'ev-seg', role: 'radiogroup', 'aria-label': 'Eg kan dette' }, SCALE.map((v) => {
      const b = h('button', { type: 'button', role: 'radio', class: 'ev-btn ev-' + v, 'data-ev': v, 'aria-checked': String(cur === v) }, LABEL[v]);
      b.addEventListener('click', () => {
        setMark(ctx, n.id, v);
        const again = document.querySelector(`#panel [data-ev="${v}"]`); // the card is drawn anew: keep the focus where it was
        if (again && document.activeElement !== again) again.focus({ preventScroll: true });
      });
      return b;
    }));
    const total = nMarks();
    return h('div', { class: 'ev-card' }, h('span', { class: 'ev-lbl' }, 'Eg kan dette …'), group,
      canStore ? null : h('p', { class: 'ev-warn', role: 'status' }, BLOCKED),
      canStore && copyDue() ? remindLine(ctx) : canStore && total > 0 && total < REMIND_AT ? h('p', { class: 'ev-note' }, STORED_SHORT) : null);
  }
  const countLine = (t) => `${t.heilt} av ${t.total} kan eg godt`;

  function buildSection(ctx) {
    const { h } = ctx;
    const counts = h('ul', { class: 'ev-counts', 'aria-label': 'Kor mange du har markert' });
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Vel fil med eigenvurdering', 'data-ev-file': '' });
    input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) openFile(f); });
    const btn = (text, fn, extra) => { const b = h('button', { type: 'button', class: 'btn', ...(extra || {}) }, text); b.addEventListener('click', fn); return b; };
    ui = {
      counts, input,
      stamp: h('p', { class: 'note ev-stamp' }),
      orphans: h('details', { class: 'ev-orphans' }),
      version: h('p', { class: 'note' }),
      warn: h('p', { class: 'ev-warn', role: 'status' }, BLOCKED),
      broken: h('p', { class: 'ev-warn', role: 'status' }, BROKEN),
      msg: h('p', { class: 'ev-msg', role: 'status' }),
      confirm: h('div', { class: 'ev-confirm', role: 'alertdialog', 'aria-label': 'Stadfest' }),
      clear: btn('Tøm alle', () => { msg = null; pending = { kind: 'clear' }; ctxRef.update(); }, { 'data-ev-act': 'tom' }),
    };
    ui.remind = h('div', { class: 'ev-remindbox' });
    return h('div', { class: 'ev-sec' },
      h('p', { class: 'note' }, 'Slå på «Kva kan eg?» øvst, trykk på eit omgrep eller ein metode i kartet og vel kor godt du kan det: ikkje enno, delvis eller godt. Det du ikkje har markert, er ukjend. Slår du av, ser du kartet utan fargane dine. Markeringane står.'),
      h('p', { class: 'note ev-stored' }, STORED),
      ui.remind,
      counts, ui.stamp, ui.warn, ui.broken,
      h('div', { class: 'ev-actions' }, btn('Lagre kopi (fil)', download, { 'data-ev-act': 'ned' }), btn('Hent frå fil', () => input.click(), { 'data-ev-act': 'opne' }), ui.clear, input),
      ui.confirm, ui.msg, ui.version, ui.orphans);
  }

  function renderSection(ctx) {
    if (!ui) return;
    const { h } = ctx, t = tally(scope(ctx)), orph = orphans(ctx);
    ui.counts.replaceChildren(...[['heilt', t.heilt, 'kan eg godt'], ['delvis', t.delvis, 'kan eg delvis'], ['ikkje', t.ikkje, 'kan eg ikkje enno'], ['none', t.none, 'ikkje markert']].map(([k, n, txt]) =>
      h('li', { class: 'ev-c ev-c-' + k }, h('span', { class: 'ev-n' }, String(n)), ' ' + txt)));
    ui.stamp.textContent = (ov.oppdatert ? `Sist endra ${stampText(ov.oppdatert)}.` : 'Ingen markeringar enno.') + (copy ? ` Kopi lagra ${stampText(copy.naar)}.` : '');
    ui.remind.replaceChildren(...(canStore && copyDue() ? [remindLine(ctx)] : []));
    // "Kva kan eg?" is on and nothing is marked: the line over the map says what to do; gone when the card is open
    const hint = document.getElementById('evHint');
    if (hint) hint.hidden = !(on(ctx) && !nMarks() && !ctx.state.sel);
    ui.warn.hidden = canStore;
    ui.broken.hidden = !broken;
    ui.clear.disabled = !nMarks();
    ui.msg.hidden = !msg;
    ui.msg.textContent = msg ? msg.text : '';
    ui.msg.className = 'ev-msg' + (msg ? ' ' + msg.tone : '');
    ui.version.hidden = ov.kartversjon === version;
    ui.version.textContent = ov.kartversjon === version ? '' : `Markeringane er frå versjon ${ov.kartversjon} av kartet (no: ${version}).`;
    ui.orphans.hidden = !orph.length;
    ui.orphans.replaceChildren(...(orph.length ? [
      h('summary', null, `Markeringar på omgrep som ikkje finst i denne versjonen (${orph.length})`),
      h('p', { class: 'note' }, 'Dei blir tekne vare på og følgjer med når du lastar ned fila.'),
      h('p', { class: 'ev-ids' }, orph.sort().map((id) => h('code', null, id))),
    ] : []));
    ui.confirm.hidden = !pending;
    ui.confirm.replaceChildren();
    if (pending) {
      const ask = pending.kind === 'clear'
        ? `Tøme alle ${nMarks()} markeringane? Det kan ikkje angrast.`
        : `Du har alt ${nMarks()} ${nMarks() === 1 ? 'markering' : 'markeringar'} her. Skal fila erstatte dei?`;
      const yes = h('button', { type: 'button', class: 'btn primary', 'data-ev-act': 'ja' }, pending.kind === 'clear' ? 'Ja, tøm' : 'Ja, erstatt');
      const no = h('button', { type: 'button', class: 'btn', 'data-ev-act': 'nei' }, 'Avbryt');
      yes.addEventListener('click', () => { if (pending.kind === 'clear') clearAll(); else applyFile(pending.next, pending.notes); });
      no.addEventListener('click', () => { pending = null; ctxRef.update(); });
      ui.confirm.append(h('p', null, ask), h('div', { class: 'ev-actions' }, yes, no));
    }
  }

  fagkart.registerLayer({
    id: 'eigenvurdering',
    label: 'Kva kan eg?',
    modes: ['elev'],
    priority: 'markering',
    overlay: 'eigenvurdering',
    cardSlot: 'top',
    // For other layers (ctx.layer('eigenvurdering')): the mark of a node ('ikkje' | 'delvis' | 'heilt' | null) and a copy of all marks.
    mark: (id) => (ov && ov.merke[id]) || null,
    marks: () => ({ ...((ov && ov.merke) || {}) }),
    init(ctx) {
      ctxRef = ctx;
      kode = ctx.kode;
      version = String(ctx.data.versjon || '?');
      key = `fagkart.${kode}.eigenvurdering`;
      copyKey = `fagkart.${kode}.evkopi`;
      if (ctx.mode === 'faglogg') { ov = fresh(); return; } // host mode: the layer is off and touches no storage
      ov = load();
      copy = loadCopy();
      window.addEventListener('storage', (e) => { if ((e.key === null || e.key === key) && sync()) ctxRef.update(); });
    },
    // same tones as the badges hole / part / ok, as fill and border: while the layer is on, the core draws the map as line work (state.strek),
    // so these are the only colours on the page. The border the forkunnskap layer puts on a hole still wins.
    styles: (c, { mix }) => [
      { selector: '.ev-ikkje', style: { 'background-color': mix(c.red, c.surface, Math.min(0.5, c.tint * 2.6)), 'border-color': c.red } },
      { selector: '.ev-delvis', style: { 'background-color': mix(c.warn, c.surface, Math.min(0.4, c.tint * 2.2)), 'border-color': c.warn } },
      { selector: '.ev-heilt', style: { 'background-color': mix(c.mint, c.surface, 0.8), 'border-color': c.mintDeep } },
      { selector: '.hole-delvis.ev-ikkje, .hole-delvis.ev-delvis, .hole-delvis.ev-heilt', style: { 'border-color': c.warn } },
      { selector: '.hole-nei.ev-ikkje, .hole-nei.ev-delvis, .hole-nei.ev-heilt', style: { 'border-color': c.red } },
      // the student's colour wins over the fade the forkunnskap layer gives a node the subject already covers (.fkok)
      { selector: '.fkok.ev-ikkje, .fkok.ev-delvis, .fkok.ev-heilt', style: { opacity: 1 } },
    ],
    nodeStyle(n, ctx, el) {
      if (!on(ctx) || el.grey || ctx.isKm(n)) return null; // a grey neighbour in the tema view stays grey
      const v = ov.merke[n.id];
      return isMark(v) ? { classes: 'ev-' + v } : null;
    },
    clusterStyle(cid, ctx) {
      if (!on(ctx)) return null;
      const list = (ctx.clusterNodes.get(cid) || []).filter((n) => ctx.state.showFk || !ctx.isFk(n));
      const t = tally(list);
      if (!t.marked) return null;
      // Only one badge fits on a box, and ours would replace the one of the forkunnskap layer ("2 hol"): ask that layer and join the texts
      let other = null;
      const l = ctx.layer('forkunnskap');
      other = l && l.clusterStyle ? l.clusterStyle(cid, ctx) : null;
      const b = other && other.badge;
      if (b) return { badge: { tone: b.tone, size: 13, text: `${b.text} · ${countLine(t)}` } };
      return { badge: { tone: t.heilt === t.total ? 'ok' : 'part', size: 13, text: countLine(t) } };
    },
    nodeCard(n, ctx) {
      return !on(ctx) || ctx.isKm(n) ? null : cardButtons(ctx, n);
    },
    kmCard(k, ctx) {
      if (!on(ctx)) return null;
      const served = scope(ctx).filter((n) => (n.km || []).includes(k.id));
      if (!served.length) return null;
      const t = tally(served);
      return ctx.h('div', { class: 'ev-km' }, ctx.h('h3', null, 'Kva kan eg?'), ctx.h('p', null, t.marked ? countLine(t) : 'Du har ikkje markert noko her enno.'));
    },
    toolbar: (ctx) => buildSection(ctx),
    status() {
      if (!on(ctxRef)) return '';
      const t = tally(scope(ctxRef));
      return t.heilt ? `${t.heilt} godt` : t.delvis ? `${t.delvis} delvis` : t.ikkje ? `${t.ikkje} ikkje enno` : '';
    },
    render: (ctx) => renderSection(ctx),
  });
})();
