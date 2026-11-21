import { createHash } from 'node:crypto';

const hash = (prefix: number, ...parts: Buffer[]) => createHash('sha256').update(Buffer.from([prefix])).update(Buffer.concat(parts)).digest();

export function merkleRoot(traceHashes: readonly (Buffer | string)[]): Buffer {
  if (traceHashes.length === 0 || traceHashes.length > 4096) throw new Error('leaf count must be between 1 and 4096');
  let level = traceHashes.map((value) => hash(0, typeof value === 'string' ? Buffer.from(value, 'hex') : value));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hash(1, level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

export interface MerkleProofStep { sibling: Buffer; siblingOnLeft: boolean }

export function merkleProof(traceHashes: readonly (Buffer | string)[], index: number): MerkleProofStep[] {
  if (index < 0 || index >= traceHashes.length) throw new Error('leaf index out of range');
  let level = traceHashes.map((value) => hash(0, typeof value === 'string' ? Buffer.from(value, 'hex') : value));
  const proof: MerkleProofStep[] = [];
  let position = index;
  while (level.length > 1) {
    const sibling = position % 2 === 0 ? position + 1 : position - 1;
    if (sibling < level.length) proof.push({ sibling: level[sibling], siblingOnLeft: position % 2 === 1 });
    else proof.push({ sibling: Buffer.alloc(0), siblingOnLeft: false });
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hash(1, level[i], level[i + 1]) : level[i]);
    level = next;
    position = Math.floor(position / 2);
  }
  return proof;
}

export function verifyMerkleInclusion(traceHash: Buffer | string, index: number, proof: readonly MerkleProofStep[], root: Buffer | string): boolean {
  let current = hash(0, typeof traceHash === 'string' ? Buffer.from(traceHash, 'hex') : traceHash);
  let position = index;
  for (const step of proof) {
    if (step.sibling.length > 0) current = step.siblingOnLeft ? hash(1, step.sibling, current) : hash(1, current, step.sibling);
    position = Math.floor(position / 2);
  }
  const expected = typeof root === 'string' ? Buffer.from(root, 'hex') : root;
  return current.equals(expected);
}
