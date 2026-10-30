// Render every $...$ / $$...$$ segment in the source YAML with KaTeX (throwOnError)
// and report failures. Usage: node check-latex.mjs [KART ...]  (default: all maps)
import fs from 'node:fs';
import path from 'node:path';
import katex from 'katex';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const kartDir = path.join(root, 'kart');
const maps = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(kartDir);
const MATH = /\$\$([\s\S]*?)\$\$|\$([^$]*)\$/g;
let errors = 0, count = 0;
for (const kart of maps) {
  const dir = path.join(kartDir, kart);
  if (!fs.existsSync(path.join(dir, 'meta.yaml'))) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.yaml') && x !== 'meta.yaml')) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    let nodeId = '?';
    text.split('\n').forEach((line, i) => {
      const m = line.match(/^\s*- id: (\S+)/);
      if (m) nodeId = m[1];
      for (const mm of line.matchAll(MATH)) {
        const tex = mm[1] ?? mm[2];
        count++;
        try { katex.renderToString(tex, { throwOnError: true, displayMode: mm[1] !== undefined, strict: 'error' }); }
        catch (e) { errors++; console.log(`FEIL  kart/${kart}/${f}:${i + 1}  ${nodeId}: ${e.message.split('\n')[0]}  [${tex}]`); }
      }
    });
  }
}
console.log(`${count} formlar sjekka, ${errors} feil`);
process.exit(errors ? 1 : 0);
