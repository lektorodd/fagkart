// Text helpers shared by the build, the viewer and the tests.
//  - segments(str): split a text field into text / code / inline math / display math parts.
//  - texLabel(str): readable plain-Unicode form of a text with LaTeX, for graph labels and search
//    (Cytoscape cannot draw KaTeX). Only for labels: the cards render the real LaTeX.
// The build inlines this file into the page after removing the `export` keywords, so keep it
// to plain function declarations without imports.

const SEG_RE = /`([^`\n]*)`|\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;

export function segments(str) {
  const s = String(str == null ? '' : str);
  const out = [];
  let last = 0;
  SEG_RE.lastIndex = 0;
  for (let m; (m = SEG_RE.exec(s));) {
    if (m.index > last) out.push({ kind: 'text', src: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'code', src: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'display', src: m[2] });
    else out.push({ kind: 'inline', src: m[3] });
    last = SEG_RE.lastIndex;
  }
  if (last < s.length) out.push({ kind: 'text', src: s.slice(last) });
  return out;
}

const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', sim: '∼', equiv: '≡', propto: '∝',
  int: '∫', iint: '∬', oint: '∮', sum: 'Σ', prod: '∏', infty: '∞', partial: '∂', nabla: '∇', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
  Leftarrow: '⇐', Leftrightarrow: '⇔', leftrightarrow: '↔', implies: '⇒', iff: '⇔', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', mid: '|', vert: '|', Vert: '‖', ldots: '…', dots: '…', cdots: '⋯',
  circ: '∘', degree: '°', prime: '′', angle: '∠', perp: '⊥', parallel: '∥', therefore: '∴', ll: '≪', gg: '≫', star: '⋆', bullet: '•', lbrace: '{', rbrace: '}',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', dagger: '†', hbar: 'ħ', ell: 'ℓ',
  '%': '%', '$': '$', '&': '&', '#': '#', '_': '_', '{': '{', '}': '}', '|': '‖', ',': ' ', ';': ' ', ':': ' ', ' ': ' ', '!': '', '\\': ' ', '>': ' ', '<': '<',
};
const SPACES = new Set([',', ';', ':', ' ', '>', '\\']);
const KEEP_NAME = new Set(['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'ln', 'log', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'Pr', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'mod', 'bmod']);
const TEXT_CMDS = new Set(['text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'textbf', 'textit', 'operatorname', 'mathcal', 'boldsymbol', 'bm', 'displaystyle', 'textstyle', 'phantom', 'mbox']);
const SKIP_CMDS = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'limits', 'nolimits', 'quad', 'qquad']);
const DOUBLE = { N: 'ℕ', Z: 'ℤ', Q: 'ℚ', R: 'ℝ', C: 'ℂ', P: 'ℙ', E: '𝔼' };
const ACCENTS = { bar: '̄', overline: '̄', hat: '̂', widehat: '̂', tilde: '̃', widetilde: '̃', vec: '⃗', dot: '̇', ddot: '̈', check: '̌' };
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', k: 'ᵏ', m: 'ᵐ', p: 'ᵖ', t: 'ᵗ', T: 'ᵀ', '′': '′', '°': '°' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };

function tokenize(tex) {
  const toks = [];
  const re = /\\([A-Za-z]+|[^A-Za-z])|(\s+)|([\s\S])/g;
  for (let m; (m = re.exec(tex));) {
    if (m[1] !== undefined) toks.push({ t: 'cmd', v: m[1] });
    else if (m[2] !== undefined) toks.push({ t: 'sp' });
    else toks.push({ t: 'ch', v: m[3] });
  }
  return toks;
}

function mapScript(s, table, open) {
  const chars = [...s.replace(/\s+/g, '')];
  if (chars.length && chars.every((c) => table[c])) return chars.map((c) => table[c]).join('');
  return chars.length === 1 ? open + chars[0] : `${open}(${s.trim()})`;
}

// Convert the body of one math segment to plain text.
function mathToPlain(tex) {
  const toks = tokenize(tex);
  let i = 0;
  const atom = () => {
    // one argument: a {group} or a single token, as LaTeX reads it
    while (toks[i] && toks[i].t === 'sp') i++;
    const k = toks[i];
    if (!k) return '';
    if (k.t === 'ch' && k.v === '{') { i++; return group(); }
    return seq(true);
  };
  function group() { // after '{', up to the matching '}'
    let out = '';
    while (i < toks.length && !(toks[i].t === 'ch' && toks[i].v === '}')) out += seq(false);
    i++; // '}'
    return out;
  }
  function seq(single) { // one item, or in single mode exactly the next token's value
    const k = toks[i++];
    if (!k) return '';
    if (k.t === 'sp') return single ? '' : ' ';
    if (k.t === 'ch') {
      if (k.v === '{') return group();
      if (k.v === '}') return '';
      if (k.v === '^' || k.v === '_') {
        const arg = atom();
        return mapScript(arg, k.v === '^' ? SUP : SUB, k.v);
      }
      if (k.v === "'") return '′';
      if (k.v === '~') return ' ';
      if (k.v === '-') return '−';
      return k.v;
    }
    const c = k.v;
    if (c in ACCENTS) { const a = atom(); return [...a].map((x) => x + ACCENTS[c]).join(''); }
    if (c === 'frac' || c === 'dfrac' || c === 'tfrac') {
      const a = atom(), b = atom();
      const w = (s) => (/^[\p{L}\p{N}.,′]+$/u.test(s) ? s : `(${s})`);
      return `${w(a)}/${w(b)}`;
    }
    if (c === 'sqrt') {
      let root = '';
      if (toks[i] && toks[i].t === 'ch' && toks[i].v === '[') {
        i++;
        while (i < toks.length && !(toks[i].t === 'ch' && toks[i].v === ']')) root += seq(false);
        i++;
      }
      const a = atom();
      const sign = root === '3' ? '∛' : root === '4' ? '∜' : '√';
      return /^[\p{L}\p{N}.,]+$/u.test(a) && (a.length === 1 || /^\p{N}+$/u.test(a)) ? sign + a : `${sign}(${a})`;
    }
    if (c === 'mathbb') { const a = atom(); return DOUBLE[a] || a; }
    if (TEXT_CMDS.has(c)) return atom();
    if (SKIP_CMDS.has(c)) {
      if (c === 'left' || c === 'right' || /^[Bb]ig/.test(c)) { // swallow the delimiter-less "."
        if (toks[i] && toks[i].t === 'ch' && toks[i].v === '.') i++;
      }
      return '';
    }
    if (KEEP_NAME.has(c)) return c;
    if (Object.prototype.hasOwnProperty.call(SYMBOLS, c)) {
      const s = SYMBOLS[c];
      return SPACES.has(c) ? ' ' : s;
    }
    return c.length > 1 ? c : ''; // unknown command: keep its name, drop lone escapes
  }
  let out = '';
  while (i < toks.length) out += seq(false);
  return out
    .replace(/ +([⁰-⁹ⁿⁱ⁺⁻⁼⁽⁾ˣʸᵃᵇᶜᵈᵉᵏᵐᵖᵗᵀ′₀-₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function texLabel(str) {
  return segments(str)
    .map((s) => (s.kind === 'text' || s.kind === 'code' ? s.src : mathToPlain(s.src)))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ');
}
