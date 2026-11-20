import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
  ensureSigningKeyRegistered,
  retireSigningKey,
  signingKeyStatus,
} from '../src/services/agent-signing-key.service';
import { keyBindMessage, traceSigner, verifyTraceSignatureLocal } from '../src/lib/trace-signing';

describe('agent signing key registration and rotation (#273)', () => {
  const registry = 'CAFEED35XICK4OXIEXQDS6KTTBUA2LDNW3EXEUGTNMN54DY5ANETCH6M';
  const agent = Keypair.random().publicKey();
  const key1 = Keypair.random();
  const key2 = Keypair.random();

  it('registers idempotently, supports prepare mode, and preserves historic signatures across rotation', async () => {
    const activeKeys = new Set<string>();
    const keyToAgent = new Map<string, string>();
    let submitCalls = 0;

    const baseDeps = {
      agentAddress: agent,
      registryId: registry,
      networkPassphrase: Networks.TESTNET,
      isAgentActive: async () => true,
      getSigningKeys: async () => [...activeKeys],
      getKeyAgent: async (pk: string) => keyToAgent.get(pk) ?? null,
      getHistory: async () => [],
      submitAddKey: async ({ publicKey, proofSig }: { agent: string; publicKey: Buffer; proofSig: Buffer }) => {
        submitCalls += 1;
        const msg = keyBindMessage({ networkPassphrase: Networks.TESTNET, registry, agent, publicKey });
        assert.equal(verifyTraceSignatureLocal(publicKey.toString('hex'), msg, proofSig), true);
        activeKeys.add(publicKey.toString('hex'));
        keyToAgent.set(publicKey.toString('hex'), agent);
        return { txHash: `tx-${submitCalls}` };
      },
      prepareAddKey: async () => ({ xdr: 'AAAAAg==prepared' }),
      submitRetireKey: async ({ publicKey }: { agent: string; publicKey: Buffer }) => {
        activeKeys.delete(publicKey.toString('hex'));
        return { txHash: 'tx-retire' };
      },
    };

    // Prepare mode returns unsigned XDR before submitting.
    const prepared = await ensureSigningKeyRegistered({ mode: 'prepare' }, { ...baseDeps, overrideSeed: key1.secret() });
    assert.equal(prepared.xdr, 'AAAAAg==prepared');

    // Submit mode registers key1; second call is idempotent.
    const reg1 = await ensureSigningKeyRegistered({ mode: 'submit' }, { ...baseDeps, overrideSeed: key1.secret() });
    assert.equal(reg1.txHash, 'tx-1');
    const reg1Again = await ensureSigningKeyRegistered({ mode: 'submit' }, { ...baseDeps, overrideSeed: key1.secret() });
    assert.equal(reg1Again.alreadyActive, true);
    assert.equal(submitCalls, 1);

    // Rotation: register key2 while key1 is active, then retire key1.
    const reg2 = await ensureSigningKeyRegistered({ mode: 'submit' }, { ...baseDeps, overrideSeed: key2.secret() });
    assert.equal(reg2.txHash, 'tx-2');
    await retireSigningKey(traceSigner(key1.secret()).publicKeyHex, { mode: 'submit' }, baseDeps);

    const statusOld = await signingKeyStatus({ ...baseDeps, overrideSeed: key1.secret() });
    const statusNew = await signingKeyStatus({ ...baseDeps, overrideSeed: key2.secret() });
    assert.equal(statusOld.ours, 'RETIRED');
    assert.equal(statusNew.ours, 'ACTIVE');
    // KeyToAgent binding remains intact for historic verification, and re-adding retired key is rejected.
    assert.equal(keyToAgent.get(traceSigner(key1.secret()).publicKeyHex), agent);
    await assert.rejects(
      () => ensureSigningKeyRegistered({ mode: 'submit' }, { ...baseDeps, overrideSeed: key1.secret() }),
      (err: any) => err?.code === 'KEY_ALREADY_BOUND',
    );
  });
});
