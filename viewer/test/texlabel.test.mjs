// Tests for the plain-Unicode label form of LaTeX. Run with: npm test (in viewer/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { texLabel, segments } from '../src/texlabel.js';

const cases = [
  ['$\\mu$', 'μ'],
  ['Standardavvik $\\sigma$', 'Standardavvik σ'],
  ['$\\bar{x}$', 'x̄'],
  ['Estimator $\\hat{p}$ for andel', 'Estimator p̂ for andel'],
  ['$x^2$', 'x²'],
  ['$x^{-1}$', 'x⁻¹'],
  ['$a_n$', 'aₙ'],
  ['$\\sum_{i=1}^{n} x_i$', 'Σᵢ₌₁ⁿ xᵢ'],
  ['$a \\cdot b$', 'a · b'],
  ['$x \\le 5$ og $y \\ge 2$', 'x ≤ 5 og y ≥ 2'],
  ['$\\int_a^b f(x)\\,dx$', '∫ₐᵇ f(x) dx'],
  ['$\\sqrt{x}$', '√x'],
  ['$\\sqrt{x+1}$', '√(x+1)'],
  ['$0{,}05$', '0,05'],
  ['$10\\,000$ kr', '10 000 kr'],
  ['$N(\\mu;\\sigma)$', 'N(μ;σ)'],
  ['$P(A \\mid B)$', 'P(A | B)'],
  ['$f\'(x)$', 'f′(x)'],
  ['$\\frac{a}{b}$', 'a/b'],
  ['$\\frac{a+b}{2}$', '(a+b)/2'],
  ['$x_{\\text{ny}}$', 'x_(ny)'],
  ['$\\mathbb{R}$', 'ℝ'],
  ['$\\left( x \\right)$', '( x )'],
  ['Bruk `=MIDDEL(A1:A5)` i Excel', 'Bruk =MIDDEL(A1:A5) i Excel'],
  ['`$x$` er kode', '$x$ er kode'],
  ['Utan formel, 5 $ og meir', 'Utan formel, 5 $ og meir'],
  ['$$\\sum x^2$$', 'Σ x²'],
  ['$\\unknowncmd{y}$', 'unknowncmd y'.replace(' ', '')],
];
for (const [src, want] of cases) test(`texLabel ${src}`, () => assert.equal(texLabel(src), want));

test('texLabel leaves no $, backslash or braces for typical names', () => {
  for (const s of ['$\\hat{p} \\pm 1{,}96\\sqrt{\\frac{\\hat{p}(1-\\hat{p})}{n}}$', '$\\lim_{x \\to \\infty} \\frac{1}{x}$', '$\\overline{AB}^2$']) {
    assert.doesNotMatch(texLabel(s), /[$\\{}]/, texLabel(s));
  }
});

test('segments splits text, code, inline and display math', () => {
  assert.deepEqual(segments('a $x$ b $$y$$ c `z`'), [
    { kind: 'text', src: 'a ' }, { kind: 'inline', src: 'x' }, { kind: 'text', src: ' b ' },
    { kind: 'display', src: 'y' }, { kind: 'text', src: ' c ' }, { kind: 'code', src: 'z' },
  ]);
  assert.deepEqual(segments('<b>x</b>'), [{ kind: 'text', src: '<b>x</b>' }]);
  assert.deepEqual(segments('lone $ sign'), [{ kind: 'text', src: 'lone $ sign' }]);
  assert.deepEqual(segments(null), []);
});
