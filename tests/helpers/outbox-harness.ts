/**
 * Crash-recovery harness for the transactional outbox (#35, #229).
 *
 * - `loadContext` / `freshModules` give each simulated process its own copy of
 *   every src module (and its own Prisma client), which is what a restart
 *   resets: the completion-handler map, the sequence cache, the channel pool
 *   and the chain cache.
 * - `fakeChain` is a scriptable RPC behind the existing seams
 *   (setTransactionSender, setTransactionReader, RecoverDeps.server). It models
 *   inner and outer (fee-bump) hashes, NOT_FOUND within and beyond retention,
 *   DUPLICATE, TRY_AGAIN_LATER, ERROR (tx_bad_seq) and the latest ledger's
 *   close time.
 * - `installBindings` replaces agentClients.treasury / reasoningRegistry with
 *   fakes that return real, signable Soroban envelopes.
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  Account,
  Address,
  FeeBumpTransaction,
  Keypair,
  Operation,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import type { PrismaClient } from '@prisma/client';

type Outbox = typeof import('../../src/services/stellar/outbox');
type RecoveryRpc = import('../../src/services/stellar/outbox').RecoveryRpc;
type TransactionReader = import('../../src/services/stellar/tx-inspect').TransactionReader;
type TransactionSender = import('../../src/services/stellar/tx-inspect').TransactionSender;

const SRC = path.resolve(__dirname, '../../src');

// ─── Module contexts ─────────────────────────────────────────────────────────

export interface ModuleContext {
  prisma: PrismaClient;
  config: typeof import('../../src/config').config;
  outbox: Outbox;
  chain: typeof import('../../src/services/chain.service');
  txInspect: typeof import('../../src/services/stellar/tx-inspect');
  sequence: typeof import('../../src/services/stellar/sequence');
  clients: typeof import('../../src/services/stellar/clients');
  redis: typeof import('../../src/lib/redis');
  marketChain: typeof import('../../src/services/market-chain.service');
  trade: typeof import('../../src/services/trade.service');
  exit: typeof import('../../src/services/exit.service');
  tracePublish: typeof import('../../src/services/trace-publish.service');
}

/**
 * lib/logger is kept across contexts: it holds no state a restart resets, and
 * every fresh copy would start another pino-pretty worker thread writing to
 * stdout, whose interleaved output can corrupt the node:test child protocol.
 */
const KEPT = new Set([path.join(SRC, 'lib', 'logger.js')]);

/** Forgets every compiled src module (but the logger), so the next require re-evaluates it. */
export function clearSrcModules(): void {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC + path.sep) && !KEPT.has(key)) delete require.cache[key];
  }
}

/** Requires a compiled src module (relative to src/) from the current module context. */
export const requireSrc = <T>(rel: string): T => require(path.join(SRC, rel)) as T;
const load = requireSrc;

/**
 * Loads a new module context next to any existing one (two live "processes",
 * for the concurrency cases). config, prisma and redis read process.env at
 * load, so set DATABASE_URL / REDIS_URL before calling.
 */
export function loadContext(): ModuleContext {
  clearSrcModules();
  // lib/prisma reuses a client parked on globalThis outside production; a new
  // process has none.
  (globalThis as { prisma?: unknown }).prisma = undefined;

  // The secret store is module state too: seed the new copy as setupTestEnv does.
  const secrets = load<typeof import('../../src/config/secrets')>('config/secrets');
  secrets.setSecretsForTest(
    Object.fromEntries(secrets.SECRET_NAMES.map((name) => [name, process.env[name] ?? ''])) as Record<
      (typeof secrets.SECRET_NAMES)[number],
      string
    >,
  );

  return {
    config: load<typeof import('../../src/config')>('config').config,
    prisma: load<typeof import('../../src/lib/prisma')>('lib/prisma').prisma,
    redis: load('lib/redis'),
    outbox: load('services/stellar/outbox'),
    chain: load('services/chain.service'),
    txInspect: load('services/stellar/tx-inspect'),
    sequence: load('services/stellar/sequence'),
    clients: load('services/stellar/clients'),
    marketChain: load('services/market-chain.service'),
    trade: load('services/trade.service'),
    exit: load('services/exit.service'),
    tracePublish: load('services/trace-publish.service'),
  };
}

/**
 * Drops a context's connections. Call only after its frozen promises have
 * been abandoned: they never settle, so nothing of theirs runs afterwards.
 */
export async function abandonContext(ctx: ModuleContext): Promise<void> {
  ctx.chain.setCrashHookForTest(null);
  await ctx.prisma.$disconnect().catch(() => undefined);
  // disconnect() also stops the reconnect loop of a client that never connected.
  ctx.redis.getRedis().disconnect();
  await ctx.redis.closeRedis().catch(() => undefined);
}

/**
 * Waits for the context's Redis connection: lib/redis disables the offline
 * queue, so a command issued before the socket is ready fails fast.
 */
export async function redisReady(ctx: ModuleContext, timeoutMs = 5_000): Promise<void> {
  const client = ctx.redis.getRedis();
  if (client.status === 'ready') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`redis not ready after ${timeoutMs}ms`)), timeoutMs);
    client.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * A process restart: the previous context is abandoned and a new one loaded.
 * `redis: false` skips waiting for a Redis connection (unit tier, no Redis).
 */
export async function freshModules(prev?: ModuleContext | null, opts: { redis?: boolean } = {}): Promise<ModuleContext> {
  if (prev) await abandonContext(prev);
  const ctx = loadContext();
  if (opts.redis ?? true) await redisReady(ctx);
  return ctx;
}

/** A promise that never settles: awaiting it freezes the caller, catch/finally included. */
export const forever = (): Promise<never> => new Promise<never>(() => undefined);

// ─── Scriptable RPC ──────────────────────────────────────────────────────────

export type SendVerdict = 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR';

export interface FakeChain {
  /** Lands `hash`. With viaOuter, RPC answers only for the outer (fee-bump) hash. */
  land(hash: string, opts: { status: 'SUCCESS' | 'FAILED'; returnValue?: xdr.ScVal; ledger: number; viaOuter?: string }): void;
  setLatest(ledger: number, closeTime: number): void;
  setRetention(oldestLedger: number, oldestCloseTime: number): void;
  /** Decides each sendTransaction; the default is PENDING, or DUPLICATE for an envelope already accepted. */
  onSend(fn: (tx: Transaction | FeeBumpTransaction) => SendVerdict): void;
  /** The next write-path send is accepted by the network but throws `make()` to the caller. */
  timeoutNextSend(make: () => Error): void;
  latest(): { ledger: number; closeTime: number };
  /** Hashes of every envelope submitted, in order. */
  sent: string[];
  server: RecoveryRpc;
  reader: TransactionReader;
  sender: TransactionSender;
}

export const hashOf = (tx: Transaction | FeeBumpTransaction): string => tx.hash().toString('hex');

export const isFeeBump = (tx: Transaction | FeeBumpTransaction): tx is FeeBumpTransaction => tx instanceof FeeBumpTransaction;

const badSeqResult = () =>
  new xdr.TransactionResult({
    feeCharged: new xdr.Int64(0),
    result: xdr.TransactionResultResult.txBadSeq(),
    ext: new xdr.TransactionResultExt(0),
  });

export function fakeChain(start: { ledger: number; closeTime: number }): FakeChain {
  const landed = new Map<string, { status: 'SUCCESS' | 'FAILED'; returnValue?: xdr.ScVal; ledger: number; inner: string }>();
  const accepted = new Set<string>();
  let latest = { ...start };
  let retention = { oldestLedger: start.ledger - 17_280, oldestCloseTime: start.closeTime - 86_400 };
  let verdict: (tx: Transaction | FeeBumpTransaction) => SendVerdict = (tx) => (accepted.has(hashOf(tx)) ? 'DUPLICATE' : 'PENDING');
  let nextTimeout: (() => Error) | null = null;
  const sent: string[] = [];

  const window = () => ({
    latestLedger: latest.ledger,
    latestLedgerCloseTime: latest.closeTime,
    oldestLedger: retention.oldestLedger,
    oldestLedgerCloseTime: retention.oldestCloseTime,
  });

  const server = {
    async getTransaction(hash: string) {
      const hit = landed.get(hash);
      if (!hit || hit.ledger < retention.oldestLedger) return { status: 'NOT_FOUND', ...window() } as never;
      return {
        status: hit.status,
        ...window(),
        ledger: hit.ledger,
        createdAt: latest.closeTime,
        applicationOrder: 1,
        feeBump: hit.inner !== hash,
        txHash: hash,
        returnValue: hit.returnValue,
      } as never;
    },
    async sendTransaction(tx: Transaction | FeeBumpTransaction) {
      const hash = hashOf(tx);
      sent.push(hash);
      const status = verdict(tx);
      if (status === 'PENDING' || status === 'DUPLICATE') accepted.add(hash);
      return {
        status,
        hash,
        latestLedger: latest.ledger,
        latestLedgerCloseTime: latest.closeTime,
        ...(status === 'ERROR' ? { errorResult: badSeqResult() } : {}),
      } as never;
    },
    async getLatestLedger() {
      return { id: 'fake', sequence: latest.ledger, protocolVersion: 22 } as never;
    },
  };

  return {
    land(hash, opts) {
      const key = opts.viaOuter ?? hash;
      landed.set(key, { status: opts.status, returnValue: opts.returnValue, ledger: opts.ledger, inner: hash });
    },
    setLatest(ledger, closeTime) {
      latest = { ledger, closeTime };
    },
    setRetention(oldestLedger, oldestCloseTime) {
      retention = { oldestLedger, oldestCloseTime };
    },
    onSend(fn) {
      verdict = fn;
    },
    timeoutNextSend(make) {
      nextTimeout = make;
    },
    latest: () => ({ ...latest }),
    sent,
    server: server as unknown as RecoveryRpc,
    reader: { getTransaction: server.getTransaction } as TransactionReader,
    sender: {
      async sendTransaction(tx: Transaction | FeeBumpTransaction) {
        const resp = await server.sendTransaction(tx);
        if (nextTimeout) {
          const err = nextTimeout();
          nextTimeout = null;
          throw err;
        }
        return resp;
      },
    },
  };
}

// ─── Binding fakes ───────────────────────────────────────────────────────────

/**
 * A simulated AssembledTransaction as the generated bindings return it: a real
 * Soroban envelope (unique per call), explicit timebounds, the simulated
 * result, and sign() with the given key (the throwaway agent key).
 */
export function fakeAssembled(
  signer: Keypair,
  networkPassphrase: string,
  method: string,
  result: unknown,
  opts: { timeoutInSeconds?: number; latestLedger?: number } = {},
) {
  const maxTime = Math.floor(Date.now() / 1000) + (opts.timeoutInSeconds ?? 300);
  const built = new TransactionBuilder(new Account(signer.publicKey(), '999'), { fee: '5200', networkPassphrase })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(StrKey.encodeContract(Buffer.alloc(32, 7))).toScAddress(),
            functionName: method,
            // A nonce keeps every envelope's hash unique across cases.
            args: [nativeToScVal(randomBytes(16))],
          }),
        ),
        auth: [],
      }),
    )
    .setSorobanData(new SorobanDataBuilder().setResourceFee(5000).build())
    .setTimebounds(0, maxTime)
    .build();
  const tx = {
    simulation: { minResourceFee: '5000', latestLedger: opts.latestLedger ?? 0 },
    result,
    built: built as Transaction,
    async sign() {
      // chain.service may have replaced `built` (rebuildWithSequence): sign the current one.
      tx.built.sign(signer);
    },
  };
  return tx;
}

/** Simulated results each fake write returns, by binding method. */
export interface SimulatedResults {
  agent_create_market?: bigint;
  agent_buy?: bigint;
  agent_sell?: bigint;
  publish_trace?: bigint;
}

/** Overrides agentClients.treasury / reasoningRegistry in one context, as tests/chain-outbox.test.ts does. */
export function installBindings(ctx: ModuleContext, signer: Keypair, chain: FakeChain, results: () => SimulatedResults): void {
  const make = (method: keyof SimulatedResults) => async (_args: unknown, opts?: { timeoutInSeconds?: number }) =>
    fakeAssembled(signer, ctx.config.STELLAR_NETWORK_PASSPHRASE, method, results()[method] ?? 0n, {
      timeoutInSeconds: opts?.timeoutInSeconds,
      latestLedger: chain.latest().ledger,
    });
  const clients = ctx.clients.agentClients as Record<string, unknown>;
  clients.treasury = () => ({
    agent_create_market: make('agent_create_market'),
    agent_buy: make('agent_buy'),
    agent_sell: make('agent_sell'),
  });
  clients.reasoningRegistry = () => ({ publish_trace: make('publish_trace') });
}
