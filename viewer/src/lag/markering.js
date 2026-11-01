/* Layer "markering": the teacher marks nodes on a scale that can be swapped (årsplan: planlagt / undervist / vurdert, or one of
   their own with 2–6 values; the exam scale del 1 / del 2 / ikkje eigna / uavklart is no longer offered, but a file with it still opens), writes a note per node, groups nodes in named sets
   (omraade: "Sett A", "Periode 2") and sees the coverage per competence goal. Teacher view only.
   The marks are an overlay (fagkart-overlegg/1, type "dekning", see docs/FORMAT.md § Overleggsformat). One file = one overlay = one plan or one
   exam construct; files are opened one after the other, never two at once. The layer is off until a file is opened or "Ny markering" is chosen.
   "Lagre" writes straight back to the opened file where the browser has the File System Access API (Chrome, Edge), else it downloads.
   localStorage keeps a copy under fagkart.<KODE>.markering so a reload loses nothing.
   Privacy: no network, nothing in the URL, and the file never holds student data.
   Keys with a node chosen and the focus outside a text field: 1–6 set value n of the scale, 0 takes the mark away, n opens the note,
   s puts the node in the active set (or takes it out). */
(function () {
  'use strict';

  const FORMAT = 'fagkart-overlegg/1';
  const TYPE = 'dekning';
  const NODE_ID = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/; // same as nodeId in schema/overlegg.schema.json
  const STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$/;
  const EV_SCALE = ['ikkje', 'delvis', 'heilt'];
  // Known scales, with their names and their colours (tokens of the page, in the order of the values). Only årsplan is offered
  // under "Ny markering"; eksamen stays so that files made with it before still open with their colours and the exam coverage.
  const SCALES = {
    aarsplan: { label: 'Årsplan', skala: ['planlagt', 'undervist', 'vurdert'], namn: { planlagt: 'Planlagt', undervist: 'Undervist', vurdert: 'Vurdert' }, col: ['warn', 'blue', 'green'] },
    eksamen: { label: 'Eksamen', skala: ['del1', 'del2', 'ikkje-eigna', 'uavklart'], namn: { del1: 'Del 1 (utan hjelpemiddel)', del2: 'Del 2', 'ikkje-eigna': 'Ikkje eigna', uavklart: 'Uavklart' }, col: ['blue', 'violet', 'muted', 'warn'] },
  };
  const OWN_COLOURS = ['blue', 'green', 'violet', 'warn', 'red', 'mintDeep'];
  const COLOURS = ['blue', 'green', 'violet', 'warn', 'red', 'mintDeep', 'muted'];
  const CSS_VAR = { blue: '--lo-blue', green: '--lo-green', violet: '--lo-violet', warn: '--lo-warn', red: '--lo-red', mintDeep: '--lo-mint-deep', muted: '--lo-muted' };
  const MIN_VALUES = 2, MAX_VALUES = 6;
  const BIG = 1.25; // "Vis stort": text and badges 25 % larger

  let kode = '', version = '', key = '';
  let ov = null; // the overlay, or null while the layer is off
  let active = null; // the name of the active set, or null
  let dirty = false; // changed since the last save to a file
  let handle = null; // the file handle the overlay came from or was saved to (File System Access API), never stored
  let fileName = null; // the name of the file the overlay came from or was saved to
  let canStore = true;
  let big = false, textBefore = null; // "Vis stort", and the text size of the map before it
  let pending = null; // an action waiting for a yes: { kind, text, yes, run }
  let msg = null; // { tone: 'ok' | 'err', text }
  let draft = { skala: 'aarsplan', eigne: '' }; // the form "Ny markering"
  let showNew = false;
  let ui = null;
  let ctxRef = null;

  const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const pad = (n) => String(n).padStart(2, '0');
  function stampNow() {
    const d = new Date(), off = -d.getTimezoneOffset(), a = Math.abs(off);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  function stampText(s) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} kl. ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  }
  const on = (ctx) => !!ov && ctx.mode === 'laerar';
  const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const presetOf = (skala) => Object.keys(SCALES).find((k) => sameList(SCALES[k].skala, skala)) || null;
  const isExam = () => !!ov && ov.skala.includes('del1') && ov.skala.includes('del2');
  // The name of a value: from skala_namn in the overlay, else the value with a capital letter
  const valueName = (v) => (ov.skala_namn && ov.skala_namn[v]) || (v.charAt(0).toUpperCase() + v.slice(1));
  // The short name on badges and in the table: "Del 1 (utan hjelpemiddel)" is "del 1"
  const shortName = (v) => valueName(v).replace(/\s*\(.*\)\s*$/, '').toLowerCase();
  function colourOf(v) {
    const i = ov.skala.indexOf(v), p = presetOf(ov.skala);
    return (p ? SCALES[p].col : OWN_COLOURS)[i] || 'muted';
  }
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const noteOf = (id) => { const n = ov.notat.find((x) => x.node === id); return n ? n.tekst : ''; };
  const setsOf = (id) => ov.omraade.filter((o) => o.nodar.includes(id)).map((o) => o.namn);
  const activeSet = () => (ov && active ? ov.omraade.find((o) => o.namn === active) || null : null);

  // ---------- The overlay ----------
  function fresh(preset, own, namn) {
    const o = { format: FORMAT, kart: kode, kartversjon: version, namn, type: TYPE, skala: [], skala_namn: {}, merke: {}, notat: [], omraade: [] };
    if (preset) { o.skala = SCALES[preset].skala.slice(); o.skala_namn = { ...SCALES[preset].namn }; }
    else for (const label of own) { const v = slug(label); o.skala.push(v); o.skala_namn[v] = label; }
    return o;
  }
  // As it is written to the file and to storage: the fields in a fixed order
  function snapshot() {
    const o = { format: FORMAT, kart: kode, kartversjon: ov.kartversjon, namn: ov.namn, type: TYPE };
    if (ov.oppdatert) o.oppdatert = ov.oppdatert;
    Object.assign(o, { skala: ov.skala.slice(), skala_namn: { ...ov.skala_namn }, merke: { ...ov.merke },
      notat: ov.notat.map((n) => ({ ...n })), omraade: ov.omraade.map((s) => ({ namn: s.namn, nodar: s.nodar.slice() })) });
    if (ov.eigne_kantar) o.eigne_kantar = ov.eigne_kantar;
    return o;
  }
  // Check an overlay from a file or from storage. Returns { overlay, notes } or { error }. Ids the map does not have are kept.
  function readOverlay(o) {
    if (!isPlainObject(o) || o.format !== FORMAT) return { error: 'Dette er ikkje ei fil med markering frå Fagkart.' };
    if (o.type != null && o.type !== TYPE) return { error: `Fila har type «${String(o.type)}», ikkje dekning (markering).` };
    if (o.kart !== kode) return { error: `Fila er laga for kartet «${String(o.kart)}», ikkje for «${kode}». Ingenting er endra.` };
    const sk = o.skala;
    if (!Array.isArray(sk) || sk.length < MIN_VALUES || sk.length > MAX_VALUES || sk.some((v) => typeof v !== 'string' || !v) || new Set(sk).size !== sk.length) {
      return { error: `Skalaen i fila må ha ${MIN_VALUES}–${MAX_VALUES} ulike verdiar. Ingenting er endra.` };
    }
    if (o.type == null && sameList(sk, EV_SCALE)) return { error: 'Dette ser ut som ei eigenvurdering, ikkje ei markering.' };
    const notes = [];
    const skala_namn = {};
    if (isPlainObject(o.skala_namn)) for (const v of sk) if (typeof o.skala_namn[v] === 'string' && o.skala_namn[v].trim()) skala_namn[v] = o.skala_namn[v].trim();
    const merke = {};
    let dropped = 0;
    if (o.merke != null && !isPlainObject(o.merke)) return { error: 'Markeringane i fila (merke) har feil form. Ingenting er endra.' };
    for (const [id, v] of Object.entries(o.merke || {})) { if (NODE_ID.test(id) && sk.includes(v)) merke[id] = v; else dropped++; }
    if (dropped) notes.push(`${dropped} ${dropped === 1 ? 'markering' : 'markeringar'} med ukjend verdi eller ID vart forkasta.`);
    const notat = [];
    for (const n of Array.isArray(o.notat) ? o.notat : []) {
      if (!isPlainObject(n) || !NODE_ID.test(n.node) || typeof n.tekst !== 'string' || !n.tekst.trim()) continue;
      const had = notat.find((x) => x.node === n.node);
      if (had) had.tekst += '\n\n' + n.tekst; else notat.push({ node: n.node, tekst: n.tekst });
    }
    const omraade = [];
    for (const s of Array.isArray(o.omraade) ? o.omraade : []) {
      if (!isPlainObject(s) || typeof s.namn !== 'string' || !s.namn.trim() || !Array.isArray(s.nodar)) continue;
      const ids = s.nodar.filter((id) => typeof id === 'string' && NODE_ID.test(id));
      const had = omraade.find((x) => x.namn === s.namn.trim());
      if (had) { for (const id of ids) if (!had.nodar.includes(id)) had.nodar.push(id); } else omraade.push({ namn: s.namn.trim(), nodar: [...new Set(ids)] });
    }
    const overlay = {
      format: FORMAT, kart: kode, kartversjon: typeof o.kartversjon === 'string' && o.kartversjon ? o.kartversjon : version,
      namn: typeof o.namn === 'string' && o.namn.trim() ? o.namn.trim() : 'Utan namn', type: TYPE,
      skala: sk.slice(), skala_namn, merke, notat, omraade,
    };
    if (typeof o.oppdatert === 'string' && STAMP.test(o.oppdatert)) overlay.oppdatert = o.oppdatert;
    if (Array.isArray(o.eigne_kantar)) overlay.eigne_kantar = o.eigne_kantar;
    return { overlay, notes };
  }

  // ---------- Storage: the copy in this browser (every access may throw) ----------
  function save() {
    try {
      if (ov) localStorage.setItem(key, JSON.stringify({ overlegg: snapshot(), aktivt: active, ulagra: dirty, fil: fileName }));
      else localStorage.removeItem(key);
      canStore = true;
    } catch (e) { canStore = false; }
  }
  function load() {
    let raw;
    try { raw = localStorage.getItem(key); } catch (e) { canStore = false; return; }
    if (raw == null) return;
    try {
      const w = JSON.parse(raw), r = readOverlay(w && w.overlegg);
      if (!r.overlay) return;
      ov = r.overlay;
      active = typeof w.aktivt === 'string' && ov.omraade.some((s) => s.namn === w.aktivt) ? w.aktivt : null;
      dirty = !!w.ulagra;
      fileName = typeof w.fil === 'string' ? w.fil : null;
    } catch (e) { /* not readable: start without */ }
  }
  // A change: stamp, keep, redraw (redraw: false for the note, so the field keeps its focus)
  function changed(redraw = true) {
    ov.kartversjon = version;
    ov.oppdatert = stampNow();
    dirty = true;
    save();
    if (redraw) ctxRef.update(); else renderSection(ctxRef);
  }

  // ---------- Actions ----------
  function setMark(id, v) {
    msg = null;
    if (v == null || ov.merke[id] === v) delete ov.merke[id]; else ov.merke[id] = v; // the same value once more takes it away
    changed();
  }
  function assign(id, v) {
    msg = null;
    if ((ov.merke[id] || null) === v) return;
    if (v == null) delete ov.merke[id]; else ov.merke[id] = v;
    changed();
  }
  function setNote(id, text) {
    const i = ov.notat.findIndex((x) => x.node === id);
    if (!text.trim()) { if (i >= 0) ov.notat.splice(i, 1); } else if (i >= 0) ov.notat[i].tekst = text; else ov.notat.push({ node: id, tekst: text });
    changed(false);
  }
  function toggleInSet(id) {
    const s = activeSet();
    if (!s) { msg = { tone: 'err', text: 'Ingen sett er aktivt. Lag eller vel eit sett under «Sett».' }; ctxRef.update(); return; }
    msg = null;
    const i = s.nodar.indexOf(id);
    if (i >= 0) s.nodar.splice(i, 1); else s.nodar.push(id);
    changed();
  }
  function addSet(name) {
    name = name.trim();
    if (!name) { msg = { tone: 'err', text: 'Gi settet eit namn.' }; ctxRef.update(); return false; }
    if (ov.omraade.some((s) => s.namn === name)) { msg = { tone: 'err', text: `Det finst alt eit sett som heiter «${name}».` }; ctxRef.update(); return false; }
    ov.omraade.push({ namn: name, nodar: [] });
    active = name;
    msg = { tone: 'ok', text: `Settet «${name}» er laga og aktivt. Vel ein node og trykk s for å leggje han i settet.` };
    changed();
    return true;
  }
  function renameSet(s, name) {
    name = name.trim();
    if (!name || name === s.namn) { ctxRef.update(); return; }
    if (ov.omraade.some((x) => x.namn === name)) { msg = { tone: 'err', text: `Det finst alt eit sett som heiter «${name}».` }; ctxRef.update(); return; }
    if (active === s.namn) active = name;
    s.namn = name;
    msg = null;
    changed();
  }
  function deleteSet(s) {
    ov.omraade = ov.omraade.filter((x) => x !== s);
    if (active === s.namn) active = null;
    msg = { tone: 'ok', text: `Settet «${s.namn}» er sletta.` };
    changed();
  }
  function setActive(name) {
    active = active === name ? null : name;
    msg = null;
    save();
    ctxRef.update();
  }
  // Ask first when there are changes that are not in a file: { text, yes, run }
  function guard(text, yes, run) {
    if (!dirty) { run(); return; }
    pending = { text, yes, run };
    ctxRef.update();
  }
  function start(next, opts) {
    pending = null;
    ov = next;
    active = ov.omraade.length ? ov.omraade[0].namn : null;
    dirty = !!opts.dirty;
    handle = opts.handle || null;
    fileName = opts.fileName || null;
    showNew = false;
    msg = opts.msg || null;
    save();
    ctxRef.update();
  }
  function newOverlay() {
    const name = ui.newName.value.trim();
    let next;
    if (draft.skala === 'eiga') {
      const labels = ui.newOwn.value.split(',').map((s) => s.trim()).filter(Boolean);
      const values = labels.map(slug);
      if (labels.length < MIN_VALUES || labels.length > MAX_VALUES) { msg = { tone: 'err', text: `Ein eigen skala må ha ${MIN_VALUES}–${MAX_VALUES} verdiar, skilde med komma.` }; ctxRef.update(); return; }
      if (values.some((v) => !v) || new Set(values).size !== values.length) { msg = { tone: 'err', text: 'Verdiane i skalaen må vere ulike og ha minst éin bokstav eller eitt siffer.' }; ctxRef.update(); return; }
      next = fresh(null, labels, name || 'Mi markering');
    } else next = fresh(draft.skala, null, name || SCALES[draft.skala].label);
    guard(`Du har ulagra endringar i «${ov ? ov.namn : ''}». Byrje på ei ny markering likevel?`, 'Ja, byrj på ny', () =>
      start(next, { dirty: true, msg: { tone: 'ok', text: `«${next.namn}» er laga. Vel ein node og trykk 1–${next.skala.length}.` } }));
  }
  function readText(text, opts) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { msg = { tone: 'err', text: 'Fila er ikkje gyldig JSON.' }; ctxRef.update(); return; }
    const r = readOverlay(parsed);
    if (r.error) { msg = { tone: 'err', text: r.error }; ctxRef.update(); return; }
    const extra = r.overlay.kartversjon !== version ? [`Fila er laga for versjon ${r.overlay.kartversjon} av kartet.`] : [];
    const run = () => start(r.overlay, { ...opts, msg: { tone: 'ok', text: [`Opna «${r.overlay.namn}».`, ...r.notes, ...extra].join(' ') } });
    guard(`Du har ulagra endringar i «${ov ? ov.namn : ''}». Opne den nye fila likevel?`, 'Ja, opne', run);
  }
  async function openPicked() {
    msg = null; pending = null;
    if (typeof window.showOpenFilePicker !== 'function') { ui.input.click(); return; }
    let h;
    try { [h] = await window.showOpenFilePicker({ types: [{ description: 'Markering frå Fagkart', accept: { 'application/json': ['.json'] } }] }); } catch (e) { return; } // cancelled
    let text;
    try { text = await (await h.getFile()).text(); } catch (e) { msg = { tone: 'err', text: 'Klarte ikkje lese fila.' }; ctxRef.update(); return; }
    readText(text, { handle: h, fileName: h.name });
  }
  async function openInput(file) {
    msg = null; pending = null;
    let text;
    try { text = await file.text(); } catch (e) { msg = { tone: 'err', text: 'Klarte ikkje lese fila.' }; ctxRef.update(); return; }
    readText(text, { fileName: file.name });
  }
  const fileText = () => JSON.stringify(snapshot(), null, 2) + '\n';
  const suggestedName = () => fileName || `markering-${kode}-${slug(ov.namn) || 'utan-namn'}.json`;
  function saved(name, how) {
    dirty = false;
    fileName = name;
    msg = { tone: 'ok', text: how };
    save();
    ctxRef.update();
  }
  async function writeTo(h) {
    if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('no permission');
    const w = await h.createWritable();
    await w.write(fileText());
    await w.close();
  }
  function download(name) {
    const url = URL.createObjectURL(new Blob([fileText()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    saved(name, `Lasta ned ${name}. Legg fila i mappa der ho skal vere.`);
  }
  async function saveFile() {
    msg = null; pending = null;
    if (!handle) { download(suggestedName()); return; }
    try { await writeTo(handle); saved(handle.name, `Lagra i ${handle.name}.`); } catch (e) { msg = { tone: 'err', text: `Klarte ikkje skrive til ${handle.name}. Bruk «Lagre som».` }; ctxRef.update(); }
  }
  async function saveAs() {
    msg = null; pending = null;
    if (typeof window.showSaveFilePicker !== 'function') { download(suggestedName()); return; }
    let h;
    try { h = await window.showSaveFilePicker({ suggestedName: suggestedName(), types: [{ description: 'Markering frå Fagkart', accept: { 'application/json': ['.json'] } }] }); } catch (e) { return; } // cancelled
    try { await writeTo(h); handle = h; saved(h.name, `Lagra i ${h.name}.`); } catch (e) { msg = { tone: 'err', text: `Klarte ikkje skrive til ${h.name}.` }; ctxRef.update(); }
  }
  function closeOverlay() {
    guard(`Du har ulagra endringar i «${ov.namn}». Lukke utan å lagre?`, 'Ja, lukk', () => {
      pending = null;
      msg = { tone: 'ok', text: `«${ov.namn}» er lukka.` };
      ov = null; active = null; dirty = false; handle = null; fileName = null;
      save();
      ctxRef.update();
    });
  }
  // "Vis stort": the text of the map follows the size "Stor" of the core (×1.25), the card, the drawer and the badges grow by 25 %
  function setBig(v) {
    big = v;
    document.documentElement.toggleAttribute('data-mk-stort', big);
    const want = big ? 'stor' : textBefore;
    if (big) textBefore = ctxRef.state.tekst;
    const b = want && document.querySelector(`#tekstSeg [data-tekst="${want}"]`);
    if (b && ctxRef.state.tekst !== want) b.click();
    ctxRef.update(); // the badges take the new size
  }

  // ---------- Counting ----------
  const scope = (ctx) => ctx.nodes.filter((n) => !ctx.isKm(n) && (ctx.state.showFk || !ctx.isFk(n)));
  function tally(list) {
    const t = { total: list.length, marked: 0, per: Object.fromEntries(ov.skala.map((v) => [v, 0])) };
    for (const n of list) { const v = ov.merke[n.id]; if (v && v in t.per) { t.per[v]++; t.marked++; } }
    return t;
  }
  // "5 av 12 planlagt" when one value is in use, "3 del 1 · 4 del 2" when more are
  function tallyText(t) {
    const used = ov.skala.filter((v) => t.per[v]);
    if (used.length === 1) return `${t.per[used[0]]} av ${t.total} ${shortName(used[0])}`;
    return used.map((v) => `${t.per[v]} ${shortName(v)}`).join(' · ');
  }
  // One row per competence goal: the nodes that serve it, how many have each value, and none (red) when no node has one
  function coverage(ctx) {
    const list = scope(ctx);
    return ctx.kmNodes.map((k) => ({ km: k, t: tally(list.filter((n) => (n.km || []).includes(k.id))) }));
  }
  // For an exam: the nodes at the level "bruke" that are marked del 2 and so not del 1, and the nodes in more than one set
  function examLists(ctx) {
    const list = scope(ctx);
    return {
      del2: list.filter((n) => n.verbnivaa === 'bruke' && ov.merke[n.id] === 'del2'),
      fleire: list.filter((n) => setsOf(n.id).length > 1),
    };
  }
  // The table as text (tabs between the columns), for the clipboard
  function coverageText(ctx) {
    const rows = [['Kompetansemål', 'Nodar', ...ov.skala.map(valueName), 'Merkte'].join('\t')];
    for (const { km, t } of coverage(ctx)) rows.push([`${km.namn} ${ctx.lab(km.tekst || '')}`.trim(), t.total, ...ov.skala.map((v) => t.per[v]), t.marked ? t.marked : 'ingen'].join('\t'));
    const out = [`${ov.namn} (${kode}, versjon ${version})`, '', ...rows];
    if (isExam()) {
      const e = examLists(ctx);
      out.push('', `Bruke, merkt del 2 men ikkje del 1 (${e.del2.length})`, ...e.del2.map((n) => `- ${ctx.lab(n.namn)}`));
      out.push('', `I meir enn eitt sett (${e.fleire.length})`, ...e.fleire.map((n) => `- ${ctx.lab(n.namn)}: ${setsOf(n.id).join(', ')}`));
    }
    return out.join('\n') + '\n';
  }
  async function copyCoverage() {
    const text = coverageText(ctxRef);
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = document.createElement('textarea'); // older browsers, or a page without clipboard access
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
    }
    msg = ok ? { tone: 'ok', text: 'Tabellen er kopiert som tekst.' } : { tone: 'err', text: 'Klarte ikkje kopiere. Merk tabellen og kopier han sjølv.' };
    ctxRef.update();
  }

  // ---------- Keys ----------
  // a field that takes text (a checkbox or a button with the focus does not stop the keys)
  const NO_TEXT = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image'];
  const typing = (el) => !!el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === 'INPUT' && !NO_TEXT.includes((el.type || '').toLowerCase())));
  function onKey(e) {
    const ctx = ctxRef;
    if (!on(ctx) || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || typing(document.activeElement)) return;
    const id = ctx.state.sel, n = id && ctx.byId.get(id);
    if (!n || ctx.isKm(n)) return;
    const k = e.key;
    if (/^[0-6]$/.test(k)) {
      const i = +k;
      if (i > ov.skala.length) return;
      e.preventDefault();
      assign(id, i === 0 ? null : ov.skala[i - 1]); // a key sets, it never takes away (0 does)
    } else if (k === 'n' || k === 'N') {
      const f = document.querySelector('#panel [data-mk-notat]');
      if (!f) return;
      e.preventDefault();
      const d = f.closest('details');
      if (d) d.open = true;
      f.focus();
    } else if (k === 's' || k === 'S') {
      e.preventDefault();
      toggleInSet(id);
    }
  }

  // ---------- Views ----------
  const dot = (ctx, v) => ctx.h('span', { class: 'mk-dot', style: `--mk:var(${CSS_VAR[colourOf(v)]})`, 'aria-hidden': 'true' });
  function cardSection(ctx, n) {
    const { h } = ctx, cur = ov.merke[n.id] || null;
    const group = h('div', { class: 'mk-seg', role: 'radiogroup', 'aria-label': ov.namn }, ov.skala.map((v, i) => {
      const b = h('button', { type: 'button', role: 'radio', class: 'mk-btn', style: `--mk:var(${CSS_VAR[colourOf(v)]})`, 'data-mk': v, 'aria-checked': String(cur === v), title: `Tast ${i + 1}` },
        h('span', { class: 'mk-key', 'aria-hidden': 'true' }, String(i + 1)), valueName(v));
      b.addEventListener('click', () => {
        setMark(n.id, v);
        const again = document.querySelector(`#panel [data-mk="${CSS.escape(v)}"]`); // the card is drawn anew: keep the focus where it was
        if (again) again.focus({ preventScroll: true });
      });
      return b;
    }));
    const note = h('textarea', { class: 'mk-notat', rows: '3', 'data-mk-notat': '', 'aria-label': 'Notat', placeholder: 'Notat, til dømes innspel frå møtet' });
    note.value = noteOf(n.id);
    note.addEventListener('input', () => setNote(n.id, note.value));
    note.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); note.blur(); } }); // Escape leaves the note, the card stays
    const sets = setsOf(n.id), s = activeSet();
    const setBtn = s ? h('button', { type: 'button', class: 'btn small', 'data-mk-act': 'sett' }, s.nodar.includes(n.id) ? `Ta ut av «${s.namn}»` : `Legg i «${s.namn}»`) : null;
    if (setBtn) setBtn.addEventListener('click', () => toggleInSet(n.id));
    return h('div', { class: 'mk-card', 'data-mk-card': '' },
      h('span', { class: 'mk-lbl' }, ov.namn),
      group,
      h('p', { class: 'mk-sets' }, sets.length ? `I sett: ${sets.join(', ')}` : 'Ikkje i noko sett', setBtn ? ' ' : null, setBtn),
      h('label', { class: 'mk-notatlbl' }, h('span', null, 'Notat'), note));
  }
  function kmSection(ctx, k) {
    const { h } = ctx, row = coverage(ctx).find((r) => r.km.id === k.id);
    if (!row) return null;
    const t = row.t;
    return h('div', { class: 'mk-km', 'data-mk-km': '' }, h('h3', null, ov.namn),
      h('p', null, `${t.total} ${t.total === 1 ? 'node tener' : 'nodar tener'} målet. `,
        t.marked ? tallyText(t) : h('span', { class: 'mk-none' }, 'Ingen er merkte.')));
  }

  function buildSection(ctx) {
    const { h } = ctx;
    const btn = (text, fn, act, cls) => { const b = h('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), 'data-mk-act': act }, text); b.addEventListener('click', fn); return b; };
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Vel fil med markering', 'data-mk-file': '' });
    input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) openInput(f); });
    // "Ny markering": a name and a scale
    const newName = h('input', { type: 'text', class: 'mk-input', 'data-mk-nytt-namn': '', 'aria-label': 'Namn på markeringa', placeholder: 'Namn, t.d. «Årsplan 2027–28»' });
    const newOwn = h('input', { type: 'text', class: 'mk-input', 'data-mk-eiga': '', 'aria-label': 'Verdiar i eigen skala', placeholder: 'Verdiar, skilde med komma (2–6)' });
    const scaleSeg = h('div', { class: 'seg mk-scaleseg', role: 'radiogroup', 'aria-label': 'Skala' }, [['aarsplan', 'Årsplan'], ['eiga', 'Eigen']].map(([k, label]) => {
      const b = h('button', { type: 'button', role: 'radio', 'data-mk-skala': k, 'aria-checked': String(draft.skala === k) }, label);
      b.addEventListener('click', () => { draft.skala = k; renderSection(ctxRef); });
      return b;
    }));
    const newForm = h('div', { class: 'mk-new', 'data-mk-ny': '' }, newName, scaleSeg, h('p', { class: 'note mk-scaletext' }), newOwn,
      h('div', { class: 'mk-actions' }, btn('Lag', newOverlay, 'lag', 'primary'), btn('Avbryt', () => { showNew = false; msg = null; ctxRef.update(); }, 'avbryt-ny')));
    newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') newOverlay(); });
    newOwn.addEventListener('keydown', (e) => { if (e.key === 'Enter') newOverlay(); });
    // The open overlay: its name, the file, the scale with counts
    const name = h('input', { type: 'text', class: 'mk-input mk-name', 'data-mk-namn': '', 'aria-label': 'Namn på markeringa' });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v && ov && v !== ov.namn) { ov.namn = v; changed(); } else if (ov) name.value = ov.namn; });
    // Sets
    const setName = h('input', { type: 'text', class: 'mk-input', 'data-mk-settnamn': '', 'aria-label': 'Namn på nytt sett', placeholder: 'Nytt sett, t.d. «Sett A, hausten 2027»' });
    const addSetBtn = btn('Lag sett', () => { if (addSet(setName.value)) setName.value = ''; }, 'lag-sett');
    setName.addEventListener('keydown', (e) => { if (e.key === 'Enter' && addSet(setName.value)) setName.value = ''; });
    const bigSw = h('input', { type: 'checkbox', 'data-mk-stort': '' });
    bigSw.addEventListener('change', () => setBig(bigSw.checked));
    ui = {
      input, newName, newOwn, newForm, name, setName, bigSw,
      start: h('div', { class: 'mk-start' },
        h('p', { class: 'note' }, 'Merk nodane etter ein skala: årsplan (planlagt, undervist, vurdert) eller ein eigen skala med 2–6 verdiar, til dømes «Repetisjon, Nytt stoff» eller «Felles gjennomgang, Gruppearbeid, Sjølvstudium». Alt blir lagra som fil på maskina di. Ingenting går over nettet.'),
        h('div', { class: 'mk-actions' }, btn('Ny markering', () => { showNew = true; msg = null; pending = null; ctxRef.update(); }, 'ny', 'primary'), btn('Opne fil', openPicked, 'opne'))),
      open: h('div', { class: 'mk-open' }),
      head: h('div', { class: 'mk-head' }, name),
      file: h('p', { class: 'note mk-file' }),
      legend: h('ul', { class: 'mk-legend', 'aria-label': 'Skala' }),
      fileBtns: h('div', { class: 'mk-actions' }, btn('Lagre', saveFile, 'lagre', 'primary'), btn('Lagre som', saveAs, 'lagre-som'), btn('Opne fil', openPicked, 'opne'), btn('Ny', () => { showNew = true; msg = null; pending = null; ctxRef.update(); }, 'ny'), btn('Lukk', closeOverlay, 'lukk')),
      sets: h('ul', { class: 'mk-setlist', 'data-mk-sett': '' }),
      table: h('div', { class: 'mk-table', 'data-mk-dekning': '' }),
      exam: h('div', { class: 'mk-exam', 'data-mk-eksamen': '' }),
      warn: h('p', { class: 'ev-warn', role: 'status' }, 'Markeringa blir ikkje teken vare på i denne nettlesaren. Lagre fila før du lukkar sida.'),
      msg: h('p', { class: 'ev-msg', role: 'status' }),
      confirm: h('div', { class: 'ev-confirm', role: 'alertdialog', 'aria-label': 'Stadfest' }),
      keys: h('p', { class: 'note mk-keysnote' }),
    };
    const sub = (title, attr, ...kids) => h('details', { class: 'mk-sub', open: true, [attr]: '' }, h('summary', null, title), h('div', { class: 'mk-subbody' }, kids));
    ui.open.append(
      ui.head, ui.file, ui.legend, ui.fileBtns,
      h('label', { class: 'mk-big' }, bigSw, ' Vis stort (skjerm i møte)'),
      sub('Sett', 'data-mk-sub-sett', h('p', { class: 'note' }, 'Eit sett er ei gruppe nodar, til dømes «Sett A, hausten 2027» eller «Periode 2». Det aktive settet har ei ramme rundt nodane sine på kartet.'),
        ui.sets, h('div', { class: 'mk-row' }, setName, addSetBtn)),
      sub('Dekning', 'data-mk-sub-dekning', ui.table, ui.exam, h('div', { class: 'mk-actions' }, btn('Kopier som tekst', copyCoverage, 'kopier'))),
      sub('Hurtigtastar', 'data-mk-sub-tastar',
        h('dl', { class: 'mk-keys' },
          h('dt', null, h('kbd', null, '1'), '–', h('kbd', null, '6')), h('dd', null, 'set verdi nummer 1–6 i skalaen'),
          h('dt', null, h('kbd', null, '0')), h('dd', null, 'fjernar markeringa'),
          h('dt', null, h('kbd', null, 'n')), h('dd', null, 'opnar notatet'),
          h('dt', null, h('kbd', null, 's')), h('dd', null, 'legg noden i det aktive settet, eller tek han ut')),
        ui.keys));
    return h('div', { class: 'mk-sec' }, ui.start, newForm, ui.open, ui.warn, ui.confirm, ui.msg, input);
  }

  function renderSection(ctx) {
    if (!ui) return;
    const { h } = ctx;
    ui.start.hidden = !!ov || showNew;
    ui.newForm.hidden = !showNew;
    ui.open.hidden = !ov || showNew;
    ui.warn.hidden = canStore;
    document.documentElement.toggleAttribute('data-mk-stort', big && on(ctx));
    ui.newForm.querySelectorAll('[data-mk-skala]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mkSkala === draft.skala)));
    ui.newOwn.hidden = draft.skala !== 'eiga';
    ui.newForm.querySelector('.mk-scaletext').textContent = draft.skala === 'eiga' ? 'Skriv 2–6 verdiar, til dømes «Ja, Nei, Kanskje».'
      : SCALES[draft.skala].skala.map((v) => SCALES[draft.skala].namn[v]).join(' · ');
    ui.msg.hidden = !msg;
    ui.msg.textContent = msg ? msg.text : '';
    ui.msg.className = 'ev-msg' + (msg ? ' ' + msg.tone : '');
    ui.confirm.hidden = !pending;
    ui.confirm.replaceChildren();
    if (pending) {
      const p = pending;
      const yes = h('button', { type: 'button', class: 'btn primary', 'data-mk-act': 'ja' }, p.yes);
      const no = h('button', { type: 'button', class: 'btn', 'data-mk-act': 'nei' }, 'Avbryt');
      yes.addEventListener('click', () => { pending = null; p.run(); });
      no.addEventListener('click', () => { pending = null; ctxRef.update(); });
      ui.confirm.append(h('p', null, p.text), h('div', { class: 'mk-actions' }, yes, no));
    }
    if (!ov) return;
    if (document.activeElement !== ui.name) ui.name.value = ov.namn;
    ui.bigSw.checked = big;
    const how = handle ? `«Lagre» skriv rett til ${handle.name}.` : typeof window.showSaveFilePicker === 'function' ? '«Lagre» lastar ned fila. «Lagre som» lèt deg velje kvar ho skal liggje, og etter det skriv «Lagre» dit.' : '«Lagre» lastar ned fila.';
    ui.file.textContent = `${fileName ? `Fil: ${fileName}. ` : 'Ikkje lagra som fil enno. '}${dirty ? 'Ulagra endringar. ' : 'Alt er lagra. '}${how}` +
      (ov.oppdatert ? ` Sist endra ${stampText(ov.oppdatert)}.` : '');
    ui.file.classList.toggle('mk-dirty', dirty);
    const t = tally(scope(ctx));
    ui.legend.replaceChildren(...ov.skala.map((v, i) => h('li', null, h('kbd', null, String(i + 1)), dot(ctx, v), ` ${valueName(v)} `, h('span', { class: 'ev-n' }, String(t.per[v])))),
      h('li', { class: 'mk-unmarked' }, h('span', { class: 'mk-dot mk-dot-none', 'aria-hidden': 'true' }), ` Ikkje merkt `, h('span', { class: 'ev-n' }, String(t.total - t.marked))));
    // sets: active (aria-pressed), the name (edit it in place), the count, delete
    ui.sets.replaceChildren(...(ov.omraade.length ? ov.omraade.map((s) => {
      const act = h('button', { type: 'button', class: 'btn small mk-setact', 'aria-pressed': String(active === s.namn), 'data-mk-aktiv': s.namn, title: active === s.namn ? 'Aktivt: trykk for å slå av' : 'Gjer aktivt' }, active === s.namn ? 'Aktivt' : 'Gjer aktivt');
      act.addEventListener('click', () => setActive(s.namn));
      const nm = h('input', { type: 'text', class: 'mk-input mk-setname', 'aria-label': 'Namn på settet', 'data-mk-settnamn-for': s.namn });
      nm.value = s.namn;
      nm.addEventListener('change', () => renameSet(s, nm.value));
      nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') nm.blur(); });
      const del = h('button', { type: 'button', class: 'btn small', 'data-mk-slett': s.namn, 'aria-label': `Slett settet ${s.namn}` }, 'Slett');
      del.addEventListener('click', () => { pending = { text: `Slette settet «${s.namn}» (${s.nodar.length} nodar)? Nodane og markeringane står.`, yes: 'Ja, slett', run: () => deleteSet(s) }; ctxRef.update(); });
      return h('li', { class: 'mk-set' + (active === s.namn ? ' active' : '') }, act, nm, h('span', { class: 'ev-n mk-setn', title: 'Nodar i settet' }, String(s.nodar.length)), del);
    }) : [h('li', { class: 'note' }, 'Ingen sett enno.')]));
    // the coverage table
    const rows = coverage(ctx);
    ui.table.replaceChildren(rows.length ? h('table', null,
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Mål'), h('th', { scope: 'col', title: 'Nodar som tener målet' }, 'Nodar'),
        ...ov.skala.map((v) => h('th', { scope: 'col', title: valueName(v) }, dot(ctx, v), shortName(v))), h('th', { scope: 'col' }, 'Merkte'))),
      h('tbody', null, rows.map(({ km, t }) => h('tr', { 'data-km': km.id },
        h('th', { scope: 'row', title: ctx.lab(km.tekst || '') }, km.namn), h('td', null, String(t.total)),
        ...ov.skala.map((v) => h('td', null, t.per[v] ? String(t.per[v]) : '·')),
        h('td', { class: t.marked ? '' : 'mk-none' }, t.marked ? String(t.marked) : 'ingen'))))) : h('p', { class: 'note' }, 'Kartet har ingen kompetansemål.'));
    ui.exam.hidden = !isExam();
    ui.exam.replaceChildren();
    if (isExam()) {
      const e = examLists(ctx);
      const list = (title, attr, nodes, extra) => h('div', { class: 'mk-list', [attr]: '' }, h('h4', null, `${title} (${nodes.length})`),
        nodes.length ? h('ul', { class: 'links' }, nodes.map((n) => h('li', null, ctx.nodeLink(n.id), extra ? h('span', { class: 'note' }, ' ' + extra(n)) : null))) : h('p', { class: 'note' }, 'Ingen.'));
      ui.exam.append(
        list('Bruke, merkt del 2 men ikkje del 1', 'data-mk-del2', e.del2),
        list('I meir enn eitt sett', 'data-mk-fleire', e.fleire, (n) => setsOf(n.id).join(', ')));
    }
    ui.keys.textContent = ctx.state.sel && ctx.byId.get(ctx.state.sel) && !ctx.isKm(ctx.byId.get(ctx.state.sel)) ? '' : 'Vel ein node i kartet først. Tastane verkar ikkje medan du skriv i eit tekstfelt.';
  }

  fagkart.registerLayer({
    id: 'markering',
    label: 'Markering',
    modes: ['laerar'],
    priority: 'markering',
    overlay: 'dekning',
    cardSlot: 'top',
    // for tests and other layers: the overlay as it would be saved (or null), and the coverage table as text
    overlegg: () => (ov ? snapshot() : null),
    dekningTekst: () => (ov ? coverageText(ctxRef) : ''),
    init(ctx) {
      ctxRef = ctx;
      kode = ctx.kode;
      version = String(ctx.data.versjon || '?');
      key = `fagkart.${kode}.markering`;
      if (ctx.mode === 'faglogg') return; // host mode: the layer is never on and touches no storage
      load();
      document.addEventListener('keydown', onKey);
    },
    // fill and border per value, and plain paper with a grey border for a node without a mark, so the marked ones stand out from the
    // colours of the node types. The active set gets a frame (outline) round its nodes. The selection of the core still wins
    styles: (c, { mix }) => [
      { selector: '.mk-av', style: { 'background-color': c.surface, 'border-color': mix(c.ink, c.surface, 0.4), 'border-width': 1.4 } },
      ...COLOURS.map((k) => ({ selector: `.mk-${k}`, style: { 'background-color': mix(c[k], c.surface, k === 'muted' ? 0.3 : 0.42), 'border-color': c[k], 'border-width': 2.6 } })),
      { selector: '.mk-sett', style: { 'outline-width': 4, 'outline-color': c.inkStrong, 'outline-offset': 4, 'outline-style': 'dashed', 'outline-opacity': 0.9 } },
      // a mark wins over the fade the forkunnskap layer gives a node the subject already covers (.fkok)
      { selector: ['mk-sett', ...COLOURS.map((k) => 'mk-' + k)].map((k) => `.fkok.${k}`).join(', '), style: { opacity: 1 } },
      // the holes the forkunnskap layer marks keep their border
      { selector: ['mk-av', ...COLOURS.map((k) => 'mk-' + k)].map((k) => `.hole-delvis.${k}`).join(', '), style: { 'border-color': c.warn, 'border-width': 3.5 } },
      { selector: ['mk-av', ...COLOURS.map((k) => 'mk-' + k)].map((k) => `.hole-nei.${k}`).join(', '), style: { 'border-color': c.red, 'border-width': 4 } },
    ],
    nodeStyle(n, ctx, el) {
      if (!on(ctx) || el.grey || ctx.isKm(n)) return null;
      const v = ov.merke[n.id], s = activeSet(), cls = [];
      cls.push(v && ov.skala.includes(v) ? 'mk-' + colourOf(v) : 'mk-av');
      if (s && s.nodar.includes(n.id)) cls.push('mk-sett');
      return { classes: cls };
    },
    clusterStyle(cid, ctx) {
      if (!on(ctx)) return null;
      const t = tally((ctx.clusterNodes.get(cid) || []).filter((n) => ctx.state.showFk || !ctx.isFk(n)));
      if (!t.marked) return null;
      const size = Math.round(13 * (big ? BIG : 1));
      // one badge fits on a box: join ours to the one of the forkunnskap layer ("2 hol")
      const l = ctx.layer('forkunnskap'), other = l && l.clusterStyle ? l.clusterStyle(cid, ctx) : null, b = other && other.badge;
      if (b) return { badge: { tone: b.tone, size, text: `${b.text} · ${tallyText(t)}` } };
      return { badge: { tone: t.marked === t.total ? 'ok' : 'new', size, text: tallyText(t) } };
    },
    nodeCard: (n, ctx) => (!on(ctx) || ctx.isKm(n) ? null : cardSection(ctx, n)),
    kmCard: (k, ctx) => (on(ctx) ? kmSection(ctx, k) : null),
    toolbar: (ctx) => buildSection(ctx),
    status() {
      if (!on(ctxRef)) return '';
      const n = Object.keys(ov.merke).length;
      return `${n} merkte${dirty ? ', ulagra' : ''}`;
    },
    render: (ctx) => renderSection(ctx),
  });
})();
