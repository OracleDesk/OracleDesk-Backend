import { Contract, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { config } from '../config';
import { CONTRACTS } from '../config/contracts';
import { prisma } from '../lib/prisma';
import type { Market as OnChainMarket, Position } from '../generated/market-core';
import {
  getOnChainMarket,
  getOnChainTrace,
  getPosition,
  marketCount,
  treasuryAvailableCapital,
  treasuryConfig,
  treasuryDailyUsage,
} from './chain.service';
import { readClients, rpcServer } from './stellar/clients';

export interface ReportChainEventRow {
  contractName: string;
  eventName: string;
  ledger: number;
  ledgerClosedAt: Date;
  params: unknown;
}

export interface ReportContracts {
  treasury: string;
  marketCore: string;
  usdc: string;
  reasoningRegistry: string;
}

/**
 * Pluggable chain + event reader for transparency report building and
 * `--rebuild` verification (#301). Implemented by both the live RPC/Postgres
 * reader and the recorded fixture reader.
 */
export interface ReportChainReader {
  readonly network: string;
  readonly contracts: ReportContracts;
  readonly methodDoc: string;
  readonly useTraceCache: boolean;
  latestLedger(): Promise<number>;
  ledgerClosedAt(ledger: number): Promise<string>;
  ledgerEntries(): Promise<Array<{ lastModifiedLedgerSeq: number }>>;
  marketCount(): Promise<bigint>;
  getMarket(id: bigint): Promise<OnChainMarket>;
  getPosition(id: bigint, holder: string): Promise<Position>;
  treasuryConfig(): Promise<{ agent: string; max_daily: bigint; max_market: bigint; max_trade: bigint }>;
  dailyUsage(): Promise<{ amount: bigint; day_start: bigint }>;
  availableCapital(): Promise<bigint>;
  usdcBalance(holder: string): Promise<bigint>;
  traceCount(): Promise<bigint>;
  getTrace(id: bigint): Promise<{ agent: string; action: string }>;
  chainEvents(from: Date, to: Date): Promise<ReportChainEventRow[]>;
  indexerCursor(): Promise<number | null>;
  previousReport(date: string): Promise<{ onChainTraceId: bigint | null; hash: string } | null>;
}

export const DEFAULT_METHOD_DOC =
  'https://github.com/OracleDesk/oracledesk-backend/blob/main/docs/transparency-reports.md';

/** Reads the USDC SAC balance of `holder` at the current RPC ledger. */
export async function readUsdcBalanceFromRpc(holder: string): Promise<bigint> {
  const usdc = new Contract(CONTRACTS.usdc);
  const { ScInt, Address } = await import('@stellar/stellar-sdk');
  void ScInt;
  const tx = await rpcServer.simulateTransaction(
    new (await import('@stellar/stellar-sdk')).TransactionBuilder(
      new (await import('@stellar/stellar-sdk')).Account(holder, '0'),
      { fee: '100', networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE },
    )
      .addOperation(usdc.call('balance', new Address(holder).toScVal()))
      .setTimeout(30)
      .build(),
  );
  if (!rpc.Api.isSimulationSuccess(tx) || !tx.result?.retval) {
    throw new Error(`USDC balance simulation failed for ${holder}`);
  }
  return BigInt(scValToNative(tx.result.retval));
}

/** Reads the close time of `ledger` as an ISO-8601 UTC string from Soroban RPC. */
export async function readLedgerClosedAtFromRpc(ledger: number): Promise<string> {
  const res = await rpcServer.getLedgers({ startLedger: ledger, pagination: { limit: 1 } });
  const hit = res.ledgers?.find((l) => l.sequence === ledger) ?? res.ledgers?.[0];
  if (!hit?.ledgerCloseTime) {
    throw new Error(`Unable to resolve close time for ledger ${ledger}`);
  }
  return new Date(Number(hit.ledgerCloseTime) * 1000).toISOString();
}

export function createLiveReportChainReader(): ReportChainReader {
  return {
    network: config.STELLAR_NETWORK_PASSPHRASE,
    contracts: {
      treasury: CONTRACTS.treasury,
      marketCore: CONTRACTS.marketCore,
      usdc: CONTRACTS.usdc,
      reasoningRegistry: CONTRACTS.reasoningRegistry,
    },
    methodDoc: process.env.REPORT_METHOD_DOC ?? DEFAULT_METHOD_DOC,
    useTraceCache: true,
    latestLedger: async () => (await rpcServer.getLatestLedger()).sequence,
    ledgerClosedAt: readLedgerClosedAtFromRpc,
    async ledgerEntries() {
      try {
        const key = (xdr.LedgerKey.contractData as any)({
          contract: new Contract(CONTRACTS.treasury).address(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
        });
        const res = await rpcServer.getLedgerEntries(key);
        return (res.entries ?? []).map((entry) => ({
          lastModifiedLedgerSeq: (entry as any).lastModifiedLedgerSeq ?? 0,
        }));
      } catch {
        return [];
      }
    },
    marketCount,
    getMarket: getOnChainMarket,
    getPosition,
    treasuryConfig,
    dailyUsage: treasuryDailyUsage,
    availableCapital: treasuryAvailableCapital,
    usdcBalance: readUsdcBalanceFromRpc,
    traceCount: async () =>
      readClients.reasoningRegistry().trace_count().then((tx) => tx.result as bigint),
    getTrace: getOnChainTrace,
    chainEvents: (from, to) =>
      prisma.chainEvent.findMany({
        where: { ledgerClosedAt: { gte: from, lte: to } },
        orderBy: { ledger: 'asc' },
      }),
    indexerCursor: async () => {
      const cursor = await prisma.indexerCursor.findFirst({ orderBy: { updatedAt: 'desc' } });
      return cursor?.lastLedger ?? null;
    },
    previousReport: async (d) => {
      const prev = await prisma.transparencyReport.findFirst({
        where: { date: { lt: d }, onChainTraceId: { not: null } },
        orderBy: { date: 'desc' },
      });
      return prev ? { onChainTraceId: prev.onChainTraceId, hash: prev.hash } : null;
    },
  };
}

export interface RecordedReportFixture {
  date: string;
  network: string;
  contracts: ReportContracts;
  methodDoc: string;
  latestLedger: number;
  anchorClosedAt: string;
  ledgerEntries: Array<{ lastModifiedLedgerSeq: number }>;
  treasuryConfigXdr: string;
  dailyUsageXdr: string;
  availableCapitalXdr: string;
  usdcBalanceXdr: string;
  markets: Array<{
    marketId: string;
    marketXdr: string;
    positionXdr: string;
  }>;
  traces: Array<{
    traceId: string;
    traceXdr: string;
  }>;
  chainEvents: Array<{
    contractName: string;
    eventName: string;
    ledger: number;
    ledgerClosedAt: string;
    params: unknown;
  }>;
  indexerCursor: number | null;
  previousReport: { onChainTraceId: string; hash: string } | null;
}

function decodeScVal<T = unknown>(b64: string): T {
  return scValToNative(xdr.ScVal.fromXDR(b64, 'base64')) as T;
}

function decodeStatus(raw: unknown): OnChainMarket['status'] {
  if (Array.isArray(raw)) {
    const tag = String(raw[0]);
    if (tag === 'Open') return { tag: 'Open', values: undefined } as OnChainMarket['status'];
    if (tag === 'Void') return { tag: 'Void', values: undefined } as OnChainMarket['status'];
    if (tag === 'Resolved') {
      const inner = Array.isArray(raw[1]) ? String(raw[1][0]) : String(raw[1]);
      return {
        tag: 'Resolved',
        values: [{ tag: inner === 'No' ? 'No' : 'Yes', values: undefined }],
      } as unknown as OnChainMarket['status'];
    }
  }
  return { tag: 'Open', values: undefined } as OnChainMarket['status'];
}

function decodeCategory(raw: unknown): OnChainMarket['category'] {
  const tag = Array.isArray(raw) ? String(raw[0]) : String(raw ?? 'Macro');
  return { tag, values: undefined } as OnChainMarket['category'];
}

/**
 * Deterministic reader backed by a recorded fixture of base64 XDR RPC
 * responses and `chain_events` rows (#301).
 */
export function createFixtureReportChainReader(fixture: RecordedReportFixture): ReportChainReader {
  const marketMap = new Map(fixture.markets.map((m) => [m.marketId, m]));
  const traceMap = new Map(fixture.traces.map((t) => [t.traceId, t]));

  return {
    network: fixture.network,
    contracts: fixture.contracts,
    methodDoc: fixture.methodDoc,
    useTraceCache: false,
    latestLedger: async () => fixture.latestLedger,
    ledgerClosedAt: async (ledger) => {
      if (ledger !== fixture.latestLedger) {
        throw new Error(`Fixture has close time only for ledger ${fixture.latestLedger}, got ${ledger}`);
      }
      return fixture.anchorClosedAt;
    },
    ledgerEntries: async () => fixture.ledgerEntries,
    marketCount: async () => BigInt(fixture.markets.length),
    getMarket: async (id) => {
      const entry = marketMap.get(id.toString());
      if (!entry) throw new Error(`Fixture missing market ${id.toString()}`);
      const raw = decodeScVal<Record<string, unknown>>(entry.marketXdr);
      return {
        creator: String(raw.creator),
        status: decodeStatus(raw.status),
        reserve_yes: BigInt(raw.reserve_yes as string | number | bigint),
        reserve_no: BigInt(raw.reserve_no as string | number | bigint),
        fee_bps: Number(raw.fee_bps),
        lp_claimed: Boolean(raw.lp_claimed),
        fees_accrued: BigInt((raw.fees_accrued as string | number | bigint | undefined) ?? 0n),
        close_time: BigInt((raw.close_time as string | number | bigint | undefined) ?? 0n),
        meta_uri: String(raw.meta_uri ?? ''),
        question_hash: Buffer.from((raw.question_hash as Uint8Array | undefined) ?? []),
        resolution_hash: Buffer.from((raw.resolution_hash as Uint8Array | undefined) ?? []),
        sets_minted: BigInt((raw.sets_minted as string | number | bigint | undefined) ?? 0n),
        category: decodeCategory(raw.category),
      } as OnChainMarket;
    },
    getPosition: async (id) => {
      const entry = marketMap.get(id.toString());
      if (!entry) throw new Error(`Fixture missing position ${id.toString()}`);
      const raw = decodeScVal<Record<string, unknown>>(entry.positionXdr);
      return {
        yes: BigInt(raw.yes as string | number | bigint),
        no: BigInt(raw.no as string | number | bigint),
      } as Position;
    },
    treasuryConfig: async () => {
      const raw = decodeScVal<Record<string, unknown>>(fixture.treasuryConfigXdr);
      return {
        agent: String(raw.agent),
        max_daily: BigInt(raw.max_daily as string | number | bigint),
        max_market: BigInt(raw.max_market as string | number | bigint),
        max_trade: BigInt(raw.max_trade as string | number | bigint),
      };
    },
    dailyUsage: async () => {
      const raw = decodeScVal<Record<string, unknown>>(fixture.dailyUsageXdr);
      return {
        amount: BigInt(raw.amount as string | number | bigint),
        day_start: BigInt(raw.day_start as string | number | bigint),
      };
    },
    availableCapital: async () => BigInt(decodeScVal<string | number | bigint>(fixture.availableCapitalXdr)),
    usdcBalance: async () => BigInt(decodeScVal<string | number | bigint>(fixture.usdcBalanceXdr)),
    traceCount: async () => BigInt(fixture.traces.length),
    getTrace: async (id) => {
      const entry = traceMap.get(id.toString());
      if (!entry) throw new Error(`Fixture missing trace ${id.toString()}`);
      const raw = decodeScVal<Record<string, unknown>>(entry.traceXdr);
      return {
        agent: String(raw.agent),
        action: String(raw.action),
      };
    },
    chainEvents: async (from, to) =>
      fixture.chainEvents
        .map((e) => ({ ...e, ledgerClosedAt: new Date(e.ledgerClosedAt) }))
        .filter((e) => e.ledgerClosedAt >= from && e.ledgerClosedAt <= to)
        .sort((a, b) => a.ledger - b.ledger),
    indexerCursor: async () => fixture.indexerCursor,
    previousReport: async () =>
      fixture.previousReport
        ? { onChainTraceId: BigInt(fixture.previousReport.onChainTraceId), hash: fixture.previousReport.hash }
        : null,
  };
}
