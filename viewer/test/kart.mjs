// The real maps of the repository: the codes of dist/*.json (the files scripts/bygg.py writes), sorted. The tests of the real maps loop over these,
// so they work in the full repository (three maps) and in the open export (one map, scripts/offentleg.py) alike.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const distDir = path.join(here, '..', '..', 'dist');
export const realMaps = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter((f) => f.endsWith('.json') && !/\.(layout|versjon|endringar)\.json$/.test(f)).map((f) => f.slice(0, -5)).sort()
  : [];
// The map the long browser tests use, one with nivaa 1 and 2, forkunnskap and 7 temaa: the second but last (the full repository has three maps), or the only one.
// Undefined when dist/ has no map (the tests then skip).
export const mainMap = realMaps.length > 1 ? realMaps.at(-2) : realMaps[0];
