import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeRoleBootstrap, planForRole, type ProcessRole, type RoleBootstrapHooks } from '../src/lib/process-role';
import { ConfigError, loadConfig } from '../src/config';

function makeRecordingHooks(): { calls: string[]; hooks: RoleBootstrapHooks } {
  const calls: string[] = [];
  const rec = (name: string) => () => {
    calls.push(name);
  };
  const recAsync = (name: string) => async () => {
    calls.push(name);
  };
  return {
    calls,
    hooks: {
      initSecrets: recAsync('initSecrets'),
      assertEmbeddingConfig: rec('assertEmbeddingConfig'),
      connectPrisma: recAsync('connectPrisma'),
      bootstrapAdminRbac: recAsync('bootstrapAdminRbac'),
      checkRedisPolicy: recAsync('checkRedisPolicy'),
      syncSequence: recAsync('syncSequence'),
      runSpecCompatGate: recAsync('runSpecCompatGate'),
      startOutboxWorker: rec('startOutboxWorker'),
      resumeIncompleteSagas: rec('resumeIncompleteSagas'),
      startHttpAndSockets: rec('startHttpAndSockets'),
      startFanout: rec('startFanout'),
      startEventListener: rec('startEventListener'),
      startCrons: rec('startCrons'),
      startProbeServer: rec('startProbeServer'),
    },
  };
}

describe('PROCESS_ROLE bootstrap planning (#272)', () => {
  it('all preserves full boot order with outbox recovery before indexer and crons', async () => {
    const { calls, hooks } = makeRecordingHooks();
    await executeRoleBootstrap('all', hooks);
    assert.deepEqual(calls, [
      'initSecrets',
      'assertEmbeddingConfig',
      'connectPrisma',
      'bootstrapAdminRbac',
      'checkRedisPolicy',
      'syncSequence',
      'runSpecCompatGate',
      'startOutboxWorker',
      'resumeIncompleteSagas',
      'startHttpAndSockets',
      'startFanout',
      'startEventListener',
      'startCrons',
    ]);
  });

  it('api starts HTTP, sockets, fanout, and RBAC without indexer or crons', async () => {
    const { calls, hooks } = makeRecordingHooks();
    await executeRoleBootstrap('api', hooks);
    assert.deepEqual(calls, [
      'initSecrets',
      'assertEmbeddingConfig',
      'connectPrisma',
      'bootstrapAdminRbac',
      'checkRedisPolicy',
      'runSpecCompatGate',
      'startHttpAndSockets',
      'startFanout',
    ]);
  });

  it('indexer starts only event listener and probe server (no sockets or crons)', async () => {
    const { calls, hooks } = makeRecordingHooks();
    await executeRoleBootstrap('indexer', hooks);
    assert.deepEqual(calls, [
      'initSecrets',
      'assertEmbeddingConfig',
      'connectPrisma',
      'checkRedisPolicy',
      'runSpecCompatGate',
      'startEventListener',
      'startProbeServer',
    ]);
  });

  it('worker starts sequence sync, outbox, saga resume, crons, and probe server', async () => {
    const { calls, hooks } = makeRecordingHooks();
    await executeRoleBootstrap('worker', hooks);
    assert.deepEqual(calls, [
      'initSecrets',
      'assertEmbeddingConfig',
      'connectPrisma',
      'checkRedisPolicy',
      'syncSequence',
      'runSpecCompatGate',
      'startOutboxWorker',
      'resumeIncompleteSagas',
      'startCrons',
      'startProbeServer',
    ]);
  });

  it('config rejects invalid PROCESS_ROLE combinations for indexer', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      NODE_ENV: 'test',
    };
    assert.throws(
      () => loadConfig({ ...baseEnv, PROCESS_ROLE: 'indexer', INDEXER_ENABLED: 'false', EVENT_BUS_ENABLED: 'true' }),
      ConfigError,
    );
    assert.throws(
      () => loadConfig({ ...baseEnv, PROCESS_ROLE: 'indexer', INDEXER_ENABLED: 'true', EVENT_BUS_ENABLED: 'false' }),
      ConfigError,
    );
    const valid = loadConfig({ ...baseEnv, PROCESS_ROLE: 'indexer', INDEXER_ENABLED: 'true', EVENT_BUS_ENABLED: 'true' });
    assert.equal(valid.PROCESS_ROLE, 'indexer');
  });

  it('planForRole covers every supported role', () => {
    for (const role of ['all', 'api', 'indexer', 'worker'] as ProcessRole[]) {
      assert.equal(planForRole(role).role, role);
    }
  });
});
