/**
 * Tests for scenario templates and annotation parsing. Run with:
 *   node --import tsx --test src/lib/templates.test.ts
 *
 * Covers the pure annotation grammar, the built-in mortgage template's
 * end-to-end metadata, template path instantiation, and the region ->
 * currency mapping used by money formatting.
 */

import {
  BUILT_IN_TEMPLATES,
  parseAnnotations,
  instantiateTemplate,
} from './templates';
import { regionToCurrency } from './format';

let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// ---------------------------------------------------------------------------
// parseAnnotations — annotation grammar
// ---------------------------------------------------------------------------

const basic = parseAnnotations(
  [
    '# @money', // line 1
    '# ordinary comment', // line 2
    '', // line 3
    '# @input principal', // line 4
    'loan = 100', // line 5  <- input
    '# @result total', // line 6
    'total = loan * 2', // line 7  <- result
    '# @input rate', // line 8
    'rate = 5%', // line 9  <- input
  ].join('\n'),
);

check('detects # @money', basic.money, true);
check('records input lines (1-based, ascending)', basic.inputs, [5, 9]);
check('records result lines (1-based, ascending)', basic.results, [7]);
check('firstInputLine is the first input line', basic.firstInputLine, 5);

// Ordinary comments / blanks never produce annotations.
const noMarkers = parseAnnotations(
  ['# just a heading', '', 'x = 1', '# another note', 'y = 2'].join('\n'),
);
check('ordinary comments and blanks are ignored', noMarkers, {
  money: false,
  inputs: [],
  results: [],
  firstInputLine: null,
});

// A trailing marker with no following line is ignored.
const trailing = parseAnnotations('# @input dangling');
check('trailing marker without a following line is ignored', trailing, {
  money: false,
  inputs: [],
  results: [],
  firstInputLine: null,
});

// `@inputfoo` must not be mistaken for `@input`.
const notMarker = parseAnnotations('# @inputfoo\nx = 1');
check('@inputfoo is not an @input marker', notMarker.inputs, []);

// ---------------------------------------------------------------------------
// Built-in mortgage template — end-to-end metadata
// ---------------------------------------------------------------------------

const mortgage = BUILT_IN_TEMPLATES.find((t) => t.id === 'mortgage')!;
check('built-in mortgage template exists', mortgage !== undefined, true);
check('exactly one built-in template in v1', BUILT_IN_TEMPLATES.length, 1);

const annotations = parseAnnotations(mortgage.content);
check('mortgage has @money', annotations.money, true);
check('mortgage has 3 inputs', annotations.inputs.length, 3);
check('mortgage has 7 results', annotations.results.length, 7);

const loanLine = mortgage.content.split('\n').indexOf('loan = 3000000') + 1;
check(
  'firstInputLine points at the loan assignment line',
  annotations.firstInputLine,
  loanLine,
);

// ---------------------------------------------------------------------------
// instantiateTemplate
// ---------------------------------------------------------------------------

check(
  'empty workspace instantiates <name>-1.numr',
  instantiateTemplate(mortgage, []),
  { path: '房贷计算器-1.numr', displayName: '房贷计算器-1' },
);

check(
  'existing -1 path instantiates <name>-2.numr',
  instantiateTemplate(mortgage, ['房贷计算器-1.numr']),
  { path: '房贷计算器-2.numr', displayName: '房贷计算器-2' },
);

check(
  'collisions skip to the first free index',
  instantiateTemplate(mortgage, ['房贷计算器-1.numr', '房贷计算器-2.numr']),
  { path: '房贷计算器-3.numr', displayName: '房贷计算器-3' },
);

// ---------------------------------------------------------------------------
// regionToCurrency
// ---------------------------------------------------------------------------

check('zh-CN maps to CNY', regionToCurrency('zh-CN'), 'CNY');
check('en-US maps to USD', regionToCurrency('en-US'), 'USD');
check(
  'system maps to a non-empty currency code',
  typeof regionToCurrency('system') === 'string' &&
    regionToCurrency('system').length > 0,
  true,
);

if (failed > 0) {
  console.log(`\n${failed} case(s) failed`);
  process.exit(1);
} else {
  console.log('\nall cases passed');
}
