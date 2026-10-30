// Pure helpers for the tema (klynge) boxes of the zoom surface: the colour slot of a tema and the "4 omgrep · 2 metodar" counts.
// No DOM, so the tests run in Node. The build inlines this file into the page after removing the `export` keywords.

// The colour of a tema depends on its id alone, never on the order or on the other temaa of the map, so it is the same
// in every map and on every visit. The palette (app.js) has TEMA_SLOTS colours; SALT was picked so that the temaa of the
// maps we have (MAT11-01, MAT12-01, S2, DEMO-01) all get different colours inside each map. Changing SALT recolours everything.
export const TEMA_SLOTS = 8;
const SALT = 7282;

export function temaSlot(id) {
  let h = 2166136261; // FNV-1a over "<salt>:<id>", then the murmur3 finaliser so that the low bits are usable
  for (const ch of `${SALT}:${id}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) % TEMA_SLOTS;
}

// What the UI calls a node: omgrep and metodar (procedures); the other two kinds keep their own names.
const COUNT_NAMES = [['omgrep', 'omgrep', 'omgrep'], ['prosedyre', 'metode', 'metodar'], ['forklaring', 'forklaring', 'forklaringar'], ['representasjon', 'representasjon', 'representasjonar']];

// ["4 omgrep", "2 metodar"] for a list of nodes (kompetansemaal are not counted); [] for an empty list.
export function countParts(list) {
  const n = {};
  for (const x of list) n[x.type] = (n[x.type] || 0) + 1;
  return COUNT_NAMES.filter(([t]) => n[t]).map(([t, one, many]) => `${n[t]} ${n[t] === 1 ? one : many}`);
}
// "4 omgrep · 2 metodar"
export const countText = (list) => countParts(list).join(' · ');
