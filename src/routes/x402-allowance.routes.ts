import { Router } from 'express';
import { commit, release, reserve } from '../controllers/x402-allowance.controller';
import { requireServiceAuth } from '../middlewares/service-auth.middleware';
import { idempotent } from '../middlewares/idempotency.middleware';

/**
 * x402 allowance reservations (#219). Called only by the x402 trace service:
 * HMAC service auth first (so unauthenticated calls never claim an
 * Idempotency-Key), then a required Idempotency-Key.
 */
const router = Router();

router.post('/reserve', requireServiceAuth(), idempotent({ required: true }), reserve);
router.post('/commit', requireServiceAuth(), idempotent({ required: true }), commit);
router.post('/release', requireServiceAuth(), idempotent({ required: true }), release);

export default router;
