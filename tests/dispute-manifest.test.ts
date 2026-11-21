import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, sha256Hex } from '../src/utils/hash.util';

test('dispute evidence manifest excludes decision-only citation flags', () => {
  const items = [{ id: 'e1', source: 'FRED', content: 'value', cited: true }];
  const withoutDecision = items.map(({ cited: _cited, ...item }) => item);
  const a = sha256Hex(canonicalJson({ items: withoutDecision }));
  items[0].cited = false;
  const b = sha256Hex(canonicalJson({ items: items.map(({ cited: _cited, ...item }) => item) }));
  assert.equal(a, b);
});
