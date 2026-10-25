import { Router } from 'express';
import { releaseTraceKeyInternal } from '../controllers/trace.controller';

const router = Router();

router.post('/traces/:onChainTraceId/key', releaseTraceKeyInternal);

export default router;
