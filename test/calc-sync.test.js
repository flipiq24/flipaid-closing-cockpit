// Drift guard for the DUPLICATED calc engine.
//
// computeIA() lives in TWO places: src/calc.js (the canonical, test-covered ES module) and an inline
// copy in index.html (what the browser actually runs — index.html has no build step). The Golden Test
// only exercises src/calc.js, so without this guard the two could drift and the app could be wrong
// while the tests stay green. This test extracts both function bodies, normalizes away formatting and
// the few environment-only lines, and asserts they are otherwise identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Extract a function body by brace-matching from the first line matching `startRe`.
function extractFn(src, startRe) {
  const lines = src.split('\n');
  let i = lines.findIndex(l => startRe.test(l));
  assert.ok(i >= 0, 'computeIA definition not found');
  let depth = 0, started = false, out = [];
  for (; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    out.push(lines[i]);
    if (started && depth === 0) break;
  }
  return out.join('\n');
}

// Strip comments + all whitespace so indentation/operator-spacing differences don't matter.
const strip = s => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');

// The ONLY sanctioned differences between the module and the inline copy are environment plumbing:
// the module defaults taxInputs to {}, while the browser copy falls back to the global D.taxInputs
// and carries one unused legacy local. Everything else must match to the character.
const ENV_ONLY = [
  '={}',                                             // module `taxInputs={}` default (also `const r={}` in both — symmetric)
  'if(taxInputs==null)taxInputs=D.taxInputs;',       // inline: browser global fallback
  "constresaleMode=(i.mode||'')==='Sold';",          // inline: unused legacy local
];
const canonical = body => {
  let s = strip(body);
  for (const frag of ENV_ONLY) s = s.split(frag).join('');
  return s;
};

test('inline index.html computeIA is in sync with src/calc.js', () => {
  const mod = extractFn(readFileSync(new URL('../src/calc.js', import.meta.url), 'utf8'), /export function computeIA/).replace(/^export\s+/, '');
  const inline = extractFn(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /^function computeIA\(/m);
  assert.equal(canonical(mod), canonical(inline),
    'computeIA drifted between src/calc.js and index.html. Update BOTH copies, or reduce to a single source.');
});
