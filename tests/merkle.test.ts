import test from 'node:test';
import assert from 'node:assert/strict';
import { merkleProof, merkleRoot, verifyMerkleInclusion } from '../src/lib/merkle';

test('merkle tree promotes an odd final node and verifies proofs', () => {
  const leaves = ['00'.repeat(32), '11'.repeat(32), '22'.repeat(32), '33'.repeat(32), '44'.repeat(32)];
  const root = merkleRoot(leaves);
  for (let i = 0; i < leaves.length; i += 1) assert.equal(verifyMerkleInclusion(leaves[i], i, merkleProof(leaves, i), root), true);
});
