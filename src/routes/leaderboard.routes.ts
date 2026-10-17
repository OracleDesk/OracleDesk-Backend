import { Router } from 'express';
import { getLeaderboard, getWalletStats } from '../controllers/leaderboard.controller';

const router = Router();

router.get('/leaderboard', getLeaderboard);
router.get('/wallets/:address/stats', getWalletStats);

export default router;
