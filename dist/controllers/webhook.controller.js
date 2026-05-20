"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acknowledgeCircleWebhook = acknowledgeCircleWebhook;
exports.handleCircleWebhook = handleCircleWebhook;
const prisma_1 = require("../lib/prisma");
const response_util_1 = require("../utils/response.util");
const circle_service_1 = require("../services/circle.service");
const logger_1 = require("../lib/logger");
function acknowledgeCircleWebhook(_req, res) {
    res.status(200).end();
}
async function handleCircleWebhook(req, res) {
    const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body ?? {}));
    const signature = headerValue(req.headers['x-circle-signature']);
    const keyId = headerValue(req.headers['x-circle-key-id']);
    const valid = await (0, circle_service_1.verifyCircleWebhookSignature)({ rawBody, signature, keyId });
    if (!valid) {
        (0, response_util_1.sendError)(res, 401, 'INVALID_CIRCLE_SIGNATURE', 'Circle webhook signature verification failed');
        return;
    }
    const event = JSON.parse(rawBody.toString('utf8'));
    const transaction = (0, circle_service_1.extractCircleTransaction)(event.notification);
    if (transaction) {
        await reconcilePaymentFromCircleTransaction(event, transaction);
    }
    (0, response_util_1.sendSuccess)(res, { received: true });
}
async function reconcilePaymentFromCircleTransaction(event, transaction) {
    const txHash = String(transaction.txHash ?? transaction.transactionHash ?? '');
    if (!txHash)
        return;
    const state = String(transaction.state ?? transaction.status ?? '').toUpperCase();
    const amount = Number(transaction.amounts?.[0] ?? transaction.amount ?? transaction.amountInUSD ?? 0);
    const confirmed = ['COMPLETE', 'CONFIRMED', 'FINALIZED', 'SUCCESS', 'COMPLETED'].includes(state);
    const paymentEvent = await prisma_1.prisma.paymentEvent.findUnique({ where: { txHash } });
    if (!paymentEvent) {
        await prisma_1.prisma.agentLog.create({
            data: {
                agentType: 'TRADER',
                level: 'WARN',
                action: 'UNMATCHED_CIRCLE_PAYMENT_WEBHOOK',
                data: { txHash, state, amount, event, transaction },
            },
        }).catch(err => {
            logger_1.logger.warn({ err, txHash }, 'Could not log unmatched Circle webhook');
        });
        return;
    }
    await prisma_1.prisma.paymentEvent.update({
        where: { txHash },
        data: {
            status: confirmed ? 'CONFIRMED' : state || 'PENDING',
            confirmedAt: confirmed ? new Date() : paymentEvent.confirmedAt,
            metadata: { ...(paymentEvent.metadata ?? {}), lastCircleEvent: event, transaction },
        },
    });
    if (paymentEvent.traceId || paymentEvent.type === 'DAILY_PASS') {
        await prisma_1.prisma.subscription.updateMany({
            where: { txHash },
            data: { status: confirmed ? 'ACTIVE' : 'PENDING_PAYMENT' },
        });
    }
}
const headerValue = (value) => Array.isArray(value) ? value[0] : value;
