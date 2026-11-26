import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAgentLog } from '../lib/agent-log';
import { CONTRACTS } from '../config/contracts';
import { getTransactionReader, readContractEvents } from './stellar/tx-inspect';

export interface AgentTradeFill {
  collateral: bigint;
  shares: bigint;
  fee: bigint;
  reserveYes: bigint;
  reserveNo: bigint;
  ledger: number | null;
  source: 'rpc-event' | 'chain-events';
}

export interface FillCheckExpectation {
  simulatedShares?: bigint | null;
  minSharesOut?: bigint | null;
  maxSharesIn?: bigint | null;
  requestedCollateral?: bigint | null;
  marketId?: string | null;
  refId: string;
  kind: 'buy' | 'sell';
}

function outcomeTag(raw: unknown): 'Yes' | 'No' | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw === 'Yes' || raw === 'No' ? raw : null;
  if (typeof raw === 'object' && 'tag' in raw) {
    const tag = (raw as { tag?: unknown }).tag;
    return tag === 'Yes' || tag === 'No' ? tag : null;
  }
  return null;
}

function parseTradeEventParams(
  data: Record<string, any>,
  ledger: number | null,
  source: 'rpc-event' | 'chain-events',
  opts: { onChainMarketId?: bigint; isBuy: boolean; outcome?: 'Yes' | 'No' },
): AgentTradeFill | null {
  if (Boolean(data.is_buy) !== opts.isBuy) return null;
  if (opts.onChainMarketId !== undefined && data.market_id !== undefined) {
    if (BigInt(data.market_id) !== opts.onChainMarketId) return null;
  }
  if (opts.outcome !== undefined && data.outcome !== undefined) {
    const tag = outcomeTag(data.outcome);
    if (tag && tag !== opts.outcome) return null;
  }
  return {
    collateral: BigInt(data.collateral ?? 0),
    shares: BigInt(data.shares ?? 0),
    fee: BigInt(data.fee ?? 0),
    reserveYes: BigInt(data.reserve_yes ?? 0),
    reserveNo: BigInt(data.reserve_no ?? 0),
    ledger,
    source,
  };
}

/**
 * Extracts a market-core Trade fill from a GetTransactionResponse.
 */
export function extractTradeFillFromResponse(
  response: unknown,
  opts: { onChainMarketId?: bigint; isBuy: boolean; outcome?: 'Yes' | 'No' },
): AgentTradeFill | null {
  if (!response || typeof response !== 'object') return null;
  const resp = response as any;
  const events = readContractEvents(resp, CONTRACTS.marketCore);
  const ledger = typeof resp.ledger === 'number' ? resp.ledger : null;

  for (const ev of events) {
    if (ev.name !== 'Trade') continue;
    const fill = parseTradeEventParams(ev.data, ledger, 'rpc-event', opts);
    if (fill) return fill;
  }
  return null;
}

/**
 * Resolves the authoritative on-chain Trade event for an agent buy or sell:
 * 1. Confirmed RPC response passed inline or from recovery
 * 2. RPC getTransaction(hash), trying landed (outer) hash before inner hash
 * 3. Indexed `chain_events` table fallback
 */
export async function resolveAgentTradeFill(opts: {
  confirmedTx?: unknown;
  txHashes: Array<string | null | undefined>;
  onChainMarketId?: bigint;
  isBuy: boolean;
  outcome?: 'Yes' | 'No';
}): Promise<AgentTradeFill | null> {
  if (opts.confirmedTx) {
    const inline = extractTradeFillFromResponse(opts.confirmedTx, opts);
    if (inline) return inline;
  }

  const uniqueHashes = [...new Set(opts.txHashes.filter((h): h is string => Boolean(h)))];

  for (const hash of uniqueHashes) {
    try {
      const resp = await getTransactionReader().getTransaction(hash);
      if ((resp as any)?.status === 'SUCCESS') {
        const fill = extractTradeFillFromResponse(resp, opts);
        if (fill) return fill;
      }
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : err, hash }, 'resolveAgentTradeFill: RPC lookup failed');
    }
  }

  if (uniqueHashes.length > 0) {
    const stored = await prisma.chainEvent.findMany({
      where: {
        contractName: 'marketCore',
        eventName: 'Trade',
        txHash: { in: uniqueHashes },
      },
      orderBy: [{ ledger: 'desc' }, { id: 'desc' }],
    });
    for (const ev of stored) {
      const fill = parseTradeEventParams(
        (ev.params ?? {}) as Record<string, any>,
        ev.ledger,
        'chain-events',
        opts,
      );
      if (fill) return fill;
    }
  }

  return null;
}

/**
 * Compares the confirmed Trade event against simulated/requested bounds.
 * Returns a mismatch record (and logs a warning + AgentLog) if any bound or
 * simulation expectation was violated.
 */
export async function checkFillDiscrepancies(
  fill: AgentTradeFill,
  expect: FillCheckExpectation,
): Promise<Record<string, unknown> | null> {
  const issues: Record<string, unknown> = {};

  if (expect.simulatedShares !== undefined && expect.simulatedShares !== null && expect.simulatedShares > 0n) {
    if (fill.shares !== expect.simulatedShares) {
      issues.simulatedShares = expect.simulatedShares.toString();
      issues.actualShares = fill.shares.toString();
    }
  }

  if (expect.kind === 'buy' && expect.minSharesOut !== undefined && expect.minSharesOut !== null && expect.minSharesOut > 0n) {
    if (fill.shares < expect.minSharesOut) {
      issues.slippageViolation = {
        bound: 'min_shares_out',
        expectedMin: expect.minSharesOut.toString(),
        actual: fill.shares.toString(),
      };
    }
  }

  if (expect.kind === 'sell' && expect.maxSharesIn !== undefined && expect.maxSharesIn !== null && expect.maxSharesIn > 0n) {
    if (fill.shares > expect.maxSharesIn) {
      issues.slippageViolation = {
        bound: 'max_shares_in',
        expectedMax: expect.maxSharesIn.toString(),
        actual: fill.shares.toString(),
      };
    }
  }

  if (expect.requestedCollateral !== undefined && expect.requestedCollateral !== null && expect.requestedCollateral > 0n) {
    if (fill.collateral !== expect.requestedCollateral) {
      issues.requestedCollateral = expect.requestedCollateral.toString();
      issues.actualCollateral = fill.collateral.toString();
    }
  }

  if (Object.keys(issues).length === 0) return null;

  const payload = {
    refId: expect.refId,
    kind: expect.kind,
    source: fill.source,
    ledger: fill.ledger,
    ...issues,
  };

  logger.warn(payload, 'Agent trade fill discrepancy detected against simulation/bounds');
  await writeAgentLog({
    agentType: 'TRADER',
    level: 'WARN',
    action: 'TRADE_FILL_MISMATCH',
    marketId: expect.marketId ?? undefined,
    data: payload,
  }).catch(() => undefined);

  return payload;
}
