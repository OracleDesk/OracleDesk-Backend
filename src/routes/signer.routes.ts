import { Router } from 'express';
import { requireSigner } from '../middlewares/auth.middleware';
import { signerLimiter } from '../middlewares/rate-limit.middleware';
import {
  listSignerMarkets,
  prepareSignerAttestation,
  signerEvidence,
  signerProgress,
  submitSignerAttestation,
  createSignerEvidenceBundle,
  prepareSignerEvidenceTrace,
  submitSignerEvidenceTrace,
} from '../controllers/signer.controller';

const router = Router();

router.use(signerLimiter, requireSigner);

router.get('/markets', listSignerMarkets);
router.get('/markets/:marketId/evidence', signerEvidence);
router.post('/markets/:marketId/evidence/bundle', createSignerEvidenceBundle);
router.post('/markets/:marketId/evidence/:evidenceId/publish/prepare', prepareSignerEvidenceTrace);
router.post('/markets/:marketId/evidence/:evidenceId/publish/submit', submitSignerEvidenceTrace);
router.post('/markets/:marketId/attest/prepare', prepareSignerAttestation);
router.post('/markets/:marketId/attest/submit', submitSignerAttestation);
router.get('/markets/:marketId/progress', signerProgress);

export default router;
