import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../server/calculator.js';

test('calculator preserves exact decimals, fractions, signs and arithmetic precedence', () => {
  for (const [expression, exact] of [
    ['0.1 + 0.2', '3/10'],
    ['35 - 20', '15'],
    ['-(2+3)*4/3', '-20/3'],
    ['2 + 3 × 4', '14'],
    ['.5÷.25', '2'],
    ['0/7', '0'],
  ])
    assert.equal(calculate(expression).exact, exact);
});
test('calculator rejects code, malformed expressions, zero division and excessive input', () => {
  for (const expression of [
    '',
    'process.exit()',
    '1;2',
    '1e20',
    '1/0',
    '(2+3',
    '2 3',
    '2**3',
    '9'.repeat(19),
    '('.repeat(21) + '1' + ')'.repeat(21),
    '1+'.repeat(81),
  ])
    assert.throws(() => calculate(expression));
});
