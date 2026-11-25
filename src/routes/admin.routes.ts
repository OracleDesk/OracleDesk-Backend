import { Router } from 'express';
import { requireAuth, requirePermission, requireStepUp } from '../middlewares/auth.middleware';
import {
  ackAlert,
  ackDispute,
  addOperationSignature,
  cancelDisputeTx,
  cancelTreasuryOperation,
  createOperation,
  getAdminAudit,
  getAdminRoles,
  getAdmins,
  getAgentControls,
  getAlerts,
  getReconciliationRun,
  getSpecCompat,
  getChainSigningKeys,
  registerChainSigningKey,
  retireChainSigningKey,
  silenceAlert,
  getSystemStatus,
  getChainFeesReport,
  pauseAgentControl,
  postGrantAdmin,
  postRevokeAdmin,
  resumeAgentControl,
  getTraceAuditSummary,
  getTreasury,
  getTreasuryOperation,
  getOperationSep7Status,
  issueOperationSep7,
  getDisputes,
  listReconciliationRuns,
  listTreasuryOperations,
  recordTreasuryOperation,
  submitTreasuryOperation,
  triggerReconciliationRun,
  triggerTraceAuditRun,
  voidDisputeTx,
  listChainTransactions,
  getChainTransaction,
  recoverChainTransaction,
  rerunChainTransactionHandler,
  abandonChainTransaction,
} from '../controllers/admin.controller';

const router = Router();

router.use(requireAuth);

// Admin management (#49). Reading the admin list and audit trail requires
// step-up; grant/revoke additionally require admin.manage. The service writes
// the audit row in the same transaction as the change, so they opt out of the
// generic request audit.
router.get('/admins', requirePermission('admin.read'), requireStepUp, getAdmins);
router.get('/roles', requirePermission('admin.read'), getAdminRoles);
router.post('/admins/grant', requirePermission('admin.manage', { audit: false }), requireStepUp, postGrantAdmin);
router.post('/admins/revoke', requirePermission('admin.manage', { audit: false }), requireStepUp, postRevokeAdmin);
router.get('/audit', requirePermission('admin.audit.read'), requireStepUp, getAdminAudit);

router.get('/treasury', requirePermission('treasury.read'), getTreasury);
router.get('/treasury/operations', requirePermission('treasury.read'), listTreasuryOperations);
router.post('/treasury/operations', requirePermission('treasury.operate'), requireStepUp, createOperation);
router.get('/treasury/operations/:id', requirePermission('treasury.read'), getTreasuryOperation);
router.get('/treasury/operations/:id/sep7', requirePermission('treasury.read'), getOperationSep7Status);
router.post('/treasury/operations/:id/sep7', requirePermission('treasury.operate'), requireStepUp, issueOperationSep7);
router.post('/treasury/operations/:id/signatures', requirePermission('treasury.operate'), requireStepUp, addOperationSignature);
router.post('/treasury/operations/:id/submit', requirePermission('treasury.operate'), requireStepUp, submitTreasuryOperation);
router.post('/treasury/operations/:id/record', requirePermission('treasury.operate'), requireStepUp, recordTreasuryOperation);
router.post('/treasury/operations/:id/cancel', requirePermission('treasury.operate'), requireStepUp, cancelTreasuryOperation);
router.get('/agents/controls', requirePermission('agents.manage'), getAgentControls);
router.get('/agent-decisions', requirePermission('admin.read'), getAgentDecisions);
router.get('/agent-decisions/cycles', requirePermission('admin.read'), getAgentDecisionCycles);
router.get('/agent-decisions/cycles/:cycleId', requirePermission('admin.read'), getAgentDecisionCycleFunnel);
router.post('/agents/:agent/pause', requirePermission('agents.manage'), pauseAgentControl);
router.post('/agents/:agent/resume', requirePermission('agents.manage'), resumeAgentControl);
router.get('/status', requirePermission('admin.read'), getSystemStatus);
router.get('/fees', requirePermission('admin.read'), getChainFeesReport);
router.get('/disputes', requirePermission('disputes.manage'), getDisputes);
router.post('/disputes/:id/ack', requirePermission('disputes.manage'), ackDispute);
router.post('/disputes/:id/cancel-tx', requirePermission('disputes.manage'), cancelDisputeTx);
router.post('/disputes/:id/void-tx', requirePermission('disputes.manage'), voidDisputeTx);
router.get('/trace-audit', requirePermission('trace_audit.run'), getTraceAuditSummary);
router.post('/trace-audit/run', requirePermission('trace_audit.run'), triggerTraceAuditRun);
router.get('/reconciliation/runs', requirePermission('reconciliation.run'), listReconciliationRuns);
router.get('/reconciliation/runs/:id', requirePermission('reconciliation.run'), getReconciliationRun);
router.post('/reconciliation/run', requirePermission('reconciliation.run'), triggerReconciliationRun);
// Money audit (#222): guarded only; acknowledging needs step-up.
router.get('/money-audit/runs', requirePermission('reconciliation.run'), listMoneyAuditRuns);
router.get('/money-audit/runs/:id/findings', requirePermission('reconciliation.run'), listMoneyAuditFindings);
router.post('/money-audit/run', requirePermission('reconciliation.run'), triggerMoneyAuditRun);
router.post('/money-audit/findings/:id/ack', requirePermission('reconciliation.run'), requireStepUp, ackMoneyAuditFinding);
// Spec compatibility report from the boot gate (#34): read-only diagnostics.
router.get('/chain/spec-compat', requirePermission('admin.read'), getSpecCompat);
// Agent trace signing keys (#273): permission- and step-up-guarded only.
router.get('/chain/signing-keys', requirePermission('chain.signing_keys'), requireStepUp, getChainSigningKeys);
router.post('/chain/signing-keys/register', requirePermission('chain.signing_keys'), requireStepUp, registerChainSigningKey);
router.post('/chain/signing-keys/:publicKey/retire', requirePermission('chain.signing_keys'), requireStepUp, retireChainSigningKey);
// Admin outbox console (#221). The actions write their own audit row (outbox
// id, kind, from/to status, reason, hashes), so they opt out of the generic one.
router.get('/chain/transactions', requirePermission('chain.outbox.read'), listChainTransactions);
router.get('/chain/transactions/:id', requirePermission('chain.outbox.read'), getChainTransaction);
router.post('/chain/transactions/:id/recover', requirePermission('chain.outbox.operate', { audit: false }), requireStepUp, recoverChainTransaction);
router.post('/chain/transactions/:id/rerun-handler', requirePermission('chain.outbox.operate', { audit: false }), requireStepUp, rerunChainTransactionHandler);
router.post('/chain/transactions/:id/abandon', requirePermission('chain.outbox.operate', { audit: false }), requireStepUp, abandonChainTransaction);
router.get('/treasury', getTreasury);
router.get('/treasury/operations', listTreasuryOperations);
router.post('/treasury/operations', createOperation);
router.get('/treasury/operations/:id', getTreasuryOperation);
router.post('/treasury/operations/:id/signatures', addOperationSignature);
router.post('/treasury/operations/:id/submit', submitTreasuryOperation);
router.post('/treasury/operations/:id/record', recordTreasuryOperation);
router.post('/treasury/operations/:id/cancel', cancelTreasuryOperation);
router.get('/agents/controls', getAgentControls);
router.post('/agents/:agent/pause', pauseAgentControl);
router.post('/agents/:agent/resume', resumeAgentControl);
router.get('/status', getSystemStatus);
router.get('/fees', getChainFeesReport);
router.get('/disputes', getDisputes);
router.post('/disputes/:id/ack', ackDispute);
router.post('/disputes/:id/cancel-tx', cancelDisputeTx);
router.post('/disputes/:id/void-tx', voidDisputeTx);
router.get('/trace-audit', getTraceAuditSummary);
router.post('/trace-audit/run', triggerTraceAuditRun);
router.get('/reconciliation/runs', listReconciliationRuns);
router.get('/reconciliation/runs/:id', getReconciliationRun);
router.post('/reconciliation/run', triggerReconciliationRun);

// Portfolio risk snapshots (#280)
import { getRiskPortfolio, getRiskPortfolioHistory, runRiskPortfolio } from '../controllers/risk.controller';
import { idempotent } from '../middlewares/idempotency.middleware';
router.get('/risk/portfolio', requirePermission('admin.read'), getRiskPortfolio);
router.get('/risk/portfolio/history', requirePermission('admin.read'), getRiskPortfolioHistory);
router.post('/risk/portfolio/run', requirePermission('agents.manage'), idempotent(), runRiskPortfolio);

// Market generation saga runs (#242)
import {
  cancelGenerationRun,
  getGenerationRun,
  listGenerationRuns,
  retryGenerationRun,
  startGenerationRun,
} from '../controllers/generation-runs.controller';
router.get('/generation-runs', requirePermission('markets.generate'), listGenerationRuns);
router.get('/generation-runs/:id', requirePermission('markets.generate'), getGenerationRun);
router.post('/generation-runs', requirePermission('markets.generate'), requireStepUp, startGenerationRun);
router.post('/generation-runs/:id/cancel', requirePermission('markets.generate'), requireStepUp, cancelGenerationRun);
router.post('/generation-runs/:id/retry', requirePermission('markets.generate'), requireStepUp, retryGenerationRun);

// Learned source weight sets (#223). The service writes its own audit row in
// the same transaction as each change, so these opt out of the request audit.
import {
  activateSourceWeightSet,
  approveSourceWeightSet,
  getSourceWeightSet,
  listSourceWeightSets,
  rollbackSourceWeightSet,
} from '../controllers/admin.controller';
router.get('/source-weights', requirePermission('admin.read'), listSourceWeightSets);
router.post('/source-weights/rollback', requirePermission('agents.weights.approve', { audit: false }), requireStepUp, rollbackSourceWeightSet);
router.get('/source-weights/:id', requirePermission('admin.read'), getSourceWeightSet);
router.post('/source-weights/:id/approve', requirePermission('agents.weights.approve', { audit: false }), requireStepUp, approveSourceWeightSet);
router.post('/source-weights/:id/activate', requirePermission('agents.weights.approve', { audit: false }), requireStepUp, activateSourceWeightSet);

// Versioned agent risk parameters (#274).
import {
  getRiskParamById,
  getRiskParams,
  postRiskParams,
  postRiskParamsActivate,
  postRiskParamsApprove,
  postRiskParamsReject,
} from '../controllers/agents.controller';
router.get('/risk-params', requirePermission('admin.read'), getRiskParams);
router.get('/risk-params/:id', requirePermission('admin.read'), getRiskParamById);
router.post('/risk-params', requirePermission('risk_params.propose', { audit: false }), requireStepUp, idempotent({ required: true }), postRiskParams);
router.post('/risk-params/:id/approve', requirePermission('risk_params.approve', { audit: false }), requireStepUp, idempotent({ required: true }), postRiskParamsApprove);
router.post('/risk-params/:id/reject', requirePermission('risk_params.approve', { audit: false }), requireStepUp, idempotent({ required: true }), postRiskParamsReject);
router.post('/risk-params/:id/activate', requirePermission('risk_params.approve', { audit: false }), requireStepUp, idempotent({ required: true }), postRiskParamsActivate);

export default router;
