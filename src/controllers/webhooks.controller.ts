import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { assertSafeUrl, SsrfError } from '../lib/ssrf-guard';
import { sendError, sendSuccess, parsePagination, buildPaginationMeta } from '../utils/response.util';
import {
  WEBHOOK_EVENT_TYPES,
  MAX_SUBSCRIPTIONS_PER_USER,
  encryptSecret,
  generateSecret,
  guardOptions,
} from '../services/webhooks.service';

const MARKET_CATEGORIES = [
  'FED', 'ECB', 'ELECTION', 'GEOPOLITICAL',
  'CRYPTO', 'MACRO', 'SPORTS', 'ENTERTAINMENT', 'POLITICS',
] as const;

const filters = {
  eventTypes:       z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).transform((v) => [...new Set(v)]),
  onChainMarketIds: z.array(z.string().regex(/^\d+$/, 'must be a decimal market id')).max(100).default([]),
  categories:       z.array(z.enum(MARKET_CATEGORIES)).default([]),
};

const createSchema = z.object({
  url: z.string().max(2048),
  ...filters,
});

const updateSchema = z.object({
  url:              z.string().max(2048).optional(),
  eventTypes:       filters.eventTypes.optional(),
  onChainMarketIds: z.array(z.string().regex(/^\d+$/)).max(100).optional(),
  categories:       z.array(z.enum(MARKET_CATEGORIES)).optional(),
  status:           z.enum(['ACTIVE', 'DISABLED']).optional(),
});

const SUB_SELECT = {
  id: true,
  url: true,
  eventTypes: true,
  marketIds: true,
  categories: true,
  status: true,
  disabledReason: true,
  consecutiveFailures: true,
  failingSince: true,
  secretRotatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type SubRow = { marketIds: bigint[] } & Record<string, unknown>;

/** Never exposes the (encrypted) secret; market ids as decimal strings. */
function present({ marketIds, ...rest }: SubRow) {
  return { ...rest, onChainMarketIds: marketIds.map(String) };
}

async function validateUrl(res: Response, url: string): Promise<boolean> {
  try {
    await assertSafeUrl(url, guardOptions());
    return true;
  } catch (err) {
    if (err instanceof SsrfError) {
      sendError(res, 400, 'INVALID_WEBHOOK_URL', err.message);
      return false;
    }
    throw err;
  }
}

async function findOwned(req: Request, res: Response) {
  const sub = await prisma.webhookSubscription.findFirst({
    where: { id: String(req.params.id), userId: req.user!.userId },
    select: { id: true, secret: true },
  });
  if (!sub) sendError(res, 404, 'NOT_FOUND', 'Webhook subscription not found');
  return sub;
}

/** POST /webhooks — returns the plaintext secret once. */
export async function createWebhook(req: Request, res: Response): Promise<void> {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid webhook subscription', { issues: parsed.error.issues });
    return;
  }
  const userId = req.user!.userId;
  const count = await prisma.webhookSubscription.count({ where: { userId } });
  if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
    sendError(res, 409, 'WEBHOOK_LIMIT', `At most ${MAX_SUBSCRIPTIONS_PER_USER} webhook subscriptions per user`);
    return;
  }
  if (!(await validateUrl(res, parsed.data.url))) return;

  const secret = generateSecret();
  const sub = await prisma.webhookSubscription.create({
    data: {
      userId,
      url: parsed.data.url,
      eventTypes: parsed.data.eventTypes,
      marketIds: parsed.data.onChainMarketIds.map(BigInt),
      categories: parsed.data.categories,
      secret: encryptSecret(secret),
    },
    select: SUB_SELECT,
  });
  sendSuccess(res, { ...present(sub), secret }, 201);
}

/** GET /webhooks */
export async function listWebhooks(req: Request, res: Response): Promise<void> {
  const subs = await prisma.webhookSubscription.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: 'desc' },
    select: SUB_SELECT,
  });
  sendSuccess(res, subs.map(present));
}

/** GET /webhooks/:id */
export async function getWebhook(req: Request, res: Response): Promise<void> {
  const sub = await prisma.webhookSubscription.findFirst({
    where: { id: String(req.params.id), userId: req.user!.userId },
    select: SUB_SELECT,
  });
  if (!sub) {
    sendError(res, 404, 'NOT_FOUND', 'Webhook subscription not found');
    return;
  }
  sendSuccess(res, present(sub));
}

/** PATCH /webhooks/:id — status=ACTIVE re-enables and resets failure counters. */
export async function updateWebhook(req: Request, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid webhook update', { issues: parsed.error.issues });
    return;
  }
  if (!(await findOwned(req, res))) return;
  const { url, eventTypes, onChainMarketIds, categories, status } = parsed.data;
  if (url !== undefined && !(await validateUrl(res, url))) return;

  const sub = await prisma.webhookSubscription.update({
    where: { id: String(req.params.id) },
    data: {
      ...(url !== undefined ? { url } : {}),
      ...(eventTypes ? { eventTypes } : {}),
      ...(onChainMarketIds ? { marketIds: onChainMarketIds.map(BigInt) } : {}),
      ...(categories ? { categories } : {}),
      ...(status === 'ACTIVE' ? { status, disabledReason: null, consecutiveFailures: 0, failingSince: null } : {}),
      ...(status === 'DISABLED' ? { status, disabledReason: 'Disabled by owner' } : {}),
    },
    select: SUB_SELECT,
  });
  sendSuccess(res, present(sub));
}

/** DELETE /webhooks/:id */
export async function deleteWebhook(req: Request, res: Response): Promise<void> {
  if (!(await findOwned(req, res))) return;
  await prisma.webhookSubscription.delete({ where: { id: String(req.params.id) } });
  sendSuccess(res, { deleted: true });
}

/**
 * POST /webhooks/:id/rotate-secret — returns the new plaintext secret once.
 * Deliveries are signed with both secrets for 24 h.
 */
export async function rotateWebhookSecret(req: Request, res: Response): Promise<void> {
  const current = await findOwned(req, res);
  if (!current) return;
  const secret = generateSecret();
  await prisma.webhookSubscription.update({
    where: { id: current.id },
    data: { secret: encryptSecret(secret), previousSecret: current.secret, secretRotatedAt: new Date() },
  });
  sendSuccess(res, { id: current.id, secret });
}

const DELIVERY_STATUSES = ['PENDING', 'SUCCEEDED', 'DEAD'] as const;

/** GET /webhooks/:id/deliveries?status=&page=&limit= */
export async function listDeliveries(req: Request, res: Response): Promise<void> {
  if (!(await findOwned(req, res))) return;
  const status = req.query.status;
  if (status !== undefined && !DELIVERY_STATUSES.includes(status as (typeof DELIVERY_STATUSES)[number])) {
    sendError(res, 400, 'VALIDATION_ERROR', `status must be one of ${DELIVERY_STATUSES.join(', ')}`);
    return;
  }
  const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
  const where = {
    subscriptionId: String(req.params.id),
    ...(status ? { status: status as (typeof DELIVERY_STATUSES)[number] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        eventId: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
        lastStatusCode: true,
        lastError: true,
        deliveredAt: true,
        createdAt: true,
        event: { select: { type: true } },
      },
    }),
    prisma.webhookDelivery.count({ where }),
  ]);
  const deliveries = rows.map(({ event, ...d }) => ({ ...d, eventType: event.type }));
  sendSuccess(res, deliveries, 200, buildPaginationMeta(page, limit, total) as unknown as Record<string, unknown>);
}

/** POST /webhooks/:id/deliveries/:deliveryId/redeliver */
export async function redeliver(req: Request, res: Response): Promise<void> {
  if (!(await findOwned(req, res))) return;
  const { count } = await prisma.webhookDelivery.updateMany({
    where: { id: String(req.params.deliveryId), subscriptionId: String(req.params.id) },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  if (count === 0) {
    sendError(res, 404, 'NOT_FOUND', 'Delivery not found');
    return;
  }
  sendSuccess(res, { id: String(req.params.deliveryId), status: 'PENDING' });
}
