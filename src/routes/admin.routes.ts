import { Router } from 'express';
import {
  listGenerationRuns,
  getGenerationRun,
  cancelGenerationRun,
} from '../controllers/admin.controller';
import { requireAuth, requireAdmin } from '../middlewares/auth.middleware';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/generation-runs', listGenerationRuns);
router.get('/generation-runs/:id', getGenerationRun);
router.post('/generation-runs/:id/cancel', cancelGenerationRun);

export default router;
