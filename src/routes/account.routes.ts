/**
 * Account management routes — premium device registry (#288).
 *
 * GET  /account/devices        list devices for the authenticated user
 * PATCH /account/devices/:id   update a device's label
 * DELETE /account/devices/:id  revoke a device
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { listDevices, labelDevice, revokeDevice } from '../services/premium-session.service';
import { sendError, sendSuccess } from '../utils/response.util';

const router = Router();

router.get('/devices', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const devices = await listDevices(userId);
  sendSuccess(res, { devices });
});

router.patch('/devices/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = String(req.params.id);
  const { label } = req.body as { label?: unknown };
  if (typeof label !== 'string' || label.trim().length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'label must be a non-empty string');
  }
  await labelDevice(userId, id, label.trim());
  sendSuccess(res, { ok: true });
});

router.delete('/devices/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = String(req.params.id);
  await revokeDevice(userId, id, 'USER_REVOKED');
  sendSuccess(res, { ok: true });
});

export default router;
