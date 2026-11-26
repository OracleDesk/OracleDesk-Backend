import { Keypair, rpc } from '@stellar/stellar-sdk';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import type { ClientOptions } from '@stellar/stellar-sdk/contract';
import { Client as MarketCoreClient } from '../../generated/market-core';
import { Client as TreasuryClient } from '../../generated/treasury';
import { Client as ResolverClient } from '../../generated/resolver';
import { Client as ReasoningRegistryClient } from '../../generated/reasoning-registry';
import { config } from '../../config';
import { CONTRACTS, DEPLOYED_AGENT } from '../../config/contracts';
import { logger } from '../../lib/logger';
import { isInsideBulkhead } from '../../lib/resilience';

export { MarketCoreClient, TreasuryClient, ResolverClient, ReasoningRegistryClient };

const GUARDED_RPC_METHODS = new Set([
  'simulateTransaction',
  'sendTransaction',
  'getTransaction',
  'getTransactions',
  'getLatestLedger',
  'getLedgers',
  'getLedgerEntries',
  'getEvents',
  'getHealth',
  'getAccount',
  'getNetwork',
  'getFeeStats',
  'getVersionInfo',
  'prepareTransaction',
]);

type OutsideBulkheadHook = (method: string, source: string) => void;
let outsideBulkheadHook: OutsideBulkheadHook | null = null;

/** Test seam (#300): observe dev-guard warnings when RPC is called outside a bulkhead. */
export function setOutsideBulkheadHook(hook: OutsideBulkheadHook | null): OutsideBulkheadHook | null {
  const prev = outsideBulkheadHook;
  outsideBulkheadHook = hook;
  return prev;
}

/**
 * Dev-only guard (#300): wraps an `rpc.Server` in a Proxy that logs
 * `rpc call outside bulkhead` with the method name whenever a guarded RPC
 * method is invoked without an active bulkhead slot in the current async
 * context. Disabled in production to keep zero overhead on the hot path.
 */
export function wrapRpcServer<T extends object>(server: T, source = 'rpcServer'): T {
  if (config.NODE_ENV === 'production') return server;
  return new Proxy(server, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === 'string' && GUARDED_RPC_METHODS.has(prop) && typeof value === 'function') {
        return function (this: unknown, ...args: unknown[]) {
          if (!isInsideBulkhead()) {
            if (outsideBulkheadHook) {
              outsideBulkheadHook(prop, source);
            } else {
              logger.warn({ method: prop, source }, 'rpc call outside bulkhead');
            }
          }
          return value.apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapBindingClient<T extends object>(client: T, label: string): T {
  if (config.NODE_ENV === 'production') return client;
  const anyClient = client as Record<string, unknown>;
  for (const field of ['server', 'rpcServer'] as const) {
    const inner = anyClient[field];
    if (inner && typeof inner === 'object') {
      try {
        anyClient[field] = wrapRpcServer(inner as object, `${label}.${field}`);
      } catch {
        // Non-writable property on SDK client; leave as-is.
      }
    }
  }
  const opts = anyClient.options as Record<string, unknown> | undefined;
  if (opts && typeof opts.server === 'object' && opts.server !== null) {
    try {
      opts.server = wrapRpcServer(opts.server as object, `${label}.options.server`);
    } catch {
      // Non-writable property.
    }
  }
  return client;
}

export const rpcServer = wrapRpcServer(
  new rpc.Server(config.STELLAR_RPC_URL, {
    allowHttp: config.STELLAR_RPC_URL.startsWith('http://'),
  }),
  'rpcServer',
);

export type Signer = Pick<ClientOptions, 'publicKey' | 'signTransaction' | 'signAuthEntry'>;
export type SignerRole = 'MARKET_MAKER' | 'TRADER' | 'OPS';

function secretFor(role: SignerRole): string | undefined {
  return role === 'MARKET_MAKER'
    ? (config.AGENT_MAKER_SECRET_KEY || config.AGENT_SECRET_KEY)
    : role === 'TRADER'
      ? (config.AGENT_TRADER_SECRET_KEY || config.AGENT_SECRET_KEY)
      : config.AGENT_SECRET_KEY;
}

export function agentKeypair(role: SignerRole): Keypair {
  const secret = secretFor(role);
  if (!secret) throw new Error(`${role} signer is not configured`);
  return Keypair.fromSecret(secret);
}

export function baseOptions(contractId: string, signer: Signer = {}): ClientOptions {
  return {
    contractId,
    rpcUrl: config.STELLAR_RPC_URL,
    networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
    allowHttp: config.STELLAR_RPC_URL.startsWith('http://'),
    ...({ timeoutInSeconds: Math.ceil(config.TIMEOUT_RPC_WRITE_MS / 1000) } as object),
    ...signer,
  };
}

/** Read-only clients: simulation only, no source account needed. */
export const readClients = {
  marketCore: () => wrapBindingClient(new MarketCoreClient(baseOptions(CONTRACTS.marketCore)), 'read.marketCore'),
  treasury: () => wrapBindingClient(new TreasuryClient(baseOptions(CONTRACTS.treasury)), 'read.treasury'),
  resolver: () => wrapBindingClient(new ResolverClient(baseOptions(CONTRACTS.resolver)), 'read.resolver'),
  reasoningRegistry: () =>
    wrapBindingClient(new ReasoningRegistryClient(baseOptions(CONTRACTS.reasoningRegistry)), 'read.reasoningRegistry'),
};

/**
 * The agent identity used for writes.
 *
 * live: the ops key signs. Scoped writes use signerFor(role).
 * dry-run: transactions are simulated with the agent's public key as the
 * source (from AGENT_SECRET_KEY if set, otherwise the agent recorded in the
 * deployments file) and no signer is attached, so nothing can be signed.
 */
export function agentSigner(): Signer {
  return signerFor('OPS');
}

/** Resolve the identity for a write scope without breaking single-key installs. */
export function signerFor(role: SignerRole): Signer {
  const secret = secretFor(role);
  if (config.CHAIN_EXECUTION_MODE === 'live') {
    if (!secret) throw new Error(`${role} signer is not configured`);
    const keypair = agentKeypair(role);
    const { signTransaction, signAuthEntry } = basicNodeSigner(keypair, config.STELLAR_NETWORK_PASSPHRASE);
    return { publicKey: keypair.publicKey(), signTransaction, signAuthEntry };
  }
  const publicKey = secret
    ? agentKeypair(role).publicKey()
    : DEPLOYED_AGENT;
  return { publicKey };
}

export function agentAddresses(): Record<SignerRole, string> {
  return {
    MARKET_MAKER: signerFor('MARKET_MAKER').publicKey as string,
    TRADER: signerFor('TRADER').publicKey as string,
    OPS: signerFor('OPS').publicKey as string,
  };
}

export const agentClients = {
  // The agent is only the fee source for the resolver: both calls are
  // permissionless (#90).
  resolver: (signer: Signer = agentSigner()) =>
    wrapBindingClient(new ResolverClient(baseOptions(CONTRACTS.resolver, signer)), 'agent.resolver'),
  treasury: (signer: Signer = agentSigner()) =>
    wrapBindingClient(new TreasuryClient(baseOptions(CONTRACTS.treasury, signer)), 'agent.treasury'),
  reasoningRegistry: (signer: Signer = agentSigner()) =>
    wrapBindingClient(new ReasoningRegistryClient(baseOptions(CONTRACTS.reasoningRegistry, signer)), 'agent.reasoningRegistry'),
};
