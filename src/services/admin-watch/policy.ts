import type { ControlScope, PauseSource } from '../agent-controls.service';

export type AdminSeverity = 'info' | 'pause' | 'critical';
export interface AdminActionInput { contract: string; functionName?: string; topic?: string; matchedOperation?: boolean; }
export interface AdminActionDecision { severity: AdminSeverity; scopes: ControlScope[]; source: PauseSource; reason: string; }

const rules: Array<{ contract: string; names: string[]; severity: AdminSeverity; scopes: ControlScope[] }> = [
  { contract: 'treasury', names: ['withdraw', 'deposit', 'set_paused', 'WithdrawPaid', 'EmergencyWithdrawn'], severity: 'critical', scopes: ['ALL'] },
  { contract: 'market-core', names: ['set_resolver', 'set_treasury', 'set_default_fee_bps', 'ResolverChanged', 'TreasuryChanged', 'SuccessorSet'], severity: 'critical', scopes: ['ALL'] },
  { contract: 'registry', names: ['unregister_agent'], severity: 'critical', scopes: ['MARKET_MAKER'] },
];

export function classifyAdminAction(input: AdminActionInput): AdminActionDecision | null {
  const name = input.functionName ?? input.topic;
  if (!name) return null;
  const rule = rules.find((candidate) => candidate.contract === input.contract && candidate.names.includes(name));
  if (!rule || input.matchedOperation) return null;
  return { severity: rule.severity, scopes: rule.scopes, source: 'chain_admin', reason: `unexpected ${input.contract}.${name}` };
}
