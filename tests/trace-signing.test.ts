import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
  KEY_BIND_DOMAIN,
  keyBindMessage,
  parseTraceSigningSeed,
  TRACE_ATTESTATION_DOMAIN,
  traceAttestationMessage,
  traceSigner,
  verifyTraceSignatureLocal,
  type ChainTraceAction,
} from '../src/lib/trace-signing';
import { ConfigError, loadConfig } from '../src/config';

describe('trace Ed25519 domain-separated signing (#273)', () => {
  const registry = 'CAFEED35XICK4OXIEXQDS6KTTBUA2LDNW3EXEUGTNMN54DY5ANETCH6M';
  const agent = Keypair.random().publicKey();
  const seedKey = Keypair.random();

  it('builds deterministic keyBindMessage and verifies proof-of-possession signature', () => {
    const signer = traceSigner(seedKey.secret());
    const msg = keyBindMessage({
      networkPassphrase: Networks.TESTNET,
      registry,
      agent,
      publicKey: signer.publicKey,
    });

    assert.equal(msg.subarray(0, KEY_BIND_DOMAIN.length).toString('utf8'), KEY_BIND_DOMAIN);
    assert.deepEqual(msg.subarray(msg.length - 32), signer.publicKey);

    const sig = signer.sign(msg);
    assert.equal(verifyTraceSignatureLocal(signer.publicKeyHex, msg, sig), true);
    assert.equal(verifyTraceSignatureLocal(signer.publicKeyHex, Buffer.concat([msg, Buffer.from([1])]), sig), false);
  });

  it('builds and verifies traceAttestationMessage for every action variant including Other', () => {
    const signer = traceSigner(seedKey.secret());
    const traceHash = crypto.createHash('sha256').update('canonical-trace-json').digest();
    const actions: ChainTraceAction[] = [
      { kind: 'CreateMarket' },
      { kind: 'ProposeMarket' },
      { kind: 'Buy' },
      { kind: 'Sell' },
      { kind: 'Skip' },
      { kind: 'Redeem' },
      { kind: 'ClaimRemainder' },
      { kind: 'Resolve' },
      { kind: 'Other', symbol: 'custom_act' },
    ];

    const seen = new Set<string>();
    for (const action of actions) {
      const msg = traceAttestationMessage({
        networkPassphrase: Networks.TESTNET,
        registry,
        agent,
        marketId: 42n,
        action,
        traceHash,
      });
      assert.equal(msg.subarray(0, TRACE_ATTESTATION_DOMAIN.length).toString('utf8'), TRACE_ATTESTATION_DOMAIN);
      const hex = msg.toString('hex');
      assert.equal(seen.has(hex), false);
      seen.add(hex);

      const sig = signer.sign(msg);
      assert.equal(verifyTraceSignatureLocal(signer.publicKeyHex, msg, sig), true);
    }
  });

  it('supports both S... secret seed and 64-char hex seed formats', () => {
    const rawHex = Buffer.from(seedKey.rawSecretKey()).toString('hex');
    assert.deepEqual(parseTraceSigningSeed(seedKey.secret()), parseTraceSigningSeed(rawHex));
    assert.equal(traceSigner(seedKey.secret()).publicKeyHex, traceSigner(rawHex).publicKeyHex);
  });

  it('rejects TRACE_SIGNING_KEY matching AGENT_SECRET_KEY or AUTH_SIGNING_SECRET in config', () => {
    const shared = Keypair.random().secret();
    const baseEnv: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      NODE_ENV: 'test',
    };
    assert.throws(
      () => loadConfig({ ...baseEnv, AGENT_SECRET_KEY: shared, TRACE_SIGNING_KEY: shared }),
      ConfigError,
    );
    assert.throws(
      () => loadConfig({ ...baseEnv, AUTH_SIGNING_SECRET: shared, TRACE_SIGNING_KEY: shared }),
      ConfigError,
    );
  });
});
