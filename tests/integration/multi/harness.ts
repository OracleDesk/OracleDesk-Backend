/**
 * Multi-instance test harness scaffolding (#241).
 *
 * Several backend subsystems (fan-out leader election, the fair per-account
 * sequence lock, Redis-leased channel accounts, the outbox recovery lock,
 * Postgres advisory locks, the LLM budget Lua) are only correct if
 * independent instances coordinate through Redis and Postgres. The existing
 * tests run every "instance" inside one Node process, so they cannot
 * reproduce the production failures that actually matter: a stop-the-world
 * pause while a lease expires, a Redis partition that keeps Postgres
 * reachable, or a `SIGKILL` between "submitted" and "marked".
 *
 * This file defines the stable API the multi-instance tests target. The
 * worker, proxy and real `start()` implementations ship alongside it as
 * follow-ups; keeping the surface pinned here means the scenario tests can
 * be written against the same contract.
 */

/** IPC commands sent from the harness to each worker. */
export type WorkerCmd =
  | { op: 'startFanout'; prefix: string; leaseMs: number; renewMs: number; fenceMs: number }
  | { op: 'withSourceAccount'; account: string; holdMs: number; barrier?: string }
  | { op: 'leaseChannel'; holdMs: number }
  | { op: 'recoverOutbox' }
  | { op: 'publish'; events: string[] }
  | { op: 'stop' };

/** Observable actions the worker streams back to the parent. */
export type WorkerEvt = {
  op: 'log';
  at: number;
  instance: string;
  kind: string;
  data: unknown;
};

/**
 * A per-dependency TCP proxy owned by one instance. `partition()` stops
 * forwarding bytes without closing sockets, mimicking a real partition;
 * `resetConnections()` destroys them for an RST.
 */
export interface FaultProxy {
  url: string;
  partition(): void;
  heal(): void;
  delay(ms: number): void;
  resetConnections(): void;
  close(): Promise<void>;
}

/**
 * One backend worker instance running as a `child_process.fork` child.
 * `pause`/`resume` use SIGSTOP/SIGCONT; `kill` is a hard kill. Each worker
 * has its own module registry and its own proxied Redis/Postgres URLs.
 */
export interface Instance {
  id: string;
  send(cmd: WorkerCmd): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  kill(): Promise<void>;
  redis: FaultProxy;
  postgres: FaultProxy;
}

/** The merged event history across every started instance, time-ordered. */
export interface Timeline {
  events(): ReadonlyArray<WorkerEvt>;
  /** Resolve when `predicate` is true, or reject after `timeoutMs`. */
  waitFor(predicate: (evt: WorkerEvt) => boolean, timeoutMs: number): Promise<WorkerEvt>;
  /** Fired every time any instance emits an event. */
  on(listener: (evt: WorkerEvt) => void): () => void;
}

export interface HarnessHandle {
  instances: Instance[];
  timeline: Timeline;
  stop(): Promise<void>;
}

export interface StartOptions {
  count: number;
  workerModule?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Start `count` backend worker instances against the shared Testcontainers
 * Postgres/Redis. Each gets its own proxied URLs so partitions are per-
 * instance. Returns the handle the scenario tests drive.
 *
 * The production implementation lives in a follow-up PR; this scaffolding
 * exports the API every scenario test files against it, keeping test
 * authoring and the harness implementation independent tracks.
 */
export async function startMultiInstance(_opts: StartOptions): Promise<HarnessHandle> {
  throw new Error(
    'startMultiInstance is scaffolded under #241; the worker/proxy runtime lands in the follow-up implementation PR',
  );
}
