import http from 'http';
import express from 'express';
import { createHealthRouter } from '../routes/health.routes';
import { health } from '../services/health.service';

export type ProcessRole = 'all' | 'api' | 'indexer' | 'worker';

export interface RolePlan {
  role: ProcessRole;
  startBootstrapRbac: boolean;
  startSequenceSync: boolean;
  startOutbox: boolean;
  startSagaResume: boolean;
  startHttpAndSockets: boolean;
  startFanout: boolean;
  startIndexer: boolean;
  startCrons: boolean;
  startProbeOnlyServer: boolean;
}

/**
 * Pure role-to-subsystem mapping (#272).
 *
 * | Subsystem | all | api | indexer | worker |
 * | --- | --- | --- | --- | --- |
 * | HTTP, socket.io, fanout, RBAC bootstrap | ✓ | ✓ | | |
 * | Event listener (indexer) | ✓ | | ✓ | |
 * | Outbox worker, crons, sequence sync, saga resume | ✓ | | | ✓ |
 * | Probe-only HTTP server (/livez, /readyz) | | | ✓ | ✓ |
 *
 * Common boot steps (secrets, embeddings, Prisma, Redis policy, spec-compat
 * gate) always run in every role.
 */
export function planForRole(role: ProcessRole): RolePlan {
  const isAll = role === 'all';
  return {
    role,
    startBootstrapRbac: isAll || role === 'api',
    startSequenceSync: isAll || role === 'worker',
    startOutbox: isAll || role === 'worker',
    startSagaResume: isAll || role === 'worker',
    startHttpAndSockets: isAll || role === 'api',
    startFanout: isAll || role === 'api',
    startIndexer: isAll || role === 'indexer',
    startCrons: isAll || role === 'worker',
    startProbeOnlyServer: role === 'indexer' || role === 'worker',
  };
}

export interface RoleBootstrapHooks {
  initSecrets: () => Promise<void>;
  assertEmbeddingConfig: () => void;
  connectPrisma: () => Promise<void>;
  bootstrapAdminRbac: () => Promise<void>;
  checkRedisPolicy: () => Promise<void>;
  syncSequence: () => Promise<void>;
  runSpecCompatGate: () => Promise<void>;
  startOutboxWorker: () => void;
  resumeIncompleteSagas: () => void;
  startHttpAndSockets: () => void;
  startFanout: () => void;
  startEventListener: () => void;
  startCrons: () => void;
  startProbeServer: () => void;
}

/**
 * Orchestrates role startup in the exact invariant order so `PROCESS_ROLE=all`
 * preserves existing boot order (outbox recovery before indexer and crons) and
 * split roles start only their assigned subsystems (#272).
 */
export async function executeRoleBootstrap(
  role: ProcessRole,
  hooks: RoleBootstrapHooks,
): Promise<RolePlan> {
  const plan = planForRole(role);

  await hooks.initSecrets();
  hooks.assertEmbeddingConfig();
  await hooks.connectPrisma();

  if (plan.startBootstrapRbac) {
    await hooks.bootstrapAdminRbac();
  }

  await hooks.checkRedisPolicy();

  if (plan.startSequenceSync) {
    await hooks.syncSequence();
  }

  await hooks.runSpecCompatGate();

  if (plan.startOutbox) {
    hooks.startOutboxWorker();
  }
  if (plan.startSagaResume) {
    hooks.resumeIncompleteSagas();
  }
  if (plan.startHttpAndSockets) {
    hooks.startHttpAndSockets();
  }
  if (plan.startFanout) {
    hooks.startFanout();
  }
  if (plan.startIndexer) {
    hooks.startEventListener();
  }
  if (plan.startCrons) {
    hooks.startCrons();
  }
  if (plan.startProbeOnlyServer) {
    hooks.startProbeServer();
  }

  return plan;
}

/**
 * Minimal HTTP server for `indexer` and `worker` pods exposing ONLY `/livez`
 * and `/readyz` (never API routes or socket.io) so Kubernetes probes work (#272).
 */
export function startProbeServer(port: number, onListen?: () => void): http.Server {
  const probeApp = express();
  probeApp.disable('x-powered-by');
  probeApp.use(createHealthRouter(health));
  const server = http.createServer(probeApp);
  server.listen(port, onListen);
  return server;
}
