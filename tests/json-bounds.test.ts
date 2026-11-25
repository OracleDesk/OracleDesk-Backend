import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJsonBounded, JsonBoundsError } from '../src/utils/hash.util';

test('bounds deep JSON before canonicalisation', () => {
  let value: unknown = 1;
  for (let i = 0; i < 70; i++) value = { value };
  assert.throws(() => canonicalJsonBounded(value), JsonBoundsError);
});

test('bounds encoded JSON size', () => {
  assert.throws(() => canonicalJsonBounded({ payload: 'x'.repeat(100) }, { maxBytes: 20 }), JsonBoundsError);
});
