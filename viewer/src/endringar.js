// "Kva er nytt": the version log of a map (dist/<KODE>.endringar.json, docs/FORMAT.md § Endringar) as a plain data structure for the help box.
// Pure, no DOM: app.js draws it. The build inlines this file into the page after removing the `export` keywords, so keep it to plain declarations.

const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
// What a changed field is called to a teacher
export const FELT_NAMN = {
  namn: 'namn', tekst_laerar: 'lærartekst', tekst_elev: 'forklaring til eleven', doeme: 'døme', misoppfatning: 'misoppfatning',
  nivaa: 'nivå', verbnivaa: 'verbnivå', forkjennskap: 'forkjennskap', km: 'kompetansemål', klynge: 'tema',
};

// "2026-10-29" -> "29. oktober 2026"; anything else as it came
export function datoTekst(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])}. ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(iso || '');
}

// data: the parsed endringar file (or null). Returns null when there is no log, else { kart, naa, eldre }, where naa is the newest version and
// eldre the rest: { versjon, dato, samandrag, innspel, utrekna, nye, endra, sletta, piler }. A version without calculated lists (utrekna false) has
// only the summary. The student view (elev) leaves the names of the changed fields out.
export function endringarView(data, { elev = false } = {}) {
  const list = data && Array.isArray(data.versjonar) ? data.versjonar.filter((v) => v && typeof v === 'object') : [];
  if (!list.length) return null;
  const one = (v) => {
    const calc = v.utrekna === true;
    const k = (calc && v.kantar) || {};
    return {
      versjon: String(v.versjon), dato: datoTekst(v.dato), samandrag: v.samandrag || '', innspel: v.etter_innspel == null ? null : v.etter_innspel, utrekna: calc,
      nye: calc ? (v.nye || []).map((n) => ({ id: n.id, namn: n.namn, tema: n.tema || '' })) : [],
      endra: calc ? (v.endra || []).map((n) => ({ id: n.id, namn: n.namn, felt: elev ? [] : (n.felt || []).map((f) => FELT_NAMN[f] || f) })) : [],
      sletta: calc ? (v.sletta || []).map((n) => ({ id: n.id, namn: n.namn })) : [],
      piler: calc ? { nye: (k.nye || []).length, fjerna: (k.fjerna || []).length } : null,
    };
  };
  const all = list.map(one);
  return { kart: data.kart || '', naa: all[0], eldre: all.slice(1) };
}
