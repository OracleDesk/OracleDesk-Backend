import { Router } from 'express';
import { listMarkets, getMarket, triggerMarketGeneration } from '../controllers/market.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Public — no auth needed
router.get('/',     listMarkets);
router.get('/:id',  getMarket);

// Protected — requires JWT
router.post('/generate', requireAuth, triggerMarketGeneration);

export default router;