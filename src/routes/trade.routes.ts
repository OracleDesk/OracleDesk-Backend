import { Router } from 'express';
import { initiateCopyTrade, confirmCopyTrade, connectWallet } from '../controllers/trade.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.post('/copy',          requireAuth, initiateCopyTrade);
router.patch('/copy/:id/confirm', requireAuth, confirmCopyTrade);
// router.post('/auth/connect', connectWallet);

export default router;