import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const prodOpts = { production: true, allowHttp: false, resolver: publicResolver };
const devHttpOpts = { production: false, allowHttp: true, resolver: publicResolver };

// ─── Signing ────────────────────────────────────────────────────────────────

test('signature verifies with the reference verifier; tampered body or stale timestamp fails', async () => {
  const { signatureHeader, verifyWebhookSignature } = await import('../src/services/webhooks.service');
  const body = Buffer.from('{"id":"trade.executed:1","type":"trade.executed"}');
  const now = 1_760_000_000;
  const header = signatureHeader(['whsec_a'], now, body);
  assert.match(header, /^t=1760000000,v1=[0-9a-f]{64}$/);

  assert.equal(verifyWebhookSignature(body, header, ['whsec_a'], 300, now), true);
  assert.equal(verifyWebhookSignature(Buffer.from(body.toString() + ' '), header, ['whsec_a'], 300, now), false, 'tampered body');
  assert.equal(verifyWebhookSignature(body, header, ['whsec_b'], 300, now), false, 'wrong secret');
  assert.equal(verifyWebhookSignature(body, header, ['whsec_a'], 300, now + 301), false, 'stale timestamp');
  assert.equal(verifyWebhookSignature(body, 'v1=deadbeef', ['whsec_a'], 300, now), false, 'missing timestamp');
});

test('during rotation both signatures are sent and either secret verifies', async () => {
  const { signatureHeader, signingSecrets, verifyWebhookSignature, encryptSecret, decryptSecret } = await import('../src/services/webhooks.service');
  const now = new Date('2026-10-17T12:00:00Z');
  const sub = {
    secret: encryptSecret('whsec_new'),
    previousSecret: encryptSecret('whsec_old'),
    secretRotatedAt: new Date(now.getTime() - 60 * 60_000),
  };
  const secrets = signingSecrets(sub, now);
  assert.deepEqual(secrets, ['whsec_new', 'whsec_old']);
  const t = Math.floor(now.getTime() / 1000);
  const header = signatureHeader(secrets, t, 'x');
  assert.equal(header.split(',').filter((p) => p.startsWith('v1=')).length, 2);
  assert.equal(verifyWebhookSignature('x', header, ['whsec_old'], 300, t), true);
  assert.equal(verifyWebhookSignature('x', header, ['whsec_new'], 300, t), true);

  const afterOverlap = new Date(now.getTime() + 24 * 60 * 60_000);
  assert.deepEqual(signingSecrets(sub, afterOverlap), ['whsec_new'], 'old secret dropped after 24 h');
  assert.equal(decryptSecret(sub.secret), 'whsec_new');
});

test('secrets are encrypted at rest with AES-256-GCM and tamper-evident', async () => {
  const { encryptSecret, decryptSecret } = await import('../src/services/webhooks.service');
  const enc = encryptSecret('whsec_abc');
  assert.ok(!enc.includes('whsec_abc'));
  assert.notEqual(enc, encryptSecret('whsec_abc'), 'random IV');
  const [iv, tag, data] = enc.split('.');
  const flipped = Buffer.from(data, 'base64');
  flipped[0] ^= 1;
  assert.throws(() => decryptSecret([iv, tag, flipped.toString('base64')].join('.')));
});

// ─── SSRF guard ─────────────────────────────────────────────────────────────

test('isBlockedAddress covers private, loopback, link-local, metadata and mapped ranges', async () => {
  const { isBlockedAddress } = await import('../src/lib/ssrf-guard');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('assertSafeUrl rejects unsafe URLs', async () => {
  const { assertSafeUrl, SsrfError } = await import('../src/lib/ssrf-guard');
  const rejects = (url: string, opts: any, re: RegExp) => assert.rejects(assertSafeUrl(url, opts), (e: unknown) => e instanceof SsrfError && re.test(e.message));

  await rejects('http://example.com/hook', prodOpts, /must use https/);
  await rejects('http://example.com/hook', { ...devHttpOpts, allowHttp: false }, /must use https/);
  await rejects('https://user:pw@example.com/hook', prodOpts, /credentials/);
  await rejects('https://example.com:6379/hook', prodOpts, /port/);
  await rejects('https://169.254.169.254/latest/meta-data', prodOpts, /disallowed address/);
  await rejects('https://127.0.0.1/hook', prodOpts, /disallowed/);
  await rejects('https://2130706433/hook', prodOpts, /disallowed/); // decimal 127.0.0.1
  await rejects('https://0x7f.1/hook', prodOpts, /disallowed/); // hex alias
  await rejects('https://[::ffff:127.0.0.1]/hook', prodOpts, /disallowed/); // IPv4-mapped IPv6
  await rejects('https://[::1]/hook', prodOpts, /disallowed/);
  // A public-looking hostname that resolves (even partly) to a private address.
  await rejects('https://internal.example/hook', { ...prodOpts, resolver: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }] }, /disallowed address \(10\.0\.0\.5\)/);
  await rejects('https://nx.example/hook', { ...prodOpts, resolver: async () => { throw new Error('ENOTFOUND'); } }, /Could not resolve/);

  const ok = await assertSafeUrl('https://hooks.example.com/oracledesk', prodOpts);
  assert.equal(ok.hostname, 'hooks.example.com');
  assert.ok(await assertSafeUrl('http://localhost.example/hook', devHttpOpts), 'http allowed outside production when opted in');
});

test('pinned lookup answers with the validated IP even if DNS now says otherwise (rebinding)', async () => {
  const { resolveSafeTarget, pinnedLookup } = await import('../src/lib/ssrf-guard');
  let calls = 0;
  const rebinding = async () => (calls++ === 0 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
  const target = await resolveSafeTarget('https://rebind.example/hook', { ...prodOpts, resolver: rebinding });
  assert.equal(target.address, '93.184.216.34');

  // The socket's lookup never consults DNS again.
  const lookup = pinnedLookup(target.address, target.family);
  const single = await new Promise<string>((resolve) => (lookup as any)('rebind.example', {}, (_e: unknown, a: string) => resolve(a)));
  const all = await new Promise<any>((resolve) => (lookup as any)('rebind.example', { all: true }, (_e: unknown, a: unknown) => resolve(a)));
  assert.equal(single, '93.184.216.34');
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
  assert.equal(calls, 1, 'resolver consulted once, at validation');
});

test('safeFetch does not follow redirects', async () => {
  const { safeFetch } = await import('../src/lib/ssrf-guard');
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits++;
    res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
  }).listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await safeFetch(`http://receiver.test:${port}/hook`, { body: Buffer.from('{}'), headers: {}, timeoutMs: 2000 }, {
      production: false, allowHttp: true, allowPrivateForTests: true, resolver: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    assert.equal(res.status, 302);
    assert.equal(hits, 1);
  } finally {
    server.close();
  }
});

// ─── Retry policy ───────────────────────────────────────────────────────────

test('backoff doubles from 1 minute, caps at 24 h, with ±20% jitter', async () => {
  const { backoffMs } = await import('../src/services/webhooks.service');
  assert.equal(backoffMs(1, 0.5), 60_000);
  assert.equal(backoffMs(2, 0.5), 120_000);
  assert.equal(backoffMs(5, 0.5), 16 * 60_000);
  assert.equal(backoffMs(20, 0.5), 24 * 60 * 60_000);
  assert.equal(backoffMs(1, 0), 48_000);
  assert.equal(backoffMs(1, 1), 72_000);
});

test('Retry-After is honoured (seconds or HTTP date)', async () => {
  const { parseRetryAfter, planFailure } = await import('../src/services/webhooks.service');
  const now = Date.parse('2026-10-17T12:00:00Z');
  assert.equal(parseRetryAfter('120', now), 120_000);
  assert.equal(parseRetryAfter(new Date(now + 30_000).toUTCString(), now), 30_000);
  assert.equal(parseRetryAfter('garbage', now), null);
  assert.equal(parseRetryAfter(undefined, now), null);

  const plan = planFailure({ attempts: 0 }, { consecutiveFailures: 0, failingSince: null }, { now: new Date(now), retryAfterMs: 600_000, rand: 0.5 });
  assert.equal(plan.nextAttemptAt.getTime() - now, 600_000, 'Retry-After beats the 1 min backoff');
});

test('dead-letters after 15 attempts and disables at the failure thresholds', async () => {
  const { planFailure, MAX_ATTEMPTS, DISABLE_AFTER_FAILURES } = await import('../src/services/webhooks.service');
  const now = new Date('2026-10-17T12:00:00Z');

  const first = planFailure({ attempts: 0 }, { consecutiveFailures: 0, failingSince: null }, { now, rand: 0.5 });
  assert.equal(first.status, 'PENDING');
  assert.equal(first.attempts, 1);
  assert.equal(first.failingSince, now, 'failure streak starts now');
  assert.equal(first.disableReason, null);

  assert.equal(planFailure({ attempts: MAX_ATTEMPTS - 2 }, { consecutiveFailures: 0, failingSince: now }, { now }).status, 'PENDING');
  assert.equal(planFailure({ attempts: MAX_ATTEMPTS - 1 }, { consecutiveFailures: 0, failingSince: now }, { now }).status, 'DEAD');

  assert.match(
    planFailure({ attempts: 0 }, { consecutiveFailures: DISABLE_AFTER_FAILURES - 1, failingSince: now }, { now }).disableReason ?? '',
    /consecutive failed deliveries/,
  );
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60_000);
  assert.match(planFailure({ attempts: 0 }, { consecutiveFailures: 1, failingSince: fiveDaysAgo }, { now }).disableReason ?? '', /5 days/);
});

// ─── Outbox ─────────────────────────────────────────────────────────────────

function fakeDb() {
  const events = new Set<string>();
  const sql: string[] = [];
  return {
    events,
    sql,
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const text = strings.join('?');
      sql.push(text);
      if (text.includes('INSERT INTO "webhook_events"')) {
        const id = values[0] as string;
        if (events.has(id)) return 0;
        events.add(id);
        return 1;
      }
      return 2; // two matching subscriptions
    },
  };
}

test('enqueueEvent dedups by chain event id', async () => {
  const { enqueueEvent } = await import('../src/services/webhooks.service');
  const db = fakeDb();
  const payload = { onChainMarketId: '0' };
  assert.equal(await enqueueEvent(db as any, 'trade.executed', '0004951600-0000000001', payload, { onChainMarketId: 0n }), 2);
  assert.equal(await enqueueEvent(db as any, 'trade.executed', '0004951600-0000000001', payload, { onChainMarketId: 0n }), 0, 'replay inserts nothing');
  assert.deepEqual([...db.events], ['trade.executed:0004951600-0000000001']);
  assert.equal(db.sql.filter((s) => s.includes('webhook_deliveries')).length, 1, 'deliveries fanned out once');
  assert.match(db.sql[1], /status" = 'ACTIVE'/);
  assert.match(db.sql[1], /ANY\(s\."eventTypes"\)/);
});

test('envelope bytes are canonical and stable (signed bytes == sent bytes)', async () => {
  const { envelopeBytes } = await import('../src/services/webhooks.service');
  const event = { id: 'trade.executed:1', type: 'trade.executed', createdAt: new Date('2026-10-17T12:00:00Z'), payload: { z: 1, a: 2 } };
  const bytes = envelopeBytes(event);
  assert.equal(bytes.toString(), '{"createdAt":"2026-10-17T12:00:00.000Z","data":{"a":2,"z":1},"id":"trade.executed:1","type":"trade.executed"}');
  assert.deepEqual(envelopeBytes(event), bytes);
});

// ─── End-to-end delivery to a local receiver ────────────────────────────────

test('a local receiver gets a signed envelope matching the TRADE_EXECUTED shape', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const svc = await import('../src/services/webhooks.service');
  const { safeFetch } = await import('../src/lib/ssrf-guard');

  const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(204).end();
    });
  }).listen(0);
  const port = (server.address() as AddressInfo).port;

  const tradePayload = { onChainMarketId: '0', marketId: 'm0', direction: 'YES', collateralRaw: '100000000', eventId: '0004951600-0000000001' };
  const delivery: any = {
    id: 'd1',
    status: 'PENDING',
    attempts: 0,
    event: { id: 'trade.executed:0004951600-0000000001', type: 'trade.executed', createdAt: new Date(), payload: tradePayload },
    subscription: {
      id: 's1', userId: 'u1', status: 'ACTIVE', url: `http://receiver.test:${port}/hook`,
      secret: svc.encryptSecret('whsec_test'), previousSecret: null, secretRotatedAt: null, consecutiveFailures: 3, failingSince: new Date(),
    },
  };
  const updates: any[] = [];
  (prisma.webhookDelivery.findUnique as any) = async () => delivery;
  (prisma.webhookDelivery.update as any) = (args: any) => (updates.push(['delivery', args]), args);
  (prisma.webhookSubscription.update as any) = (args: any) => (updates.push(['subscription', args]), args);
  (prisma.$transaction as any) = async (ops: unknown[]) => ops;

  // Local receivers need http + loopback: allowed only via the test escape hatch.
  const send: typeof safeFetch = (url, init) =>
    safeFetch(url, init, { production: false, allowHttp: true, allowPrivateForTests: true, resolver: async () => [{ address: '127.0.0.1', family: 4 }] });

  try {
    await svc.deliverOne('d1', send);
  } finally {
    server.close();
  }

  assert.equal(received.length, 1);
  const [{ headers, body }] = received;
  assert.equal(headers['oracledesk-event-id'], 'trade.executed:0004951600-0000000001');
  assert.equal(headers['oracledesk-event-type'], 'trade.executed');
  assert.equal(headers['user-agent'], 'OracleDesk-Webhooks/1');
  assert.ok(svc.verifyWebhookSignature(body, String(headers['oracledesk-signature']), ['whsec_test']));
  const envelope = JSON.parse(body);
  assert.equal(envelope.type, 'trade.executed');
  assert.deepEqual(envelope.data, tradePayload);

  const [, d] = updates.find(([k]) => k === 'delivery');
  assert.equal(d.data.status, 'SUCCEEDED');
  assert.equal(d.data.lastStatusCode, 204);
  const [, s] = updates.find(([k]) => k === 'subscription');
  assert.equal(s.data.consecutiveFailures, 0, 'success resets the failure streak');
});

test('a failing receiver schedules a retry and counts the failure', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const svc = await import('../src/services/webhooks.service');
  const now = new Date('2026-10-17T12:00:00Z');
  const delivery: any = {
    id: 'd2', status: 'PENDING', attempts: 0,
    event: { id: 'market.resolved:x', type: 'market.resolved', createdAt: now, payload: {} },
    subscription: { id: 's2', userId: 'u1', status: 'ACTIVE', url: 'https://hooks.example.com/x', secret: svc.encryptSecret('k'), previousSecret: null, secretRotatedAt: null, consecutiveFailures: 0, failingSince: null },
  };
  const updates: any[] = [];
  (prisma.webhookDelivery.findUnique as any) = async () => delivery;
  (prisma.webhookDelivery.update as any) = (args: any) => (updates.push(['delivery', args]), args);
  (prisma.webhookSubscription.update as any) = (args: any) => (updates.push(['subscription', args]), args);
  (prisma.$transaction as any) = async (ops: unknown[]) => ops;

  await svc.deliverOne('d2', async () => ({ status: 503, headers: { 'retry-after': '300' } }), () => now);

  const [, d] = updates.find(([k]) => k === 'delivery');
  assert.equal(d.data.status, 'PENDING');
  assert.equal(d.data.attempts, 1);
  assert.equal(d.data.lastStatusCode, 503);
  assert.equal(d.data.nextAttemptAt.getTime() - now.getTime(), 300_000);
  const [, s] = updates.find(([k]) => k === 'subscription');
  assert.equal(s.data.consecutiveFailures, 1);
  assert.equal(s.data.status, undefined, 'not disabled yet');
});

// ─── Indexer integration ────────────────────────────────────────────────────

test('publishWebhookEvent is a no-op when WEBHOOKS_ENABLED=false and never throws', async () => {
  const { config } = await import('../src/config');
  const { publishWebhookEvent } = await import('../src/services/webhooks.service');
  const db = fakeDb();
  await publishWebhookEvent('trade.executed', 'e1', {}, { onChainMarketId: 0n }, db as any);
  assert.equal(db.sql.length, 0);

  const was = config.WEBHOOKS_ENABLED;
  (config as any).WEBHOOKS_ENABLED = true;
  try {
    await publishWebhookEvent('trade.executed', 'e1', {}, { onChainMarketId: 0n }, db as any);
    assert.equal(db.sql.length, 2);
    await publishWebhookEvent('trade.executed', 'e2', {}, { onChainMarketId: 0n }, { $executeRaw: async () => { throw new Error('db down'); } } as any);
  } finally {
    (config as any).WEBHOOKS_ENABLED = was;
  }
});
