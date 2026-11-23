import { Router } from 'express';
import { getLeaderboard, getWalletStats } from '../controllers/leaderboard.controller';
import { cachePolicy } from '../middlewares/cache.middleware';

const router = Router();

router.get('/leaderboard', cachePolicy({ kind: 'shared', maxAge: 15, swr: 60 }), getLeaderboard);
router.get('/wallets/:address/stats', cachePolicy({ kind: 'shared', maxAge: 15, swr: 60 }), getWalletStats);

export default router;
