import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

// Cross-source corroboration (#228). Each fixture in tests/fixtures/corroboration
// holds a proposal, its grounding signals, the candidate store rows and the
// expected verdict. Simhashes are computed from the text exactly as ingestion
// does, so a fixture states content, not fingerprints.
const FIXTURES = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'corroboration');
const POLICY = { minPublishers: 2, windowHours: 72, simhashRewrite: 10 };

interface Fixture {
  name: string;
  description: string;
  now: string;
  question: string;
  category: string;
  resolutionSourceId: string | null;
  meeting: { body: 'FOMC' | 'ECB'; date: string } | null;
  grounding: any[];
  candidates: any[];
  expected: { kind: string; units: number };
}

const fixtures: Fixture[] = fs.readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8')));

async function inputOf(fx: Fixture, order: (rows: any[]) => any[] = (r) => r) {
  const { fingerprintText, simhash64 } = await import('../src/services/signal-normalize');
  const { MEETINGS } = await import('../src/services/resolvability.calendar');
  const candidates = order(fx.candidates).map((c) => ({
    ...c,
    publishedAt: new Date(c.publishedAt),
    simhash: simhash64(fingerprintText(c.title, c.summary)),
  }));
  return {
    question: fx.question,
    category: fx.category,
    grounding: fx.grounding,
    candidates,
    resolutionSourceId: fx.resolutionSourceId as any,
    meeting: fx.meeting ? MEETINGS[fx.meeting.body].find((m) => m.date === fx.meeting!.date) ?? null : null,
    now: new Date(fx.now),
  };
}

test('fixture suite covers every case in the issue', () => {
  assert.deepEqual(fixtures.map((f) => f.name), [
    'ecb-meeting-calendar',
    'ecb-off-calendar',
    'fomc-meeting-fred-backed',
    'light-rewrite',
    'outside-window',
    'same-domain-clusters',
    'single-planted-article',
    'syndicated-cluster',
    'two-independent-outlets',
  ]);
});

for (const fx of fixtures) {
  test(`corroboration fixture ${fx.name}: ${fx.description}`, async () => {
    const { checkCorroboration } = await import('../src/services/llm-guard.service');
    const verdict = checkCorroboration(await inputOf(fx), POLICY);
    assert.equal(verdict.kind, fx.expected.kind, JSON.stringify(verdict.detail));
    assert.equal(verdict.ok, fx.expected.kind !== 'UNCORROBORATED');
    assert.equal(verdict.detail.units, fx.expected.units, JSON.stringify(verdict.detail));
    for (const ref of verdict.corroborators) {
      assert.ok(ref.signalId && ref.clusterId && ref.domain && ref.source, 'every corroborator is a complete reference');
      assert.ok(!Number.isNaN(Date.parse(ref.publishedAt)));
    }
  });

  test(`corroboration fixture ${fx.name}: verdict is identical for permuted candidate order`, async () => {
    const { checkCorroboration } = await import('../src/services/llm-guard.service');
    const base = checkCorroboration(await inputOf(fx), POLICY);
    const reversed = checkCorroboration(await inputOf(fx, (r) => [...r].reverse()), POLICY);
    // A fixed interleaving: odd positions first, then even.
    const shuffled = checkCorroboration(
      await inputOf(fx, (r) => [...r.filter((_, i) => i % 2 === 1), ...r.filter((_, i) => i % 2 === 0)]),
      POLICY,
    );
    assert.deepEqual(reversed, base);
    assert.deepEqual(shuffled, base);
  });
}

test('twelve syndicated copies count as one unit even though they span twelve domains', async () => {
  const { checkCorroboration } = await import('../src/services/llm-guard.service');
  const fx = fixtures.find((f) => f.name === 'syndicated-cluster')!;
  const verdict = checkCorroboration(await inputOf(fx), POLICY);
  assert.equal(verdict.detail.matched, 12);
  assert.equal((verdict.detail.domains as string[]).length, 12);
  assert.equal(verdict.detail.units, 1);
  assert.equal(verdict.corroborators.length, 1, 'one reference per cluster');
});

test('lowering the rewrite distance splits lightly rewritten copy into two units', async () => {
  const { checkCorroboration } = await import('../src/services/llm-guard.service');
  const fx = fixtures.find((f) => f.name === 'light-rewrite')!;
  const strict = checkCorroboration(await inputOf(fx), { ...POLICY, simhashRewrite: 0 });
  assert.equal(strict.kind, 'CORROBORATED', 'only the rewrite rule merged them');
});

test('FRED rows never count as news corroboration units', async () => {
  const { checkCorroboration } = await import('../src/services/llm-guard.service');
  const fx = fixtures.find((f) => f.name === 'fomc-meeting-fred-backed')!;
  // Same question, but resolved by a non-FRED source: the FRED row cannot help.
  const verdict = checkCorroboration({ ...(await inputOf(fx)), resolutionSourceId: 'BLS' as any, meeting: null }, POLICY);
  assert.equal(verdict.kind, 'UNCORROBORATED');
  assert.equal(verdict.detail.matched, 0);
});

test('a scheduled meeting needs at least one matching news candidate', async () => {
  const { checkCorroboration } = await import('../src/services/llm-guard.service');
  const fx = fixtures.find((f) => f.name === 'ecb-meeting-calendar')!;
  const input = await inputOf(fx);
  const verdict = checkCorroboration({ ...input, grounding: [], candidates: input.candidates.filter((c) => c.id.startsWith('sig-noise')) }, POLICY);
  assert.equal(verdict.kind, 'UNCORROBORATED');
});

test('meetingAt matches only the exact meeting announcement instant', async () => {
  const { meetingAt, extractQuestion } = await import('../src/services/resolvability.service');
  const now = new Date('2026-10-18T12:00:00Z');
  const atMeeting = extractQuestion('Will the ECB cut rates at its October 2026 meeting?', now, { meetingBody: 'ECB' }).deadlines[0].at;
  assert.equal(meetingAt(atMeeting, 'ECB')?.date, '2026-10-29');
  const plainDate = extractQuestion('Will the ECB cut rates by October 29, 2026?', now, { timeZone: 'Europe/Berlin' }).deadlines[0].at;
  assert.equal(meetingAt(plainDate, 'ECB'), null, 'end of day is not the decision time');
  assert.equal(meetingAt(atMeeting, 'AP_POLITICS'), null);
});

test('fredSeriesFor maps fed-funds questions to the target and effective series', async () => {
  const { fredSeriesFor } = await import('../src/services/resolvability.service');
  assert.deepEqual(fredSeriesFor('Will the federal funds target rate be cut?'), ['DFEDTARU', 'FEDFUNDS']);
  assert.deepEqual(fredSeriesFor('Will US CPI exceed 3%?'), ['CPIAUCSL']);
  assert.deepEqual(fredSeriesFor('Will it rain?'), []);
});

test('registrableDomain folds subdomains and multi-label suffixes; publisherDomain prefers the URL', async () => {
  const { registrableDomain, publisherDomain } = await import('../src/lib/domains');
  assert.equal(registrableDomain('www.reuters.com'), 'reuters.com');
  assert.equal(registrableDomain('uk.reuters.com'), 'reuters.com');
  assert.equal(registrableDomain('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(registrableDomain('www.abc.net.au'), 'abc.net.au');
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(registrableDomain('10.0.0.1'), '10.0.0.1');
  assert.equal(publisherDomain('https://edition.cnn.com/a?utm_source=x', 'CNN'), 'cnn.com');
  // GDELT reports the domain as the publisher; NewsAPI a display name.
  assert.equal(publisherDomain(null, 'www.lemonde.fr'), 'lemonde.fr');
  assert.equal(publisherDomain(null, 'Reuters'), 'reuters');
  assert.equal(publisherDomain('not a url', null), null);
});

test('assessCorroboration reads the store once per cycle instant and caps candidates', async () => {
  const { config } = await import('../src/config');
  const { MemorySignalStore, setSignalStore } = await import('../src/services/signal-store.service');
  const { assessCorroboration, resetCorroborationCache } = await import('../src/services/corroboration.service');
  const fx = fixtures.find((f) => f.name === 'two-independent-outlets')!;
  const store = new MemorySignalStore();
  let reads = 0;
  const recent = store.recent.bind(store);
  store.recent = async (since: Date) => { reads++; return recent(since); };
  const now = new Date(fx.now);
  await store.upsert((await inputOf(fx)).candidates.map((c) => ({
    source: c.source, dedupKey: c.id, externalId: null, url: c.url, publisher: c.publisher, title: c.title, summary: c.summary,
    publishedAt: c.publishedAt, category: null, categoryConfidence: null, numericValue: null, simhash: c.simhash,
  })), now);
  const prev = setSignalStore(store);
  const prevMax = config.CORROBORATION_MAX_CANDIDATES;
  resetCorroborationCache();
  try {
    const proposal = { market_question: fx.question, category: fx.category } as Parameters<typeof assessCorroboration>[0];
    const resolution = { sourceId: 'AP_POLITICS' as const, deadlineUtc: '2026-12-31T23:59:59.000Z' };
    const a = await assessCorroboration(proposal, fx.grounding, resolution, now);
    const b = await assessCorroboration(proposal, fx.grounding, resolution, now);
    assert.equal(reads, 1, 'cached for the cycle');
    assert.equal(a.verdict.kind, 'CORROBORATED');
    assert.deepEqual(b.verdict, a.verdict);
    assert.equal(a.record.policy.mode, config.CORROBORATION_MODE);
    assert.ok(a.evidence.length >= 2 && a.evidence.every((e) => e.signalId && e.signal), 'corroborators become trace evidence');

    (config as { CORROBORATION_MAX_CANDIDATES: number }).CORROBORATION_MAX_CANDIDATES = 1;
    resetCorroborationCache();
    const capped = await assessCorroboration(proposal, [], resolution, now);
    assert.equal(capped.verdict.kind, 'UNCORROBORATED', 'only the newest candidate is read');
  } finally {
    (config as { CORROBORATION_MAX_CANDIDATES: number }).CORROBORATION_MAX_CANDIDATES = prevMax;
    setSignalStore(prev);
    resetCorroborationCache();
  }
});

test('config: live mode requires enforce unless CORROBORATION_ALLOW_OBSERVE_LIVE is set', async () => {
  const { envSchema } = await import('../src/config');
  const issues = (env: Record<string, string>) => {
    const r = envSchema.safeParse({ ...process.env, CHAIN_EXECUTION_MODE: 'live', ...env });
    return r.success ? [] : r.error.issues.filter((i) => i.path[0] === 'CORROBORATION_MODE');
  };
  assert.equal(issues({ CORROBORATION_MODE: 'observe' }).length, 1);
  assert.equal(issues({ CORROBORATION_MODE: 'off' }).length, 1);
  assert.equal(issues({ CORROBORATION_MODE: 'enforce' }).length, 0);
  assert.equal(issues({ CORROBORATION_MODE: 'observe', CORROBORATION_ALLOW_OBSERVE_LIVE: 'true' }).length, 0);
});
