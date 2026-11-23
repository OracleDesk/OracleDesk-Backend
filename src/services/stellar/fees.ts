import { config } from '../../config';
import { logger } from '../../lib/logger';
import { prisma as defaultPrisma } from '../../lib/prisma';
import { AlertService } from '../alerts.service';
import { rpcServer } from './clients';
import { withTimeout } from '../../lib/resilience';

export type OperationClass = 'market_create' | 'trade' | 'trace_publish' | 'maintenance';

export const OPERATION_CLASSES: readonly OperationClass[] = [
  'market_create',
  'trade',
  'trace_publish',
  'maintenance',
] as const;

export type PercentileKey =
  | 'p10'
  | 'p20'
  | 'p30'
  | 'p40'
  | 'p50'
  | 'p60'
  | 'p70'
  | 'p80'
  | 'p90'
  | 'p95'
  | 'p99'
  | 'min'
  | 'mode'
  | 'max';

export interface FeePolicy {
  percentile: PercentileKey;
  floor: bigint;
  cap: bigint;
  budget: bigint;
}

export const DEFAULT_FEE_POLICIES: Record<OperationClass, FeePolicy> = {
  market_create: {
    percentile: 'p90',
    floor: 100_000n,
    cap: 5_000_000n,
    budget: 50_000_000n,
  },
  trade: {
    percentile: 'p80',
    floor: 10_000n,
    cap: 2_000_000n,
    budget: 25_000_000n,
  },
  trace_publish: {
    percentile: 'p50',
    floor: 10_000n,
    cap: 1_000_000n,
    budget: 15_000_000n,
  },
  maintenance: {
    percentile: 'p50',
    floor: 10_000n,
    cap: 1_000_000n,
    budget: 15_000_000n,
  },
};

export const BUDGET_WARNING_RATIO = 0.8;
const DEFAULT_OBSERVED_SAMPLE_SIZE = 100;

export interface ObservedClassMetrics {
  sampleCount: number;
  /** Mean ratio `(nonRefundable + refundable) / resourceFee` across the last N receipts. */
  observedResourceRatio: number | null;
  /** 95th percentile of `nonRefundable + refundable` across the last N receipts. */
  p95ChargedResource: bigint | null;
  /** `p95ChargedResource / budget`, or null if no samples. */
  budgetUtilization: number | null;
  /** True when `p95ChargedResource > 0.8 * budget`. */
  warning: boolean;
  refreshedAt: Date | null;
}

export interface FeeOracleSnapshot {
  networkPassphrase: string;
  rpcUrl: string;
  lastFetchedAt: Date | null;
  cachedUntil: Date | null;
  stale: boolean;
  sorobanInclusionFee: Record<string, string> | null;
  policies: Record<OperationClass, {
    percentile: string;
    floor: string;
    cap: string;
    budget: string;
  }>;
  observed: Record<OperationClass, {
    sampleCount: number;
    observedResourceRatio: number | null;
    p95ChargedResource: string | null;
    budgetUtilization: number | null;
    warning: boolean;
    refreshedAt: Date | null;
  }>;
}

export interface FeeStatsSource {
  getFeeStats(): Promise<any>;
}

interface ChainFeeReceiptRow {
  resourceFee: bigint;
  nonRefundableCharged: bigint | null;
  refundableCharged: bigint | null;
}

function emptyObserved(): ObservedClassMetrics {
  return {
    sampleCount: 0,
    observedResourceRatio: null,
    p95ChargedResource: null,
    budgetUtilization: null,
    warning: false,
    refreshedAt: null,
  };
}

/** Nearest-rank p95 over a non-empty BigInt array. */
function p95BigInt(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[idx];
}

export class FeeOracle {
  private cacheKey: string;
  private policies: Record<OperationClass, FeePolicy>;
  private lastStats: any = null;
  private lastFetchedAt: number | null = null;
  private inFlightPromise: Promise<any> | null = null;
  private feeStatsSource: FeeStatsSource;
  private observedMetrics: Record<OperationClass, ObservedClassMetrics>;

  constructor(
    private networkPassphrase: string = config.STELLAR_NETWORK_PASSPHRASE,
    private rpcUrl: string = config.STELLAR_RPC_URL,
    private cacheTtlMs: number = config.FEE_STATS_CACHE_MS,
    private maxAgeMs: number = config.FEE_STATS_MAX_AGE_MS,
    customSource?: FeeStatsSource,
  ) {
    this.cacheKey = `${this.networkPassphrase}:${this.rpcUrl}`;
    this.feeStatsSource = customSource ?? rpcServer;
    this.policies = this.loadPolicies();
    this.observedMetrics = {
      market_create: emptyObserved(),
      trade: emptyObserved(),
      trace_publish: emptyObserved(),
      maintenance: emptyObserved(),
    };
  }

  public setSource(source: FeeStatsSource) {
    this.feeStatsSource = source;
  }

  public resetCache(): void {
    this.lastStats = null;
    this.lastFetchedAt = null;
    this.inFlightPromise = null;
  }

  public getPolicies(): Record<OperationClass, FeePolicy> {
    return this.policies;
  }

  /** Cached charged-to-simulated resource ratio from the last N receipts (#308). */
  public observedResourceRatio(opClass: OperationClass): number | null {
    return this.observedMetrics[opClass]?.observedResourceRatio ?? null;
  }

  /** Cached p95 charged resource fee (nonRefundable + refundable) from the last N receipts (#308). */
  public p95ChargedResource(opClass: OperationClass): bigint | null {
    return this.observedMetrics[opClass]?.p95ChargedResource ?? null;
  }

  /**
   * Recomputes `observedResourceRatio` and `p95ChargedResource` per class from
   * the last `sampleSize` RECEIPT rows in `chain_fees` (#308).
   *
   * When `p95ChargedResource > 0.8 × budget`, logs a warning and raises a WARN
   * alert via `AlertService`. Never modifies configured budgets automatically.
   */
  public async refreshObservedMetrics(opts: {
    sampleSize?: number;
    prisma?: typeof defaultPrisma;
    alerts?: AlertService;
    now?: Date;
  } = {}): Promise<Record<OperationClass, ObservedClassMetrics>> {
    const db = opts.prisma ?? defaultPrisma;
    const sampleSize = opts.sampleSize ?? DEFAULT_OBSERVED_SAMPLE_SIZE;
    const now = opts.now ?? new Date();
    const utcDay = now.toISOString().slice(0, 10);
    const chainFeeModel = (db as unknown as {
      chainFee: {
        findMany(args: unknown): Promise<ChainFeeReceiptRow[]>;
      };
    }).chainFee;

    for (const opClass of OPERATION_CLASSES) {
      const rows = await chainFeeModel.findMany({
        where: {
          opClass,
          source: 'RECEIPT',
          nonRefundableCharged: { not: null },
          refundableCharged: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: sampleSize,
        select: {
          resourceFee: true,
          nonRefundableCharged: true,
          refundableCharged: true,
        },
      });

      const chargedResources: bigint[] = [];
      let ratioSum = 0;
      let ratioCount = 0;

      for (const r of rows) {
        if (r.nonRefundableCharged === null || r.refundableCharged === null) continue;
        const charged = BigInt(r.nonRefundableCharged) + BigInt(r.refundableCharged);
        chargedResources.push(charged);
        const estimated = BigInt(r.resourceFee);
        if (estimated > 0n) {
          ratioSum += Number(charged) / Number(estimated);
          ratioCount++;
        }
      }

      if (chargedResources.length === 0) {
        this.observedMetrics[opClass] = { ...emptyObserved(), refreshedAt: now };
        continue;
      }

      const p95 = p95BigInt(chargedResources);
      const ratio = ratioCount > 0 ? ratioSum / ratioCount : null;
      const budget = this.policies[opClass].budget;
      const budgetUtilization = budget > 0n ? Number(p95) / Number(budget) : null;
      const warning = budget > 0n && p95 * 10n > budget * 8n;

      this.observedMetrics[opClass] = {
        sampleCount: chargedResources.length,
        observedResourceRatio: ratio,
        p95ChargedResource: p95,
        budgetUtilization,
        warning,
        refreshedAt: now,
      };

      if (warning) {
        logger.warn(
          {
            opClass,
            p95ChargedResource: p95.toString(),
            budget: budget.toString(),
            budgetUtilization,
            observedResourceRatio: ratio,
          },
          'Fee oracle: p95 charged resource fee exceeds 80% of budget (adjust FEE_POLICY_JSON)',
        );
        const alerts = opts.alerts ?? new AlertService();
        await alerts
          .send(`fee_budget:${opClass}:${utcDay}`, {
            kind: 'fee_budget',
            level: 'WARN',
            title: `Soroban resource fee p95 approaching budget for ${opClass}`,
            opClass,
            p95ChargedResource: p95.toString(),
            budget: budget.toString(),
            utilizationRatio: budgetUtilization ?? BUDGET_WARNING_RATIO,
            observedResourceRatio: ratio,
            detail: `p95 charged resource fee (${p95.toString()} stroops) exceeds 80% of budget (${budget.toString()} stroops). Tune FEE_POLICY_JSON if needed.`,
          })
          .catch((err) => {
            logger.warn({ opClass, err: err instanceof Error ? err.message : String(err) }, 'Fee oracle: failed to send budget warning alert');
          });
      }
    }

    return { ...this.observedMetrics };
  }

  private loadPolicies(): Record<OperationClass, FeePolicy> {
    const policies: Record<OperationClass, FeePolicy> = {
      market_create: { ...DEFAULT_FEE_POLICIES.market_create },
      trade: { ...DEFAULT_FEE_POLICIES.trade },
      trace_publish: { ...DEFAULT_FEE_POLICIES.trace_publish },
      maintenance: { ...DEFAULT_FEE_POLICIES.maintenance },
    };

    const overrideJson: string = config.FEE_POLICY_JSON;
    if (overrideJson) {
      try {
        const overrides = typeof overrideJson === 'string' ? JSON.parse(overrideJson) : overrideJson;
        for (const [cls, pol] of Object.entries(overrides)) {
          if (OPERATION_CLASSES.includes(cls as OperationClass) && pol && typeof pol === 'object') {
            const p = pol as any;
            const existing = policies[cls as OperationClass];
            policies[cls as OperationClass] = {
              percentile: p.percentile ?? existing.percentile,
              floor: p.floor !== undefined ? BigInt(p.floor) : existing.floor,
              cap: p.cap !== undefined ? BigInt(p.cap) : existing.cap,
              budget: p.budget !== undefined ? BigInt(p.budget) : existing.budget,
            };
          }
        }
      } catch (err) {
        logger.error({ err }, 'Failed to parse FEE_POLICY_JSON override');
      }
    }
    return policies;
  }

  public async fetchFeeStats(): Promise<any> {
    const now = Date.now();
    if (this.lastStats && this.lastFetchedAt && now - this.lastFetchedAt < this.cacheTtlMs) {
      return this.lastStats;
    }

    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = (async () => {
      try {
        const stats = await withTimeout('rpc-read', () => this.feeStatsSource.getFeeStats());
        this.lastStats = stats;
        this.lastFetchedAt = Date.now();
        return stats;
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'getFeeStats RPC call failed');
        if (this.lastStats && this.lastFetchedAt && Date.now() - this.lastFetchedAt < this.maxAgeMs) {
          logger.info('Using last good fee stats within max age window');
          return this.lastStats;
        }
        return null;
      } finally {
        this.inFlightPromise = null;
      }
    })();

    return this.inFlightPromise;
  }

  public async pickInclusionFee(opClass: OperationClass): Promise<bigint> {
    const policy = this.policies[opClass];
    const stats = await this.fetchFeeStats();

    if (!stats || !stats.sorobanInclusionFee) {
      return policy.floor;
    }

    const sFee = stats.sorobanInclusionFee;
    const txCount = sFee.transactionCount !== undefined ? BigInt(sFee.transactionCount) : 0n;
    if (txCount === 0n) {
      return policy.floor;
    }

    const percentileRaw = sFee[policy.percentile];
    if (percentileRaw === undefined || percentileRaw === null || percentileRaw === '') {
      return policy.floor;
    }

    let fee: bigint;
    try {
      fee = BigInt(percentileRaw);
    } catch {
      return policy.floor;
    }

    if (fee < policy.floor) {
      return policy.floor;
    }

    if (fee > policy.cap) {
      logger.warn(
        { opClass, fee: fee.toString(), cap: policy.cap.toString() },
        'Fee percentile value exceeds cap; cap is binding',
      );
      return policy.cap;
    }

    return fee;
  }

  public getSnapshot(): FeeOracleSnapshot {
    const now = Date.now();
    const stale = this.lastFetchedAt ? now - this.lastFetchedAt > this.cacheTtlMs : true;
    return {
      networkPassphrase: this.networkPassphrase,
      rpcUrl: this.rpcUrl,
      lastFetchedAt: this.lastFetchedAt ? new Date(this.lastFetchedAt) : null,
      cachedUntil: this.lastFetchedAt ? new Date(this.lastFetchedAt + this.cacheTtlMs) : null,
      stale,
      sorobanInclusionFee: this.lastStats?.sorobanInclusionFee ?? null,
      policies: Object.fromEntries(
        Object.entries(this.policies).map(([k, v]) => [
          k,
          {
            percentile: v.percentile,
            floor: v.floor.toString(),
            cap: v.cap.toString(),
            budget: v.budget.toString(),
          },
        ]),
      ) as any,
      observed: Object.fromEntries(
        OPERATION_CLASSES.map((cls) => {
          const obs = this.observedMetrics[cls];
          return [
            cls,
            {
              sampleCount: obs.sampleCount,
              observedResourceRatio: obs.observedResourceRatio,
              p95ChargedResource: obs.p95ChargedResource !== null ? obs.p95ChargedResource.toString() : null,
              budgetUtilization: obs.budgetUtilization,
              warning: obs.warning,
              refreshedAt: obs.refreshedAt,
            },
          ];
        }),
      ) as any,
    };
  }
}

const oraclesByCacheKey = new Map<string, FeeOracle>();

export function getFeeOracle(
  networkPassphrase = config.STELLAR_NETWORK_PASSPHRASE,
  rpcUrl = config.STELLAR_RPC_URL,
): FeeOracle {
  const key = `${networkPassphrase}:${rpcUrl}`;
  let oracle = oraclesByCacheKey.get(key);
  if (!oracle) {
    oracle = new FeeOracle(networkPassphrase, rpcUrl);
    oraclesByCacheKey.set(key, oracle);
  }
  return oracle;
}
