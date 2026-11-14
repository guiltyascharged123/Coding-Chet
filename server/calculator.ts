type Rational = { n: bigint; d: bigint };
const fraction = (n: bigint, d: bigint): Rational => {
  if (d === 0n) throw new Error('Division by zero.');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = n < 0n ? -n : n,
    b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / a, d: d / a };
};

/** A bounded exact-arithmetic tool. Never evaluates JavaScript or executes code. */
export function calculate(expression: string) {
  if (!expression.trim() || expression.length > 160)
    throw new Error('Use an arithmetic expression of 1–160 characters.');
  const source = expression.replace(/[−–]/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
  const tokens: string[] = [];
  const token = /\s*(\d+(?:\.\d*)?|\.\d+|[()+*/-])/y;
  let offset = 0;
  while (offset < source.length) {
    if (!source.slice(offset).trim()) break;
    token.lastIndex = offset;
    const match = token.exec(source);
    if (!match) throw new Error('Only numbers, parentheses and + - * / are supported.');
    tokens.push(match[1]);
    offset = token.lastIndex;
  }
  let cursor = 0;
  const atom = (depth: number): Rational => {
    if (depth > 20) throw new Error('Parentheses or unary operators are too deeply nested.');
    const next = tokens[cursor++];
    if (next === '+' || next === '-') {
      const value = atom(depth + 1);
      return { n: next === '-' ? -value.n : value.n, d: value.d };
    }
    if (next === '(') {
      const value = sum(depth + 1);
      if (tokens[cursor++] !== ')') throw new Error('Missing closing parenthesis.');
      return value;
    }
    if (!next || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(next)) throw new Error('Expected a number.');
    if (next.replace('.', '').length > 18) throw new Error('Use at most 18 digits per number.');
    const [whole, decimal = ''] = next.split('.');
    return fraction(BigInt((whole || '0') + decimal), 10n ** BigInt(decimal.length));
  };
  const product = (depth: number): Rational => {
    let value = atom(depth);
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const op = tokens[cursor++],
        rhs = atom(depth);
      value =
        op === '*'
          ? fraction(value.n * rhs.n, value.d * rhs.d)
          : fraction(value.n * rhs.d, value.d * rhs.n);
    }
    return value;
  };
  const sum = (depth: number): Rational => {
    let value = product(depth);
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const op = tokens[cursor++],
        rhs = product(depth);
      value = fraction(value.n * rhs.d + (op === '+' ? rhs.n : -rhs.n) * value.d, value.d * rhs.d);
    }
    return value;
  };
  const result = sum(0);
  if (cursor !== tokens.length) throw new Error('Unexpected trailing input.');
  const exact = result.d === 1n ? String(result.n) : `${result.n}/${result.d}`;
  return {
    expression,
    exact,
    approximate: Number(result.n) / Number(result.d),
    provenance:
      'Computed by the app with exact rational arithmetic; no model inference or external action.',
  };
}
