import { Router } from 'express';
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listDeliveries,
  listWebhooks,
  redeliver,
  rotateWebhookSecret,
  updateWebhook,
} from '../controllers/webhooks.controller';
import { requireAuth } from '../middlewares/auth.middleware';

// Outbound webhook subscriptions (#128). All owner-scoped.
const router = Router();

router.use(requireAuth);

router.post('/',                                    createWebhook);
router.get('/',                                     listWebhooks);
router.get('/:id',                                  getWebhook);
router.patch('/:id',                                updateWebhook);
router.delete('/:id',                               deleteWebhook);
router.post('/:id/rotate-secret',                   rotateWebhookSecret);
router.get('/:id/deliveries',                       listDeliveries);
router.post('/:id/deliveries/:deliveryId/redeliver', redeliver);

export default router;
