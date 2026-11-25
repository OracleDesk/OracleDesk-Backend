import { runTraderCycle } from '../agents/trader.agent';
import { computeCorrelationSnapshot } from '../services/correlation.service';
import { expireStaleSubscriptions, notifyExpiringPasses } from '../services/subscription.service';
import { logger } from '../lib/logger';
import { config } from '../config';
import { postgresContentStore } from '../services/content-store.service';
import { purgeExpiredIdempotencyKeys } from '../middlewares/idempotency.middleware';
import { computeAndStoreSnapshots } from '../services/calibration.service';
import { fitAndStoreMaps } from '../services/recalibration.service';
import { purgeSignalStore } from '../services/signal-store.service';
import { expireReservations } from '../services/market-reservation.service';
import { computeAndStoreRiskSnapshot } from '../services/portfolio-risk.service';
import { priceBpsFromRaw, toDisplayUsdc } from '../lib/amounts';
import type { VerifiedCopyTrade } from '../services/copy-trade.service';

let runningTraderCycleId: string | null = null;
let correlationSnapshotRunning = false;
let riskSnapshotRunning = false;

/** One correlated context per cron tick. */
function tick(job: string, fn: () => Promise<void>): Promise<void> {
  const cycleId = newId('cyc');
  return runWithContext({ requestId: cycleId, cycleId, kind: 'cron', job }, fn);
}

/**
 * Position Monitor & Maintenance Crons — all scheduled via `scheduleJob` (#336).
 */
export function startMonitorCron(): void {
  // Correlation snapshot (#80) — every 15 minutes, just before the trader reads it.
  scheduleJob('correlation-snapshot', async () => {
    const snapshot = await computeCorrelationSnapshot();
    if (!snapshot) return { outcome: 'SKIPPED_LOCK_HELD' };
    return { outcome: 'SUCCESS', counters: { pairs: snapshot.pairs } };
  });

  // Portfolio risk snapshots (#280) — every 15 minutes, after correlation snapshot
  scheduleJob('portfolio-risk', async () => {
    await computeAndStoreRiskSnapshot();
    return { outcome: 'SUCCESS' };
  });

  // Trader Agent — every 15 minutes
  scheduleJob('trader', async ({ signal }) => {
    const res = await runTraderCycle({ signal });
    return { outcome: res.outcome };
  });

  // IPFS pin replication and repair (#271) — hourly under a Postgres advisory lock.
  cron.schedule('25 * * * *', () => tick('ipfs-replication', async () => {
    const startedAt = new Date();
    try {
      await runIpfsReplicationJob();
      recordCronRun('ipfs-replication', 'success', startedAt, new Date());
    } catch (err) {
      recordCronRun('ipfs-replication', 'failure', startedAt, new Date(), err);
      logger.error({ err }, 'Monitor cron: IPFS replication job failed');
    }
  }));

  // Calibration snapshots (#68) — daily at 03:10. The computation takes a
  // Postgres advisory lock, so with several instances only one does the work.
  scheduleJob('calibration', async () => {
    const run = await computeAndStoreSnapshots();
    if (!run) return { outcome: 'SKIPPED_LOCK_HELD' };
    // #244: refit per-category recalibration maps from the same resolved data.
    await fitAndStoreMaps().catch((err) => logger.warn({ err }, 'Monitor cron: recalibration refit failed'));
    return { outcome: 'SUCCESS' };
  });

  // Signal store retention (#73) — nightly at 03:41
  scheduleJob('signal-retention', async () => {
    const res = await purgeSignalStore();
    return {
      outcome: 'SUCCESS',
      counters: {
        rawPayloads: res.rawPayloads,
        fetches: res.fetches,
        signals: res.signals,
      },
    };
  });

  // Subscription expiry — every hour
  scheduleJob('subscription-expiry', async () => {
    const expired = await expireStaleSubscriptions();
    return { outcome: 'SUCCESS', counters: { expired } };
  });

  // PASS_EXPIRING socket events (#94) — every 10 minutes, once per pass.
  scheduleJob('pass-expiry-notify', async () => {
    const notified = await notifyExpiringPasses();
    return { outcome: 'SUCCESS', counters: { notified } };
  });

  // Expired Idempotency-Key rows (24h TTL, #123) — hourly at :10, in batches of 5 000
  scheduleJob('idempotency-purge', async () => {
    const deleted = await purgeExpiredIdempotencyKeys();
    if (deleted > 0) logger.info({ deleted }, 'Monitor cron: purged expired idempotency keys');
    return { outcome: 'SUCCESS', counters: { deleted } };
  });

  // Market reservation lease expiry (#283) — every 5 minutes
  scheduleJob('reservation-expiry', async () => {
    const expired = await expireReservations();
    return { outcome: 'SUCCESS', counters: { expired } };
  });

  // Copy trade sweep — every 5 minutes
  scheduleJob('copy-trade-sweep', sweepCopyTrades);

  // IPFS content eviction (#100) — hourly at :30, bounded batches.
  scheduleJob('ipfs-eviction', async () => {
    const result = await postgresContentStore.evict(config.IPFS_CACHE_BUDGET_BYTES);
    if (result.removed > 0) logger.info(result, 'Monitor cron: evicted IPFS content');
    return { outcome: 'SUCCESS', counters: { removed: result.removed } };
  });

  // Fee oracle observed resource ratios & budget warnings (#308) — every 15 minutes.
  cron.schedule('7,22,37,52 * * * *', () => tick('fee-oracle-observed', async () => {
    const startedAt = new Date();
    try {
      await getFeeOracle().refreshObservedMetrics();
      recordCronRun('fee-oracle-observed', 'success', startedAt, new Date());
    } catch (err) {
      recordCronRun('fee-oracle-observed', 'failure', startedAt, new Date(), err);
      logger.error({ err }, 'Monitor cron: fee oracle observed metrics refresh failed');
    }
  }));

  logger.info('Monitor cron started');
}

let sweepRunning = false;
async function sweepCopyTrades(): Promise<void> {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const { prisma } = await import('../lib/prisma');
    const {
      CopyTradeStatus,
      expireStaleCopyTrades,
      verifyCopyTradeTx,
      verifyCopyTradeEvidence,
      transitionCopyTrade,
      CopyTradePendingError,
    } = await import('../services/copy-trade.service');
    const { AppError } = await import('../middlewares/error.middleware');

    await expireStaleCopyTrades();

    const confirming = await prisma.copyTrade.findMany({
      where: {
        status: CopyTradeStatus.CONFIRMING,
        verificationAttempts: { lt: 20 },
        txHash: { not: null },
      },
      include: { market: { select: { onChainMarketId: true } } },
      take: 20,
    });

    for (const ct of confirming) {
      if (!ct.txHash || ct.market?.onChainMarketId == null) continue;
      try {
        // Check chain_events first for stored Trade events
        const storedEvents = await prisma.chainEvent.findMany({
          where: {
            txHash: ct.txHash,
            eventName: 'Trade',
            contractName: 'marketCore',
          },
          orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
        });
        let verified: VerifiedCopyTrade;
        if (storedEvents.length > 0) {
          const outcome = ct.direction === 'YES' ? 'Yes' : 'No';
          try {
            if (storedEvents.some((event) =>
              !event.params || typeof event.params !== 'object' || Array.isArray(event.params),
            )) {
              throw new AppError(422, 'COPY_TRADE_INVALID_EVENT', 'Stored Trade event parameters are invalid');
            }
            verified = verifyCopyTradeEvidence(
              {
                txHash: ct.txHash,
                trader: ct.followerWallet,
                onChainMarketId: ct.market.onChainMarketId,
                outcome,
                maxCollateral: BigInt(ct.amountRaw ?? '0'),
              },
              {
                txHash: ct.txHash,
                ledger: storedEvents[0].ledger,
                events: storedEvents.map((storedEvent) => ({
                    id: storedEvent.id,
                    contractId: storedEvent.contractId,
                    name: storedEvent.eventName,
                    data: storedEvent.params as Record<string, unknown>,
                  })),
              },
            );
          } catch (err) {
            if (!(err instanceof AppError) || err.statusCode !== 422) throw err;
            verified = await verifyCopyTradeTx({
              txHash: ct.txHash,
              trader: ct.followerWallet,
              onChainMarketId: ct.market.onChainMarketId,
              outcome,
              maxCollateral: BigInt(ct.amountRaw ?? '0'),
            });
          }
        } else {
          // Otherwise verify via RPC, using the same evidence rules.
          verified = await verifyCopyTradeTx({
            txHash: ct.txHash,
            trader: ct.followerWallet,
            onChainMarketId: ct.market.onChainMarketId,
            outcome: ct.direction === 'YES' ? 'Yes' : 'No',
            maxCollateral: BigInt(ct.amountRaw ?? '0'),
          });
        }

        const matchedStoredEvent = verified.eventId
          ? storedEvents.find((event) => event.id === verified.eventId)
          : null;
        if (verified.eventId && !matchedStoredEvent) {
          throw new AppError(500, 'COPY_TRADE_EVENT_RECORD_MISSING', 'Verified chain event was not found in storage');
        }
        await transitionCopyTrade(prisma, ct, ct.txHash, {
          status: CopyTradeStatus.EXECUTED,
          collateralRaw: verified.collateral.toString(),
          sharesRaw: verified.shares.toString(),
          feeRaw: verified.fee.toString(),
          priceBps: priceBpsFromRaw(verified.collateral, verified.shares),
          ledger: verified.ledger,
          chainEventId: verified.eventId,
          confirmedAt: matchedStoredEvent ? new Date(matchedStoredEvent.ledgerClosedAt) : new Date(),
          amount: toDisplayUsdc(verified.collateral),
          failureCode: null,
        });
      } catch (err: any) {
        if (err instanceof CopyTradePendingError) {
          await transitionCopyTrade(prisma, ct, ct.txHash, {
            status: CopyTradeStatus.CONFIRMING,
            verificationAttempts: { increment: 1 },
          });
        } else if (err instanceof AppError && err.statusCode === 422) {
          await transitionCopyTrade(prisma, ct, ct.txHash, {
            status: CopyTradeStatus.FAILED,
            failureCode: err.code,
          });
        } else {
          logger.warn({ err, copyTradeId: ct.id }, 'Copy trade verification retry failed');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Copy trade sweep failed');
  } finally {
    sweepRunning = false;
  }
}
