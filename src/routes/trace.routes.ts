import { Router } from 'express';
import {
  getMyPaymentEvents,
  getMySpendingAllowance,
  getTrace,
  listTraces,
  setSpendingAllowance,
  unlockTrace,
  verifyTrace,
} from '../controllers/trace.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Public
router.get('/',             listTraces);
router.get('/access/allowance', requireAuth, getMySpendingAllowance);
router.put('/access/allowance', requireAuth, setSpendingAllowance);
router.get('/payments', requireAuth, getMyPaymentEvents);
router.get('/:id',          getTrace);   // Returns preview if unauthenticated

// Protected
router.post('/verify',       requireAuth, verifyTrace);
router.post('/:id/unlock',   requireAuth, unlockTrace);

export default router;
