import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cidForBytes, pinJson, setIpfsTransport } from '../src/services/ipfs.service';
import { setPinProvidersForTests, type PinProvider } from '../src/services/ipfs/providers';

describe('IPFS pin replication and single-block CID verification (#271)', () => {
  it('oversized document is rejected with 413', async () => {
    const huge = { blob: 'x'.repeat(300_000) };
    await assert.rejects(
      () => pinJson(huge, 'oversized-test'),
      (err: any) => err?.statusCode === 413 && err?.code === 'IPFS_DOCUMENT_TOO_LARGE',
    );
  });

  it('CID mismatch from provider fails with IPFS_CID_MISMATCH', async () => {
    const prev = setIpfsTransport({
      async pin() {
        return 'bafkreiwrongcid000000000000000000000000000000000000000000000';
      },
      async fetch() {
        return Buffer.alloc(0);
      },
    });
    const fakeProvider: PinProvider = {
      name: 'pinata',
      async pin() {
        return 'bafkreiwrongcid000000000000000000000000000000000000000000000';
      },
      async status() {
        return 'missing';
      },
    };
    setPinProvidersForTests([fakeProvider]);
    try {
      await assert.rejects(
        () => pinJson({ hello: 'world' }, 'mismatch-test'),
        (err: any) => err?.statusCode === 502 && err?.code === 'IPFS_CID_MISMATCH',
      );
    } finally {
      setPinProvidersForTests(null);
      setIpfsTransport(prev);
    }
  });

  it('pinJson verifies exact CID and replicates across configured providers', async () => {
    const pinnedBy: string[] = [];
    const p1: PinProvider = {
      name: 'pinata',
      async pin(bytes) {
        pinnedBy.push('pinata');
        return cidForBytes(bytes);
      },
      async status() {
        return 'pinned';
      },
    };
    const p2: PinProvider = {
      name: 'kubo',
      async pin(bytes) {
        pinnedBy.push('kubo');
        return cidForBytes(bytes);
      },
      async status() {
        return 'pinned';
      },
    };
    setPinProvidersForTests([p1, p2]);
    try {
      const result = await pinJson({ a: 1, b: 2 }, 'replicated-test');
      assert.equal(result.cid, cidForBytes(result.bytes));
      assert.deepEqual(pinnedBy, ['pinata', 'kubo']);
      assert.equal(result.replicas?.pinata, 'PINNED');
      assert.equal(result.replicas?.kubo, 'PINNED');
    } finally {
      setPinProvidersForTests(null);
    }
  });
});
