import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
  buildTxUri,
  isQrTooLarge,
  renderSep7StellarToml,
  SEP7_MSG_MAX_LENGTH,
  SEP7_URI_PREFIX,
  sep7Payload,
  verifyTxUri,
} from '../src/services/sep7.service';
import { createWellKnownRouter } from '../src/routes/well-known.routes';

describe('SEP-7 URI builder, verifier, and stellar.toml (#270)', () => {
  const signingKey = Keypair.random();
  const signerPub = Keypair.random().publicKey();

  it('sep7Payload prepends 35 zero bytes, 0x04, and stellar.sep.7 scheme prefix', () => {
    const uri = 'web+stellar:tx?xdr=AAAA';
    const payload = sep7Payload(uri);
    assert.deepEqual(payload.subarray(0, 35), Buffer.alloc(35, 0));
    assert.equal(payload[35], 0x04);
    const rest = payload.subarray(36).toString('utf8');
    assert.equal(rest, `${SEP7_URI_PREFIX}${uri}`);
  });

  it('buildTxUri verifies with verifyTxUri and fails after any parameter mutation', () => {
    const uri = buildTxUri(
      {
        xdr: 'AAAAAgAAAABtestXdrPayload==',
        callback: 'https://api.oracledesk.test/sep7/callback/token123',
        pubkey: signerPub,
        msg: 'Pause treasury',
        networkPassphrase: Networks.TESTNET,
        originDomain: 'oracledesk.test',
      },
      signingKey,
    );

    assert.ok(uri.startsWith('web+stellar:tx?xdr='));
    assert.ok(uri.includes('&callback=url%3Ahttps%3A%2F%2Fapi.oracledesk.test%2Fsep7%2Fcallback%2Ftoken123'));
    assert.ok(uri.includes(`&pubkey=${signerPub}`));
    assert.ok(uri.includes('&origin_domain=oracledesk.test&signature='));
    assert.equal(verifyTxUri(uri, signingKey.publicKey()), true);

    // Mutating any parameter breaks the signature.
    const tampered = uri.replace('Pause%20treasury', 'Unpause%20treasury');
    assert.equal(verifyTxUri(tampered, signingKey.publicKey()), false);
    assert.equal(verifyTxUri(uri, Keypair.random().publicKey()), false);
  });

  it('truncates msg to 300 characters before URL encoding', () => {
    const longMsg = 'A'.repeat(450);
    const uri = buildTxUri(
      {
        xdr: 'AAAA',
        callback: 'https://api.oracledesk.test/sep7/callback/tok',
        pubkey: signerPub,
        msg: longMsg,
        networkPassphrase: Networks.TESTNET,
        originDomain: 'oracledesk.test',
      },
      signingKey,
    );
    const match = /&msg=([^&]+)&/.exec(uri);
    assert.ok(match);
    assert.equal(decodeURIComponent(match[1]).length, SEP7_MSG_MAX_LENGTH);
    assert.equal(verifyTxUri(uri, signingKey.publicKey()), true);
  });

  it('flags URIs larger than 2900 bytes with isQrTooLarge', () => {
    assert.equal(isQrTooLarge('web+stellar:tx?xdr=short'), false);
    assert.equal(isQrTooLarge(`web+stellar:tx?xdr=${'A'.repeat(3000)}`), true);
  });

  it('stellar.toml serves URI_REQUEST_SIGNING_KEY matching the secret and 404s when unset', async () => {
    const toml = renderSep7StellarToml(Networks.TESTNET, signingKey.secret());
    assert.match(toml, /NETWORK_PASSPHRASE="Test SDF Network ; September 2015"/);
    assert.match(toml, new RegExp(`URI_REQUEST_SIGNING_KEY="${signingKey.publicKey()}"`));

    const appWithKey = express();
    appWithKey.use('/.well-known', createWellKnownRouter(() => signingKey.secret()));
    const server1 = http.createServer(appWithKey);
    await new Promise<void>((r) => server1.listen(0, '127.0.0.1', r));
    const port1 = (server1.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port1}/.well-known/stellar.toml`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      const body = await res.text();
      assert.ok(body.includes(`URI_REQUEST_SIGNING_KEY="${signingKey.publicKey()}"`));
    } finally {
      server1.close();
    }

    const appWithoutKey = express();
    appWithoutKey.use('/.well-known', createWellKnownRouter(() => ''));
    const server2 = http.createServer(appWithoutKey);
    await new Promise<void>((r) => server2.listen(0, '127.0.0.1', r));
    const port2 = (server2.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port2}/.well-known/stellar.toml`);
      assert.equal(res.status, 404);
    } finally {
      server2.close();
    }
  });
});
