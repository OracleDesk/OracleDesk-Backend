import { Router } from 'express';
import { approveResolution, getResolution } from '../controllers/oracle.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.get('/markets/:marketId/resolution', getResolution);
router.post('/resolve', requireAuth, approveResolution);

export default router;
