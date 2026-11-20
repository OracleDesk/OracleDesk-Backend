import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { cidForBytes } from '../src/services/ipfs.service';
import { fetchVerified, GatewayHealthTracker, verifyGatewayBytes } from '../src/services/ipfs/gateways';

describe('IPFS health-scored hedged gateways (#271)', () => {
  it('hedged second gateway wins when the first is slow', async () => {
    const payload = Buffer.from(JSON.stringify({ ok: true, hedged: 1 }), 'utf8');
    const cid = cidForBytes(payload);

    const slowServer = http.createServer((_req, res) => {
      const t = setTimeout(() => {
        res.writeHead(200);
        res.end(payload);
      }, 2000);
      res.on('close', () => clearTimeout(t));
    });
    const fastServer = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end(payload);
    });

    await new Promise<void>((r) => slowServer.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => fastServer.listen(0, '127.0.0.1', r));
    const p1 = (slowServer.address() as { port: number }).port;
    const p2 = (fastServer.address() as { port: number }).port;

    try {
      const tracker = new GatewayHealthTracker();
      const result = await fetchVerified(cid, {
        gateways: [`http://127.0.0.1:${p1}`, `http://127.0.0.1:${p2}`],
        hedgeDelayMs: 40,
        tracker,
      });
      assert.equal(result.gateway, `http://127.0.0.1:${p2}`);
      assert.deepEqual(result.bytes, payload);
    } finally {
      slowServer.close();
      fastServer.close();
    }
  });

  it('bytes failing CID verification are rejected and the gateway penalised', async () => {
    const good = Buffer.from('{"valid":true}', 'utf8');
    const bad = Buffer.from('<html>502 Bad Gateway</html>', 'utf8');
    const cid = cidForBytes(good);

    assert.equal(verifyGatewayBytes(cid, good), true);
    assert.equal(verifyGatewayBytes(cid, bad), false);

    const badServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(bad);
    });
    const goodServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(good);
    });

    await new Promise<void>((r) => badServer.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => goodServer.listen(0, '127.0.0.1', r));
    const pBad = (badServer.address() as { port: number }).port;
    const pGood = (goodServer.address() as { port: number }).port;

    try {
      const tracker = new GatewayHealthTracker();
      const badGw = `http://127.0.0.1:${pBad}`;
      const goodGw = `http://127.0.0.1:${pGood}`;
      const result = await fetchVerified(cid, {
        gateways: [badGw, goodGw],
        hedgeDelayMs: 50,
        tracker,
      });
      assert.equal(result.gateway, goodGw);
      assert.deepEqual(result.bytes, good);
      assert.ok(tracker.score(goodGw) > tracker.score(badGw));
    } finally {
      badServer.close();
      goodServer.close();
    }
  });

  it('maxBytes rejects an oversized body', async () => {
    const big = Buffer.alloc(1024, 0x41);
    const cid = cidForBytes(big);
    const hash = crypto.createHash('sha256').update(big).digest('hex');

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-length': String(big.length) });
      res.end(big);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    try {
      await assert.rejects(
        () => fetchVerified(cid, { expectedSha256: hash, maxBytes: 128, gateways: [`http://127.0.0.1:${port}`] }),
        /Could not retrieve verified content/,
      );
    } finally {
      server.close();
    }
  });
});
