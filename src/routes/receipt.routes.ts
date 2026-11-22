import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { asyncHandler } from '../utils/response.util';
import { getReceipt, listReceipts, postRedeemReceipt } from '../controllers/receipt.controller';

const router = Router();

router.get('/', requireAuth, asyncHandler(listReceipts));
router.get('/:id', requireAuth, asyncHandler(getReceipt));
router.post('/redeem', requireAuth, asyncHandler(postRedeemReceipt));

export default router;
