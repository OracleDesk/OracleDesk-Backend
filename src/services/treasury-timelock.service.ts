/**
 * Timelocked treasury config, price-policy, and agent-policy helpers (#311).
 *
 * Mirrors the on-chain treasury timelock contract rules:
 *   - GlobalConfig: lowering caps with unchanged collateral/market_core is
 *     tightening (immediate); raising any cap or changing addresses is
 *     loosening (timelocked).
 *   - PricePolicy: narrowing min/max price or lowering max_spread_bps is
 *     tightening (immediate); widening is loosening (timelocked).
 *   - AgentPolicy: lowering caps on an active agent is tightening; registering
 *     a new agent or raising caps is loosening (timelocked).
 *   - CreationPolicy: tightening-only (immediate); loosening is rejected.
 */
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';

export interface GlobalConfigInput {
  max_trade: string;
  max_market: string;
  max_daily: string;
  collateral?: string;
  market_core?: string;
}

export interface PricePolicyInput {
  min_price_bps?: number;
  max_price_bps?: number;
  max_spread_bps?: number;
}

export interface AgentPolicyInput {
  max_trade: string;
  max_market: string;
  max_daily: string;
  active?: boolean;
}

export interface CreationPolicyInput {
  min_liquidity?: string;
  max_markets_per_day?: number;
}

export interface DrawdownConfigInput {
  max_drawdown_bps: number;
  pause_duration_seconds: number;
}

export type ChangeClassification = 'tighten' | 'loosen' | 'no-op';

export interface FieldDiff {
  field: string;
  current: string | number | boolean | null;
  proposed: string | number | boolean | null;
  direction: ChangeClassification;
}

export type ProposalKind = 'config' | 'price_policy' | 'agent';
export type ProposalStatus = 'pending' | 'executable' | 'executed' | 'cancelled' | 'superseded';

export interface TreasuryProposal {
  kind: ProposalKind;
  agent?: string;
  proposedValue: Record<string, unknown>;
  executableAt: string;
  executableAtUnix: number;
  etaSeconds: number;
  status: ProposalStatus;
  proposerOperationId: string | null;
  txHash?: string | null;
}

function cmpBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function combineClassifications(directions: ChangeClassification[]): ChangeClassification {
  if (directions.some((d) => d === 'loosen')) return 'loosen';
  if (directions.some((d) => d === 'tighten')) return 'tighten';
  return 'no-op';
}

export function classifyAndDiffConfig(
  current: { max_trade: bigint | string; max_market: bigint | string; max_daily: bigint | string; collateral?: string; market_core?: string } | null,
  proposed: GlobalConfigInput,
): { classification: ChangeClassification; diff: FieldDiff[] } {
  const diff: FieldDiff[] = [];
  if (!current) {
    for (const f of ['max_trade', 'max_market', 'max_daily'] as const) {
      diff.push({ field: f, current: null, proposed: proposed[f], direction: 'loosen' });
    }
    if (proposed.collateral) diff.push({ field: 'collateral', current: null, proposed: proposed.collateral, direction: 'loosen' });
    if (proposed.market_core) diff.push({ field: 'market_core', current: null, proposed: proposed.market_core, direction: 'loosen' });
    return { classification: 'loosen', diff };
  }

  for (const f of ['max_trade', 'max_market', 'max_daily'] as const) {
    const cur = BigInt(current[f]);
    const next = BigInt(proposed[f]);
    const c = cmpBigInt(next, cur);
    const direction: ChangeClassification = c === 0 ? 'no-op' : c < 0 ? 'tighten' : 'loosen';
    diff.push({ field: f, current: cur.toString(), proposed: next.toString(), direction });
  }

  if (proposed.collateral !== undefined) {
    const direction: ChangeClassification =
      current.collateral === undefined || current.collateral === proposed.collateral ? 'no-op' : 'loosen';
    diff.push({ field: 'collateral', current: current.collateral ?? null, proposed: proposed.collateral, direction });
  }
  if (proposed.market_core !== undefined) {
    const direction: ChangeClassification =
      current.market_core === undefined || current.market_core === proposed.market_core ? 'no-op' : 'loosen';
    diff.push({ field: 'market_core', current: current.market_core ?? null, proposed: proposed.market_core, direction });
  }

  return { classification: combineClassifications(diff.map((d) => d.direction)), diff };
}

export function classifyAndDiffPricePolicy(
  current: PricePolicyInput | null,
  proposed: PricePolicyInput,
): { classification: ChangeClassification; diff: FieldDiff[] } {
  const diff: FieldDiff[] = [];
  if (proposed.min_price_bps !== undefined) {
    const cur = current?.min_price_bps ?? null;
    const direction: ChangeClassification =
      cur === null ? 'loosen' : proposed.min_price_bps === cur ? 'no-op' : proposed.min_price_bps > cur ? 'tighten' : 'loosen';
    diff.push({ field: 'min_price_bps', current: cur, proposed: proposed.min_price_bps, direction });
  }
  if (proposed.max_price_bps !== undefined) {
    const cur = current?.max_price_bps ?? null;
    const direction: ChangeClassification =
      cur === null ? 'loosen' : proposed.max_price_bps === cur ? 'no-op' : proposed.max_price_bps < cur ? 'tighten' : 'loosen';
    diff.push({ field: 'max_price_bps', current: cur, proposed: proposed.max_price_bps, direction });
  }
  if (proposed.max_spread_bps !== undefined) {
    const cur = current?.max_spread_bps ?? null;
    const direction: ChangeClassification =
      cur === null ? 'loosen' : proposed.max_spread_bps === cur ? 'no-op' : proposed.max_spread_bps < cur ? 'tighten' : 'loosen';
    diff.push({ field: 'max_spread_bps', current: cur, proposed: proposed.max_spread_bps, direction });
  }
  return { classification: combineClassifications(diff.map((d) => d.direction)), diff };
}

export function classifyAndDiffAgentPolicy(
  current: (AgentPolicyInput & { active?: boolean }) | null,
  proposed: AgentPolicyInput,
): { classification: ChangeClassification; diff: FieldDiff[] } {
  const diff: FieldDiff[] = [];
  if (!current || current.active === false) {
    for (const f of ['max_trade', 'max_market', 'max_daily'] as const) {
      diff.push({ field: f, current: current?.[f] ?? null, proposed: proposed[f], direction: 'loosen' });
    }
    diff.push({ field: 'active', current: current?.active ?? false, proposed: proposed.active ?? true, direction: 'loosen' });
    return { classification: 'loosen', diff };
  }

  for (const f of ['max_trade', 'max_market', 'max_daily'] as const) {
    const cur = BigInt(current[f]);
    const next = BigInt(proposed[f]);
    const c = cmpBigInt(next, cur);
    const direction: ChangeClassification = c === 0 ? 'no-op' : c < 0 ? 'tighten' : 'loosen';
    diff.push({ field: f, current: cur.toString(), proposed: next.toString(), direction });
  }
  if (proposed.active !== undefined && proposed.active !== current.active) {
    diff.push({
      field: 'active',
      current: current.active ?? true,
      proposed: proposed.active,
      direction: proposed.active ? 'loosen' : 'tighten',
    });
  }
  return { classification: combineClassifications(diff.map((d) => d.direction)), diff };
}

export function classifyAndDiffCreationPolicy(
  current: CreationPolicyInput | null,
  proposed: CreationPolicyInput,
): { classification: ChangeClassification; diff: FieldDiff[] } {
  const diff: FieldDiff[] = [];
  if (proposed.min_liquidity !== undefined) {
    const cur = current?.min_liquidity ? BigInt(current.min_liquidity) : null;
    const next = BigInt(proposed.min_liquidity);
    const direction: ChangeClassification =
      cur === null ? 'tighten' : next === cur ? 'no-op' : next > cur ? 'tighten' : 'loosen';
    diff.push({ field: 'min_liquidity', current: cur?.toString() ?? null, proposed: next.toString(), direction });
  }
  if (proposed.max_markets_per_day !== undefined) {
    const cur = current?.max_markets_per_day ?? null;
    const next = proposed.max_markets_per_day;
    const direction: ChangeClassification =
      cur === null ? 'tighten' : next === cur ? 'no-op' : next < cur ? 'tighten' : 'loosen';
    diff.push({ field: 'max_markets_per_day', current: cur, proposed: next, direction });
  }
  return { classification: combineClassifications(diff.map((d) => d.direction)), diff };
}

export interface ChainProposalEvent {
  eventName: string;
  txHash: string;
  ledgerClosedAt: Date;
  params: Record<string, unknown>;
}

export interface PendingStorageEntries {
  pendingConfig?: { value: Record<string, unknown>; executable_at: number | bigint } | null;
  pendingPricePolicy?: { value: Record<string, unknown>; executable_at: number | bigint } | null;
  pendingAgents?: Array<{ agent: string; value: Record<string, unknown>; executable_at: number | bigint }>;
}

const EVENT_KIND_MAP: Record<string, { kind: ProposalKind; action: 'proposed' | 'executed' | 'cancelled' }> = {
  ConfigProposed: { kind: 'config', action: 'proposed' },
  ConfigExecuted: { kind: 'config', action: 'executed' },
  ConfigCancelled: { kind: 'config', action: 'cancelled' },
  PricePolicyProposed: { kind: 'price_policy', action: 'proposed' },
  PricePolicySet: { kind: 'price_policy', action: 'executed' },
  PricePolicyCancelled: { kind: 'price_policy', action: 'cancelled' },
  AgentPolicyProposed: { kind: 'agent', action: 'proposed' },
  AgentPolicySet: { kind: 'agent', action: 'executed' },
  AgentPolicyCancelled: { kind: 'agent', action: 'cancelled' },
};

/**
 * Builds the TreasuryProposal read model from live chain storage + indexed
 * treasury events + AdminOperation rows.
 */
export function buildTreasuryProposalsModel(
  storage: PendingStorageEntries,
  events: ChainProposalEvent[],
  adminOps: Array<{ id: string; txHash: string | null; kind: string }>,
  ledgerNowUnix: number,
): TreasuryProposal[] {
  const opByTx = new Map<string, string>();
  for (const op of adminOps) {
    if (op.txHash) opByTx.set(op.txHash, op.id);
  }

  const out: TreasuryProposal[] = [];
  const activeKeys = new Set<string>();

  const addPending = (kind: ProposalKind, value: Record<string, unknown>, execAtRaw: number | bigint, agent?: string) => {
    const execAt = Number(execAtRaw);
    const key = agent ? `${kind}:${agent}` : kind;
    activeKeys.add(key);

    const matchingProposed = events
      .filter((e) => EVENT_KIND_MAP[e.eventName]?.kind === kind && EVENT_KIND_MAP[e.eventName]?.action === 'proposed')
      .filter((e) => !agent || String(e.params?.agent ?? '') === agent)
      .sort((a, b) => b.ledgerClosedAt.getTime() - a.ledgerClosedAt.getTime())[0];

    const txHash = matchingProposed?.txHash ?? null;
    out.push({
      kind,
      ...(agent ? { agent } : {}),
      proposedValue: value,
      executableAt: new Date(execAt * 1000).toISOString(),
      executableAtUnix: execAt,
      etaSeconds: Math.max(0, execAt - ledgerNowUnix),
      status: ledgerNowUnix >= execAt ? 'executable' : 'pending',
      proposerOperationId: txHash ? (opByTx.get(txHash) ?? null) : null,
      txHash,
    });
  };

  if (storage.pendingConfig) {
    addPending('config', storage.pendingConfig.value, storage.pendingConfig.executable_at);
  }
  if (storage.pendingPricePolicy) {
    addPending('price_policy', storage.pendingPricePolicy.value, storage.pendingPricePolicy.executable_at);
  }
  for (const pa of storage.pendingAgents ?? []) {
    addPending('agent', pa.value, pa.executable_at, pa.agent);
  }

  // Track historical executed / cancelled / superseded proposals from events
  const sorted = [...events].sort((a, b) => a.ledgerClosedAt.getTime() - b.ledgerClosedAt.getTime());
  const latestByKey = new Map<string, TreasuryProposal>();

  for (const ev of sorted) {
    const meta = EVENT_KIND_MAP[ev.eventName];
    if (!meta) continue;
    const agent = meta.kind === 'agent' && ev.params?.agent ? String(ev.params.agent) : undefined;
    const key = agent ? `${meta.kind}:${agent}` : meta.kind;
    if (activeKeys.has(key) && meta.action === 'proposed') continue;

    if (meta.action === 'proposed') {
      const prev = latestByKey.get(key);
      if (prev && prev.status === 'pending') {
        prev.status = 'superseded';
      }
      const execAt = Number(ev.params?.executable_at ?? Math.floor(ev.ledgerClosedAt.getTime() / 1000));
      const entry: TreasuryProposal = {
        kind: meta.kind,
        ...(agent ? { agent } : {}),
        proposedValue: (ev.params?.value as Record<string, unknown>) ?? ev.params,
        executableAt: new Date(execAt * 1000).toISOString(),
        executableAtUnix: execAt,
        etaSeconds: 0,
        status: 'pending',
        proposerOperationId: opByTx.get(ev.txHash) ?? null,
        txHash: ev.txHash,
      };
      latestByKey.set(key, entry);
      out.push(entry);
    } else {
      const existing = latestByKey.get(key);
      if (existing && (existing.status === 'pending' || existing.status === 'executable')) {
        existing.status = meta.action === 'executed' ? 'executed' : 'cancelled';
      }
    }
  }

  return out;
}

export function encodeProposalScArgs(method: string, params: Record<string, unknown>): xdr.ScVal[] {
  switch (method) {
    case 'propose_config': {
      const cfg = params.config as GlobalConfigInput;
      const fields: Array<[string, xdr.ScVal]> = [
        ['max_daily', nativeToScVal(BigInt(cfg.max_daily), { type: 'i128' })],
        ['max_market', nativeToScVal(BigInt(cfg.max_market), { type: 'i128' })],
        ['max_trade', nativeToScVal(BigInt(cfg.max_trade), { type: 'i128' })],
      ];
      if (cfg.collateral) fields.push(['collateral', Address.fromString(cfg.collateral).toScVal()]);
      if (cfg.market_core) fields.push(['market_core', Address.fromString(cfg.market_core).toScVal()]);
      fields.sort((a, b) => a[0].localeCompare(b[0]));
      return [
        xdr.ScVal.scvMap(
          fields.map(([k, v]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v })),
        ),
      ];
    }
    case 'set_price_policy': {
      const p = params.policy as PricePolicyInput;
      const entries: Array<[string, xdr.ScVal]> = [];
      if (p.min_price_bps !== undefined) entries.push(['min_price_bps', nativeToScVal(p.min_price_bps, { type: 'u32' })]);
      if (p.max_price_bps !== undefined) entries.push(['max_price_bps', nativeToScVal(p.max_price_bps, { type: 'u32' })]);
      if (p.max_spread_bps !== undefined) entries.push(['max_spread_bps', nativeToScVal(p.max_spread_bps, { type: 'u32' })]);
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      return [
        xdr.ScVal.scvMap(entries.map(([k, v]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v }))),
      ];
    }
    case 'set_agent': {
      const agent = String(params.agent);
      const p = params.policy as AgentPolicyInput;
      const entries: Array<[string, xdr.ScVal]> = [
        ['max_daily', nativeToScVal(BigInt(p.max_daily), { type: 'i128' })],
        ['max_market', nativeToScVal(BigInt(p.max_market), { type: 'i128' })],
        ['max_trade', nativeToScVal(BigInt(p.max_trade), { type: 'i128' })],
      ];
      if (p.active !== undefined) entries.push(['active', xdr.ScVal.scvBool(p.active)]);
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      return [
        Address.fromString(agent).toScVal(),
        xdr.ScVal.scvMap(entries.map(([k, v]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v }))),
      ];
    }
    case 'execute_agent':
    case 'cancel_agent':
    case 'remove_agent':
      return [Address.fromString(String(params.agent)).toScVal()];
    case 'set_creation_policy': {
      const p = params.policy as CreationPolicyInput;
      const entries: Array<[string, xdr.ScVal]> = [];
      if (p.min_liquidity !== undefined) entries.push(['min_liquidity', nativeToScVal(BigInt(p.min_liquidity), { type: 'i128' })]);
      if (p.max_markets_per_day !== undefined) entries.push(['max_markets_per_day', nativeToScVal(p.max_markets_per_day, { type: 'u32' })]);
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      return [
        xdr.ScVal.scvMap(entries.map(([k, v]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v }))),
      ];
    }
    case 'set_drawdown_config': {
      const c = params.config as DrawdownConfigInput;
      const entries: Array<[string, xdr.ScVal]> = [
        ['max_drawdown_bps', nativeToScVal(c.max_drawdown_bps, { type: 'u32' })],
        ['pause_duration_seconds', nativeToScVal(c.pause_duration_seconds, { type: 'u64' })],
      ];
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      return [
        xdr.ScVal.scvMap(entries.map(([k, v]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v }))),
      ];
    }
    default:
      return [];
  }
}
