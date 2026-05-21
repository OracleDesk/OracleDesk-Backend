import { Router } from 'express';
import { listMarkets, getMarket, triggerMarketGeneration, getMarketGenerationStatus } from '../controllers/market.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Public — no auth needed
router.get('/',     listMarkets);

router.get('/:id',  getMarket);

// Protected — requires JWT
router.post('/generate', requireAuth, triggerMarketGeneration);

router.get('/generation-status/:jobId', requireAuth, getMarketGenerationStatus);

export default router;