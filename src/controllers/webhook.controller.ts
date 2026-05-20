import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendError, sendSuccess } from '../utils/response.util';
import {
  extractCircleTransaction,
  verifyCircleWebhookSignature,
} from '../services/circle.service';
import { logger } from '../lib/logger';

export function acknowledgeCircleWebhook(_req: Request, res: Response): void {
  res.status(200).end();
}

export async function handleCircleWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body ?? {}));

  const signature = headerValue(req.headers['x-circle-signature']);
  const keyId = headerValue(req.headers['x-circle-key-id']);

  const valid = await verifyCircleWebhookSignature({ rawBody, signature, keyId });
  if (!valid) {
    sendError(res, 401, 'INVALID_CIRCLE_SIGNATURE', 'Circle webhook signature verification failed');
    return;
  }

  const event = JSON.parse(rawBody.toString('utf8'));
  const transaction = extractCircleTransaction(event.notification);

  if (transaction) {
    await reconcilePaymentFromCircleTransaction(event, transaction);
  }

  sendSuccess(res, { received: true });
}

async function reconcilePaymentFromCircleTransaction(
  event: Record<string, any>,
  transaction: Record<string, any>,
): Promise<void> {
  const txHash = String(transaction.txHash ?? transaction.transactionHash ?? '');
  if (!txHash) return;

  const state = String(transaction.state ?? transaction.status ?? '').toUpperCase();
  const amount = Number(transaction.amounts?.[0] ?? transaction.amount ?? transaction.amountInUSD ?? 0);
  const confirmed = ['COMPLETE', 'CONFIRMED', 'FINALIZED', 'SUCCESS', 'COMPLETED'].includes(state);

  const paymentEvent = await prisma.paymentEvent.findUnique({ where: { txHash } });
  if (!paymentEvent) {
    await prisma.agentLog.create({
      data: {
        agentType: 'TRADER',
        level: 'WARN',
        action: 'UNMATCHED_CIRCLE_PAYMENT_WEBHOOK',
        data: { txHash, state, amount, event, transaction } as any,
      },
    }).catch(err => {
      logger.warn({ err, txHash }, 'Could not log unmatched Circle webhook');
    });
    return;
  }

  await prisma.paymentEvent.update({
    where: { txHash },
    data: {
      status: confirmed ? 'CONFIRMED' : state || 'PENDING',
      confirmedAt: confirmed ? new Date() : paymentEvent.confirmedAt,
      metadata: { ...(paymentEvent.metadata as object ?? {}), lastCircleEvent: event, transaction } as any,
    },
  });

  if (paymentEvent.traceId || paymentEvent.type === 'DAILY_PASS') {
    await prisma.subscription.updateMany({
      where: { txHash },
      data: { status: confirmed ? 'ACTIVE' : 'PENDING_PAYMENT' },
    });
  }
}

const headerValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
