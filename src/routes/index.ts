import { Router } from 'express';
import marketRoutes    from './market.routes';
import traceRoutes     from './trace.routes';
import portfolioRoutes from './portfolio.routes';
import tradeRoutes     from './trade.routes';
import oracleRoutes    from './oracle.routes';
import { connectWallet } from '../controllers/trade.controller';

const router = Router();

// Auth
router.post('/auth/connect', connectWallet);

// Feature routes
router.use('/markets',   marketRoutes);
router.use('/traces',    traceRoutes);
router.use('/portfolio', portfolioRoutes);
router.use('/trade',     tradeRoutes);
router.use('/oracle',    oracleRoutes);

export default router;
