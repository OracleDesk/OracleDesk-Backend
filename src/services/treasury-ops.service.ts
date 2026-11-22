/**
 * Treasury admin operations console (#156).
 *
 * The backend never holds the treasury admin key. It prepares unsigned,
 * simulated transactions for the on-chain admin (or multisig) to sign, merges
 * verified signatures, and submits only a transaction whose hash matches the
 * prepared body.
 */
import {
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  Networks,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { AssembledTransaction } from '@stellar/stellar-sdk/contract';
import { config } from '../config';
import { secret } from '../config/secrets';
import { CONTRACTS } from '../config/contracts';
import {
  buildTxUri,
  generateSep7Token,
  hashSep7Token,
  isQrTooLarge,
} from './sep7.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { formatUsdc, parseU64, parseUsdc } from '../lib/amounts';
import { AppError } from '../middlewares/error.middleware';
import { TreasuryClient, MarketCoreClient, rpcServer } from './stellar/clients';
import { contractErrorName } from './stellar/errors';
import {
  getOnChainMarket,
  marketCoreConfig,
  treasuryAvailableCapital,
  treasuryConfig,
  treasuryDailyUsage,
} from './chain.service';
import type { RiskConfig } from '../generated/treasury';
import {
  buildTreasuryProposalsModel,
  classifyAndDiffAgentPolicy,
  classifyAndDiffConfig,
  classifyAndDiffCreationPolicy,
  classifyAndDiffPricePolicy,
  encodeProposalScArgs,
  type AgentPolicyInput,
  type ChangeClassification,
  type CreationPolicyInput,
  type DrawdownConfigInput,
  type FieldDiff,
  type GlobalConfigInput,
  type PendingStorageEntries,
  type PricePolicyInput,
  type TreasuryProposal,
} from './treasury-timelock.service';

export type AdminOp =
  | { kind: 'treasury.set_paused'; paused: boolean }
  | { kind: 'treasury.withdraw'; to: string; amountRaw: string }
  | { kind: 'treasury.deposit'; from: string; amountRaw: string }
  | { kind: 'treasury.collect_market_fees'; onChainMarketId: string }
  | { kind: 'market_core.set_paused'; paused: boolean }
  | { kind: 'treasury.propose_config'; config: GlobalConfigInput }
  | { kind: 'treasury.execute_config' }
  | { kind: 'treasury.cancel_config' }
  | { kind: 'treasury.set_price_policy'; policy: PricePolicyInput }
  | { kind: 'treasury.execute_price_policy' }
  | { kind: 'treasury.cancel_price_policy' }
  | { kind: 'treasury.set_agent'; agent: string; policy: AgentPolicyInput }
  | { kind: 'treasury.execute_agent'; agent: string }
  | { kind: 'treasury.cancel_agent'; agent: string }
  | { kind: 'treasury.remove_agent'; agent: string }
  | { kind: 'treasury.set_creation_policy'; policy: CreationPolicyInput }
  | { kind: 'treasury.set_drawdown_config'; config: DrawdownConfigInput };

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
  critical?: boolean;
}

export interface AccountSigner {
  key: string;
  kind: 'ed25519' | 'preAuthTx' | 'hashX';
  weight: number;
}

export interface AccountState {
  address: string;
  kind: 'account' | 'contract';
  balanceXlm: string | null;
  masterWeight: number;
  thresholds: { low: number; medium: number; high: number };
  signers: AccountSigner[];
}

export interface TreasuryState {
  network: string;
  contracts: { treasury: string; marketCore: string; usdc: string };
  treasury: {
    config: RiskConfig | null;
    availableCapitalRaw: string;
    usdcBalanceRaw: string;
    dailyUsage: { amountRaw: string; dayStart: number; resetsAt: string; remainingRaw: string };
    paused: boolean | null;
    admin: { address: string; kind: 'account' | 'contract' } | null;
    configDelaySeconds?: number | null;
    pricePolicy?: PricePolicyInput | null;
    creationPolicy?: CreationPolicyInput | null;
    drawdownConfig?: DrawdownConfigInput | null;
    agentPolicies?: Record<string, AgentPolicyInput>;
    proposals?: TreasuryProposal[];
    ledgerTimeUnix?: number;
  };
  marketCore: { paused: boolean | null; admin: string | null };
  agent: { address: string; xlmBalance: string | null };
}

export interface PreparedOperation {
  id: string;
  kind: string;
  xdr: string;
  networkPassphrase: string;
  hash: string;
  expiresAt: string;
  requiredSigners: number;
  thresholds: AccountState['thresholds'];
  checks: PreflightCheck[];
  humanSummary: string;
  status: string;
  classification?: ChangeClassification;
  diff?: FieldDiff[];
  permissionless?: boolean;
}

export interface SignatureRecord {
  signer: string;
  hint: string;
  signature: string;
  addedAt: string;
  addedBy: string;
  channel?: 'paste' | 'sep7';
}

export interface OpsDeps {
  state?: () => Promise<TreasuryState>;
  build?: (op: AdminOp, state: TreasuryState) => Promise<{ xdr: string; hash: string; contractId: string; sourceAccount: string }>;
  submit?: (xdr: string) => Promise<{ status: string; hash: string; ledger?: number; resultXdr?: string; error?: unknown }>;
  now?: () => number;
  account?: (address: string) => Promise<AccountState>;
}

const TREASURY_EVENT = 'ADMIN_OP';

function nowMs(deps?: OpsDeps): number {
  return deps?.now ? deps.now() : Date.now();
}

function signerKind(key: xdr.SignerKey): AccountSigner['kind'] {
  try {
    if (key.switch().name === 'signerKeyTypeEd25519') return 'ed25519';
    if (key.switch().name === 'signerKeyTypePreAuthTx') return 'preAuthTx';
    return 'hashX';
  } catch {
    return 'hashX';
  }
}

function signerKeyString(key: xdr.SignerKey): string {
  const kind = signerKind(key);
  if (kind === 'ed25519') return StrKey.encodeEd25519PublicKey(key.ed25519());
  if (kind === 'preAuthTx') return Buffer.from(key.preAuthTx()).toString('hex');
  return Buffer.from(key.hashX()).toString('hex');
}

function serialiseInstanceKey(key: xdr.ScVal): string | null {
  try {
    const native = scValToNative(key) as unknown;
    if (typeof native === 'string') return native;
    if (Array.isArray(native) && native.length > 0 && typeof native[0] === 'string') return native[0];
    if (native && typeof native === 'object' && 'tag' in native) return String((native as { tag: unknown }).tag);
    return null;
  } catch {
    return null;
  }
}

async function readInstanceStorage(contractId: string): Promise<Map<string, unknown>> {
  const map = new Map<string, unknown>();
  try {
    const key = (xdr.LedgerKey.contractData as any)({
      contract: new Contract(contractId).address(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    });
    const res = await rpcServer.getLedgerEntries(key);
    const entry = res.entries?.[0];
    const storage = entry?.val.contractData().val().instance().storage();
    if (!storage) return map;
    for (const item of storage) {
      const name = serialiseInstanceKey(item.key());
      if (name) map.set(name, scValToNative(item.val()));
    }
  } catch (err) {
    logger.warn({ err, contractId }, 'Unable to read contract instance storage');
  }
  return map;
}

async function readAccount(address: string): Promise<AccountState> {
  const base: AccountState = {
    address,
    kind: 'account',
    balanceXlm: null,
    masterWeight: 0,
    thresholds: { low: 0, medium: 0, high: 0 },
    signers: [],
  };
  if (StrKey.isValidContract(address)) {
    return { ...base, kind: 'contract' };
  }
  try {
    const res = await rpcServer.getLedgerEntries((xdr.LedgerKey.account as any)({ accountId: address }));
    const account = res.entries?.[0]?.val.account();
    if (!account) return base;
    const thresholds = account.thresholds();
    return {
      address,
      kind: 'account',
      balanceXlm: account.balance().toString(),
      masterWeight: thresholds[0] ?? 0,
      thresholds: { low: thresholds[1] ?? 0, medium: thresholds[2] ?? 0, high: thresholds[3] ?? 0 },
      signers: account.signers().map((s) => ({
        key: signerKeyString(s.key()),
        kind: signerKind(s.key()),
        weight: s.weight(),
      })),
    };
  } catch (err) {
    logger.warn({ err, address }, 'Unable to read account state');
    return base;
  }
}

/** Reads live treasury, market-core and account state for the console. */
export async function getTreasuryState(deps: OpsDeps = {}): Promise<TreasuryState> {
  if (deps.state) return deps.state();

  const [risk, usage, available, marketCfg, instance] = await Promise.all([
    treasuryConfig().catch(() => null),
    treasuryDailyUsage().catch(() => null),
    treasuryAvailableCapital().catch(() => 0n),
    marketCoreConfig().catch(() => null),
    readInstanceStorage(CONTRACTS.treasury),
  ]);

  const adminAddress = typeof instance.get('Admin') === 'string' ? String(instance.get('Admin')) : null;
  const paused = typeof instance.get('Paused') === 'boolean' ? Boolean(instance.get('Paused')) : null;
  const adminAccount = adminAddress ? await readAccount(adminAddress) : null;
  const agentAddress = risk?.agent ?? '';
  const agentAccount = agentAddress ? await readAccount(agentAddress) : null;

  const amountRaw = BigInt(usage?.amount ?? 0);
  const maxDaily = BigInt(risk?.max_daily ?? 0);
  const remaining = maxDaily > amountRaw ? maxDaily - amountRaw : 0n;
  const dayStart = Number(usage?.day_start ?? 0);
  const resetsAt = new Date((dayStart + 86_400) * 1000).toISOString();

  const rawDelay = instance.get('ConfigDelay') ?? instance.get('config_delay');
  const configDelaySeconds = rawDelay !== undefined && rawDelay !== null ? Number(rawDelay) : null;
  const pendingEntries: PendingStorageEntries = {
    pendingConfig: (instance.get('PendingConfig') ?? instance.get('pending_config') ?? null) as PendingStorageEntries['pendingConfig'],
    pendingPricePolicy: (instance.get('PendingPricePolicy') ?? instance.get('pending_price_policy') ?? null) as PendingStorageEntries['pendingPricePolicy'],
    pendingAgents: [],
  };
  for (const [k, v] of instance.entries()) {
    if ((k.startsWith('PendingAgent:') || k.startsWith('pending_agent:')) && v && typeof v === 'object') {
      const agentKey = k.split(':')[1];
      if (agentKey) pendingEntries.pendingAgents!.push({ agent: agentKey, ...(v as { value: Record<string, unknown>; executable_at: number | bigint }) });
    }
  }

  const [proposalEvents, adminOps] = await Promise.all([
    prisma.chainEvent
      .findMany({
        where: {
          contractName: 'treasury',
          eventName: {
            in: [
              'ConfigProposed', 'ConfigExecuted', 'ConfigCancelled',
              'PricePolicyProposed', 'PricePolicySet', 'PricePolicyCancelled',
              'AgentPolicyProposed', 'AgentPolicySet', 'AgentPolicyCancelled',
            ],
          },
        },
        orderBy: { ledger: 'asc' },
        take: 100,
      })
      .catch(() => []),
    prisma.adminOperation
      .findMany({
        where: { kind: { startsWith: 'treasury.' } },
        select: { id: true, txHash: true, kind: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      .catch(() => []),
  ]);

  const ledgerTimeUnix = Math.floor(nowMs(deps) / 1000);
  const proposals = buildTreasuryProposalsModel(
    pendingEntries,
    proposalEvents.map((e) => ({
      eventName: e.eventName,
      txHash: e.txHash,
      ledgerClosedAt: e.ledgerClosedAt,
      params: (e.params as Record<string, unknown>) ?? {},
    })),
    adminOps,
    ledgerTimeUnix,
  );

  return {
    network: config.STELLAR_NETWORK_PASSPHRASE,
    contracts: { treasury: CONTRACTS.treasury, marketCore: CONTRACTS.marketCore, usdc: CONTRACTS.usdc },
    treasury: {
      config: risk,
      availableCapitalRaw: available.toString(),
      usdcBalanceRaw: available.toString(),
      dailyUsage: { amountRaw: amountRaw.toString(), dayStart, resetsAt, remainingRaw: remaining.toString() },
      paused,
      admin: adminAddress ? { address: adminAddress, kind: adminAccount?.kind ?? 'account' } : null,
      configDelaySeconds,
      pricePolicy: (instance.get('PricePolicy') ?? instance.get('price_policy') ?? null) as PricePolicyInput | null,
      creationPolicy: (instance.get('CreationPolicy') ?? instance.get('creation_policy') ?? null) as CreationPolicyInput | null,
      drawdownConfig: (instance.get('DrawdownConfig') ?? instance.get('drawdown_config') ?? null) as DrawdownConfigInput | null,
      proposals,
      ledgerTimeUnix,
    },
    marketCore: { paused: marketCfg?.paused ?? null, admin: marketCfg?.admin ?? null },
    agent: { address: agentAddress, xlmBalance: agentAccount?.balanceXlm ?? null },
  };
}

function humanUsdc(raw: string): string {
  const value = BigInt(raw);
  const whole = value / 10_000_000n;
  const fraction = (value % 10_000_000n).toString().padStart(7, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

export function humanSummary(op: AdminOp): string {
  switch (op.kind) {
    case 'treasury.withdraw':
      return `Withdraw ${humanUsdc(op.amountRaw)} USDC from treasury ${CONTRACTS.treasury} to ${op.to}`;
    case 'treasury.deposit':
      return `Deposit ${humanUsdc(op.amountRaw)} USDC into treasury ${CONTRACTS.treasury} from ${op.from}`;
    case 'treasury.set_paused':
      return `${op.paused ? 'Pause' : 'Unpause'} treasury ${CONTRACTS.treasury}`;
    case 'treasury.collect_market_fees':
      return `Collect accrued fees from market ${op.onChainMarketId} into treasury ${CONTRACTS.treasury}`;
    case 'market_core.set_paused':
      return `${op.paused ? 'Pause' : 'Unpause'} market-core ${CONTRACTS.marketCore}`;
    case 'treasury.propose_config':
      return `Propose GlobalConfig update (max_trade=${humanUsdc(op.config.max_trade)}, max_market=${humanUsdc(op.config.max_market)}, max_daily=${humanUsdc(op.config.max_daily)}) on treasury ${CONTRACTS.treasury}`;
    case 'treasury.execute_config':
      return `Execute pending GlobalConfig proposal on treasury ${CONTRACTS.treasury}`;
    case 'treasury.cancel_config':
      return `Cancel pending GlobalConfig proposal on treasury ${CONTRACTS.treasury}`;
    case 'treasury.set_price_policy':
      return `Update PricePolicy (${Object.entries(op.policy).map(([k, v]) => `${k}=${v}`).join(', ')}) on treasury ${CONTRACTS.treasury}`;
    case 'treasury.execute_price_policy':
      return `Execute pending PricePolicy proposal on treasury ${CONTRACTS.treasury}`;
    case 'treasury.cancel_price_policy':
      return `Cancel pending PricePolicy proposal on treasury ${CONTRACTS.treasury}`;
    case 'treasury.set_agent':
      return `Set AgentPolicy for ${op.agent} (max_trade=${humanUsdc(op.policy.max_trade)}, max_market=${humanUsdc(op.policy.max_market)}, max_daily=${humanUsdc(op.policy.max_daily)}) on treasury ${CONTRACTS.treasury}`;
    case 'treasury.execute_agent':
      return `Execute pending AgentPolicy proposal for ${op.agent} on treasury ${CONTRACTS.treasury}`;
    case 'treasury.cancel_agent':
      return `Cancel pending AgentPolicy proposal for ${op.agent} on treasury ${CONTRACTS.treasury}`;
    case 'treasury.remove_agent':
      return `Remove agent ${op.agent} from treasury ${CONTRACTS.treasury}`;
    case 'treasury.set_creation_policy':
      return `Tighten CreationPolicy (${Object.entries(op.policy).map(([k, v]) => `${k}=${v}`).join(', ')}) on treasury ${CONTRACTS.treasury}`;
    case 'treasury.set_drawdown_config':
      return `Set DrawdownConfig (max_drawdown_bps=${op.config.max_drawdown_bps}, pause_duration_seconds=${op.config.pause_duration_seconds}) on treasury ${CONTRACTS.treasury}`;
  }
}

function isValidStellarAddress(addr: string): boolean {
  return StrKey.isValidEd25519PublicKey(addr) || StrKey.isValidContract(addr);
}

function validateOp(op: AdminOp): void {
  if (op.kind === 'treasury.withdraw') {
    parseUsdc(formatUsdcSafe(op.amountRaw));
    if (!isValidStellarAddress(op.to)) {
      throw new AppError(400, 'INVALID_DESTINATION', 'to must be a G… account or C… contract');
    }
  }
  if (op.kind === 'treasury.deposit') {
    parseUsdc(formatUsdcSafe(op.amountRaw));
    if (!StrKey.isValidEd25519PublicKey(op.from)) {
      throw new AppError(400, 'INVALID_SOURCE', 'from must be a G… account');
    }
  }
  if (op.kind === 'treasury.collect_market_fees' && parseU64(op.onChainMarketId) === null) {
    throw new AppError(400, 'INVALID_MARKET_ID', 'onChainMarketId must be a u64 decimal string');
  }
  if (op.kind === 'treasury.propose_config') {
    formatUsdcSafe(op.config.max_trade);
    formatUsdcSafe(op.config.max_market);
    formatUsdcSafe(op.config.max_daily);
    if (op.config.collateral && !isValidStellarAddress(op.config.collateral)) {
      throw new AppError(400, 'INVALID_ADDRESS', 'collateral must be a valid Stellar address');
    }
    if (op.config.market_core && !isValidStellarAddress(op.config.market_core)) {
      throw new AppError(400, 'INVALID_ADDRESS', 'market_core must be a valid Stellar address');
    }
  }
  if (op.kind === 'treasury.set_agent') {
    if (!isValidStellarAddress(op.agent)) {
      throw new AppError(400, 'INVALID_AGENT', 'agent must be a G… account or C… contract');
    }
    formatUsdcSafe(op.policy.max_trade);
    formatUsdcSafe(op.policy.max_market);
    formatUsdcSafe(op.policy.max_daily);
  }
  if (op.kind === 'treasury.execute_agent' || op.kind === 'treasury.cancel_agent' || op.kind === 'treasury.remove_agent') {
    if (!isValidStellarAddress(op.agent)) {
      throw new AppError(400, 'INVALID_AGENT', 'agent must be a G… account or C… contract');
    }
  }
  if (op.kind === 'treasury.set_creation_policy' && op.policy.min_liquidity !== undefined) {
    formatUsdcSafe(op.policy.min_liquidity);
  }
}

function formatUsdcSafe(raw: string): string {
  if (!/^\d+$/.test(raw)) throw new AppError(400, 'INVALID_AMOUNT', 'amountRaw must be an integer string');
  return formatUsdc(BigInt(raw));
}

async function checkTrustline(destination: string): Promise<PreflightCheck> {
  if (!StrKey.isValidEd25519PublicKey(destination)) {
    return { name: 'destination_trustline', ok: true, detail: 'contract destination; trustline not applicable' };
  }
  try {
    const res = await rpcServer.getLedgerEntries((xdr.LedgerKey.account as any)({ accountId: destination }));
    const account = res.entries?.[0]?.val.account();
    if (!account) return { name: 'destination_trustline', ok: false, detail: 'destination account not found' };
    return { name: 'destination_trustline', ok: true, detail: 'destination account exists (trustline checked on simulation)' };
  } catch {
    return { name: 'destination_trustline', ok: true, detail: 'could not read destination; simulation will decide', critical: false };
  }
}

// Soroban invokeHostFunction operations use the account's HIGH threshold.
export const REQUIRED_THRESHOLD_CATEGORY = 'invokeHostFunction';

function isPermissionlessExecute(op: AdminOp): boolean {
  return (
    op.kind === 'treasury.execute_config' ||
    op.kind === 'treasury.execute_price_policy' ||
    op.kind === 'treasury.execute_agent'
  );
}

function defaultPermissionlessSource(state: TreasuryState, fallback: string): string {
  try {
    const feeSecret = secret('STELLAR_FEE_PAYER_SECRET');
    if (feeSecret) return Keypair.fromSecret(feeSecret).publicKey();
  } catch {
    // fall through when secret store is not initialized
  }
  if (state.agent.address && StrKey.isValidEd25519PublicKey(state.agent.address)) {
    return state.agent.address;
  }
  return fallback;
}

export async function prepareOperation(
  op: AdminOp,
  requestedBy: string,
  deps: OpsDeps = {},
): Promise<PreparedOperation> {
  validateOp(op);
  const state = deps.state ? await deps.state() : await getTreasuryState(deps);
  const admin = state.treasury.admin;
  if (!admin) throw new AppError(503, 'TREASURY_ADMIN_UNAVAILABLE', 'Could not read the on-chain treasury admin');
  const permissionless = isPermissionlessExecute(op);
  if (!permissionless && admin.kind === 'contract') {
    throw new AppError(501, 'UNSUPPORTED_ADMIN_KIND', 'Contract (C…) admin wallets require auth-entry signing and are not supported by this console');
  }

  const sourceAccount = permissionless
    ? defaultPermissionlessSource(state, admin.address)
    : op.kind === 'treasury.deposit'
      ? op.from
      : admin.address;
  const account = deps.account ? await deps.account(sourceAccount) : await readAccount(sourceAccount);
  const threshold = permissionless ? 1 : account.thresholds.high;
  const required = permissionless
    ? 1
    : Math.max(1, threshold, op.kind === 'treasury.withdraw' ? config.TREASURY_WITHDRAW_MIN_SIGNERS : 0);

  let classification: ChangeClassification | undefined;
  let diff: FieldDiff[] | undefined;

  if (op.kind === 'treasury.propose_config') {
    ({ classification, diff } = classifyAndDiffConfig(state.treasury.config, op.config));
  } else if (op.kind === 'treasury.set_price_policy') {
    ({ classification, diff } = classifyAndDiffPricePolicy(state.treasury.pricePolicy ?? null, op.policy));
  } else if (op.kind === 'treasury.set_agent') {
    const curAgent = state.treasury.agentPolicies?.[op.agent] ?? null;
    ({ classification, diff } = classifyAndDiffAgentPolicy(curAgent, op.policy));
  } else if (op.kind === 'treasury.remove_agent') {
    classification = 'tighten';
    diff = [{ field: 'active', current: true, proposed: false, direction: 'tighten' }];
  } else if (op.kind === 'treasury.set_creation_policy') {
    ({ classification, diff } = classifyAndDiffCreationPolicy(state.treasury.creationPolicy ?? null, op.policy));
    if (classification === 'loosen') {
      throw new AppError(422, 'POLICY_LOOSENING', 'set_creation_policy accepts tightening only', { diff });
    }
  }

  const now = nowMs(deps);
  const ledgerNowUnix = state.treasury.ledgerTimeUnix ?? Math.floor(now / 1000);

  if (permissionless) {
    const targetKind =
      op.kind === 'treasury.execute_config'
        ? 'config'
        : op.kind === 'treasury.execute_price_policy'
          ? 'price_policy'
          : 'agent';
    const targetAgent = op.kind === 'treasury.execute_agent' ? op.agent : undefined;
    const pending = (state.treasury.proposals ?? []).find(
      (p) =>
        p.kind === targetKind &&
        (!targetAgent || p.agent === targetAgent) &&
        (p.status === 'pending' || p.status === 'executable'),
    );
    if (!pending) {
      throw new AppError(404, 'NO_PENDING_PROPOSAL', `No pending ${targetKind} proposal found on-chain`);
    }
    if (ledgerNowUnix < pending.executableAtUnix) {
      throw new AppError(422, 'TIMELOCK_ACTIVE', 'Proposal timelock has not elapsed yet', {
        executableAt: pending.executableAt,
        etaSeconds: pending.executableAtUnix - ledgerNowUnix,
      });
    }
  }

  const checks: PreflightCheck[] = [];
  if (classification) {
    checks.push({
      name: 'change_classification',
      ok: true,
      detail: `classified as ${classification}${classification === 'loosen' ? ' (timelocked)' : ' (immediate)'}`,
      critical: false,
    });
  }
  const available = BigInt(state.treasury.availableCapitalRaw);
  if (op.kind === 'treasury.withdraw') {
    const amount = BigInt(op.amountRaw);
    checks.push({
      name: 'amount_within_available_capital',
      ok: amount <= available,
      detail: `${formatUsdc(amount)} requested, ${formatUsdc(available)} available`,
      critical: true,
    });
    checks.push({
      name: 'destination_not_internal',
      ok: op.to !== CONTRACTS.treasury && op.to !== CONTRACTS.marketCore,
      detail: 'withdrawing to the treasury/market-core contract would lock the funds',
      critical: true,
    });
    checks.push(await checkTrustline(op.to));
    const remainingAfter = available > amount ? available - amount : 0n;
    const maxDaily = BigInt(state.treasury.config?.max_daily ?? 0);
    if (maxDaily > 0n && remainingAfter < maxDaily) {
      checks.push({
        name: 'capital_below_daily_cap',
        ok: true,
        detail: `warning: remaining capital ${formatUsdc(remainingAfter)} is below max_daily ${formatUsdc(maxDaily)}`,
        critical: false,
      });
    }
  }
  if (op.kind === 'treasury.collect_market_fees') {
    try {
      const market = await getOnChainMarket(BigInt(op.onChainMarketId));
      checks.push({
        name: 'market_has_fees',
        ok: BigInt(market.fees_accrued) > 0n,
        detail: `${market.fees_accrued.toString()} base units accrued`,
        critical: true,
      });
    } catch (err) {
      checks.push({ name: 'market_readable', ok: false, detail: err instanceof Error ? err.message : String(err), critical: true });
    }
  }

  const blocking = checks.some((c) => !c.ok && c.critical !== false);
  if (blocking) {
    throw new AppError(422, 'PREFLIGHT_FAILED', 'Pre-flight checks failed', { checks });
  }

  const built = deps.build
    ? await deps.build(op, state)
    : await buildUnsigned(op, sourceAccount, admin.address);
  checks.unshift({
    name: 'simulation',
    ok: true,
    detail: 'simulation succeeded; footprint, resource fee and auth entries assembled',
    critical: true,
  });

  const expiresAt = new Date(now + config.TREASURY_OP_TTL_SECONDS * 1000);
  const row = await prisma.adminOperation.create({
    data: {
      kind: op.kind,
      params: op as unknown as object,
      contractId: built.contractId,
      sourceAccount: built.sourceAccount,
      unsignedXdr: built.xdr,
      txHash: built.hash,
      status: 'PREPARED',
      requestedBy,
      expiresAt,
    },
  });
  await audit(row.id, 'PREPARED', requestedBy, { kind: op.kind, checks, classification, diff });

  return {
    id: row.id,
    kind: op.kind,
    xdr: built.xdr,
    networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
    hash: built.hash,
    expiresAt: expiresAt.toISOString(),
    requiredSigners: required,
    thresholds: account.thresholds,
    checks,
    humanSummary: humanSummary(op),
    status: 'PREPARED',
    ...(classification !== undefined ? { classification } : {}),
    ...(diff !== undefined ? { diff } : {}),
    ...(permissionless ? { permissionless: true } : {}),
  };
}

const CONTRACT_METHOD_OPS = new Set<AdminOp['kind']>([
  'treasury.propose_config',
  'treasury.execute_config',
  'treasury.cancel_config',
  'treasury.set_price_policy',
  'treasury.execute_price_policy',
  'treasury.cancel_price_policy',
  'treasury.set_agent',
  'treasury.execute_agent',
  'treasury.cancel_agent',
  'treasury.remove_agent',
  'treasury.set_creation_policy',
  'treasury.set_drawdown_config',
]);

async function buildUnsigned(
  op: AdminOp,
  sourceAccount: string,
  _adminAddress: string,
): Promise<{ xdr: string; hash: string; contractId: string; sourceAccount: string }> {
  const options = { timeoutInSeconds: config.TREASURY_OP_TTL_SECONDS };
  let tx: AssembledTransaction<unknown>;
  let contractId: string;

  if (CONTRACT_METHOD_OPS.has(op.kind)) {
    contractId = CONTRACTS.treasury;
    const method = op.kind.replace('treasury.', '');
    const contract = new Contract(contractId);
    const acc = await rpcServer.getAccount(sourceAccount);
    const builtTx = new TransactionBuilder(acc, {
      fee: '100',
      networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...encodeProposalScArgs(method, op as unknown as Record<string, unknown>)))
      .setTimeout(options.timeoutInSeconds)
      .build();
    const prepared = await rpcServer.prepareTransaction(builtTx);
    return {
      xdr: prepared.toXDR(),
      hash: prepared.hash().toString('hex'),
      contractId,
      sourceAccount,
    };
  }

  if (op.kind === 'market_core.set_paused') {
    contractId = CONTRACTS.marketCore;
    const client = new MarketCoreClient({
      contractId,
      rpcUrl: config.STELLAR_RPC_URL,
      networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
      publicKey: sourceAccount,
    });
    tx = await client.set_paused({ paused: op.paused }, options);
  } else {
    contractId = CONTRACTS.treasury;
    const client = new TreasuryClient({
      contractId,
      rpcUrl: config.STELLAR_RPC_URL,
      networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
      publicKey: sourceAccount,
    });
    if (op.kind === 'treasury.set_paused') tx = await client.set_paused({ paused: op.paused }, options);
    else if (op.kind === 'treasury.withdraw') tx = await client.withdraw({ to: op.to, amount: BigInt(op.amountRaw) }, options);
    else if (op.kind === 'treasury.deposit') tx = await client.deposit({ from: op.from, amount: BigInt(op.amountRaw) }, options);
    else tx = await client.collect_market_fees({ market_id: BigInt((op as { onChainMarketId: string }).onChainMarketId) }, options);
  }

  const simError = (tx.simulation as { error?: string } | undefined)?.error;
  if (simError) {
    throw new AppError(422, 'SIMULATION_FAILED', 'Transaction simulation failed', {
      contractError: contractErrorName(op.kind.startsWith('market_core') ? 'marketCore' : 'treasury', simError, simError),
    });
  }
  if (!tx.built) throw new AppError(502, 'BUILD_FAILED', 'Simulation did not produce a transaction envelope');
  return {
    xdr: tx.toXDR(),
    hash: tx.built.hash().toString('hex'),
    contractId,
    sourceAccount,
  };
}

async function audit(operationId: string, state: string, actor: string, data?: Record<string, unknown>): Promise<void> {
  await prisma.agentLog
    .create({
      data: {
        agentType: 'TRADER',
        level: state === 'FAILED' ? 'ERROR' : 'INFO',
        action: `${TREASURY_EVENT}_${state}`,
        data: { operationId, actor, ...data } as object,
      },
    })
    .catch((err) => logger.error({ err, operationId }, 'Failed to write admin operation audit entry'));
}

function parseSignatures(row: { signatures: unknown }): SignatureRecord[] {
  return Array.isArray(row.signatures) ? (row.signatures as unknown as SignatureRecord[]) : [];
}

function eligibleEd25519Signers(account: AccountState): AccountSigner[] {
  const list: AccountSigner[] = [
    ...(account.masterWeight > 0 ? [{ key: account.address, kind: 'ed25519' as const, weight: account.masterWeight }] : []),
    ...account.signers.filter((s) => s.kind === 'ed25519' && s.weight > 0),
  ];
  const dedup = new Map<string, AccountSigner>();
  for (const s of list) {
    if (!dedup.has(s.key)) dedup.set(s.key, s);
  }
  return [...dedup.values()];
}

/**
 * Pure signature-extraction and weight-accounting step shared by paste and
 * SEP-7 callback channels (#270).
 */
export function acceptSignatures(
  row: { kind: string; unsignedXdr: string; txHash: string; signatures: unknown },
  incomingTx: { hash(): Buffer; signatures?: Array<{ hint(): Buffer; signature(): Buffer }> },
  account: AccountState,
  now: number,
  addedBy: string,
  channel: 'paste' | 'sep7' = 'paste',
): {
  status: 'READY' | 'PARTIALLY_SIGNED';
  weightCollected: number;
  requiredSigners: number;
  signatures: SignatureRecord[];
  newlyAccepted: string[];
  signedXdr: string;
} {
  const existing = parseSignatures(row);
  const seenSigners = new Set(existing.map((s) => s.signer));
  const records = [...existing];
  const newlyAccepted: string[] = [];
  const required = Math.max(
    1,
    account.thresholds.high,
    row.kind === 'treasury.withdraw' ? config.TREASURY_WITHDRAW_MIN_SIGNERS : 0,
  );

  const candidates = eligibleEd25519Signers(account);

  for (const sig of incomingTx.signatures ?? []) {
    const hint = sig.hint();
    const match = candidates.find((candidate) => {
      if (candidate.kind !== 'ed25519') return false;
      try {
        return Keypair.fromPublicKey(candidate.key).signatureHint().equals(hint);
      } catch {
        return false;
      }
    });
    if (!match || seenSigners.has(match.key)) continue;
    let valid = false;
    try {
      valid = Keypair.fromPublicKey(match.key).verify(incomingTx.hash(), sig.signature());
    } catch {
      valid = false;
    }
    if (!valid) continue;
    seenSigners.add(match.key);
    newlyAccepted.push(match.key);
    records.push({
      signer: match.key,
      hint: hint.toString('hex'),
      signature: sig.signature().toString('base64'),
      addedAt: new Date(now).toISOString(),
      addedBy,
      channel,
    });
  }

  const merged = TransactionBuilder.fromXDR(row.unsignedXdr, config.STELLAR_NETWORK_PASSPHRASE) as unknown as {
    addDecoratedSignature(sig: unknown): void;
    toXDR(): string;
  };
  for (const record of records) {
    merged.addDecoratedSignature(
      new xdr.DecoratedSignature({ hint: Buffer.from(record.hint, 'hex'), signature: Buffer.from(record.signature, 'base64') }),
    );
  }
  const weightCollected = records.reduce((sum, record) => {
    const signer = candidates.find((candidate) => candidate.key === record.signer);
    return sum + (signer?.weight ?? 0);
  }, 0);

  const status = weightCollected >= required ? 'READY' : 'PARTIALLY_SIGNED';
  return {
    status,
    weightCollected,
    requiredSigners: required,
    signatures: records,
    newlyAccepted,
    signedXdr: merged.toXDR(),
  };
}

async function revokeOpenSep7Requests(operationId: string): Promise<void> {
  await (prisma as any).sep7Request
    ?.updateMany({
      where: { operationId, status: 'ISSUED' },
      data: { status: 'REVOKED' },
    })
    .catch(() => {});
}

/** Merges a signed XDR into the prepared operation after hash/signature checks. */
export async function addSignature(
  operationId: string,
  signedXdr: string,
  addedBy: string,
  deps: OpsDeps = {},
  channel: 'paste' | 'sep7' = 'paste',
): Promise<{ status: string; weightCollected: number; requiredSigners: number; signatures: SignatureRecord[] }> {
  const row = await prisma.adminOperation.findUnique({ where: { id: operationId } });
  if (!row) throw new AppError(404, 'ADMIN_OP_NOT_FOUND', 'Admin operation not found');
  const now = nowMs(deps);
  if (row.expiresAt.getTime() <= now || row.status === 'EXPIRED') {
    await prisma.adminOperation.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
    await revokeOpenSep7Requests(row.id);
    await audit(row.id, 'EXPIRED', addedBy);
    throw new AppError(410, 'ADMIN_OP_EXPIRED', 'This operation has expired; prepare a new one');
  }
  if (!['PREPARED', 'PARTIALLY_SIGNED'].includes(row.status)) {
    throw new AppError(409, 'ADMIN_OP_NOT_SIGNABLE', `Operation is ${row.status}`);
  }

  let incoming: unknown;
  try {
    incoming = TransactionBuilder.fromXDR(signedXdr, config.STELLAR_NETWORK_PASSPHRASE);
  } catch {
    throw new AppError(400, 'INVALID_SIGNED_XDR', 'signedXdr is not a valid Stellar transaction envelope');
  }
  const incomingTx = incoming as { hash(): Buffer; signatures?: Array<{ hint(): Buffer; signature(): Buffer }> };
  const hashHex = incomingTx.hash().toString('hex');
  if (hashHex !== row.txHash) {
    throw new AppError(409, 'ADMIN_OP_HASH_MISMATCH', 'Signed transaction body does not match the prepared operation');
  }

  const admin = (row.sourceAccount && (deps.account ? await deps.account(row.sourceAccount) : await readAccount(row.sourceAccount))) || null;
  if (!admin) throw new AppError(503, 'ADMIN_STATE_UNAVAILABLE', 'Could not read the admin account state');

  const accepted = acceptSignatures(row, incomingTx, admin, now, addedBy, channel);

  await prisma.adminOperation.update({
    where: { id: row.id },
    data: {
      signedXdr: accepted.signedXdr,
      signatures: accepted.signatures as unknown as object,
      weightCollected: accepted.weightCollected,
      status: accepted.status,
    },
  });
  if (accepted.status === 'READY') {
    await revokeOpenSep7Requests(row.id);
  }
  await audit(row.id, accepted.status, addedBy, {
    weightCollected: accepted.weightCollected,
    required: accepted.requiredSigners,
    channel,
  });

  return {
    status: accepted.status,
    weightCollected: accepted.weightCollected,
    requiredSigners: accepted.requiredSigners,
    signatures: accepted.signatures,
  };
}

function resolveSep7SigningSecret(): string {
  try {
    return secret('URI_REQUEST_SIGNING_SECRET') || config.URI_REQUEST_SIGNING_SECRET;
  } catch {
    return config.URI_REQUEST_SIGNING_SECRET;
  }
}

/**
 * Issues single-use signed SEP-7 URIs for every unsigned eligible ed25519
 * signer on a prepared/partially-signed treasury operation (#270). Re-issuing
 * rotates tokens and revokes previously issued tokens.
 */
export async function issueSep7Requests(
  operationId: string,
  actor: string,
  deps: OpsDeps = {},
): Promise<
  Array<{
    signer: string;
    weight: number;
    uri: string;
    qrTooLarge: boolean;
    expiresAt: string;
    status: string;
  }>
> {
  const signingSecret = resolveSep7SigningSecret();
  if (!signingSecret) {
    throw new AppError(503, 'SEP7_NOT_CONFIGURED', 'URI_REQUEST_SIGNING_SECRET is not configured');
  }

  const row = await prisma.adminOperation.findUnique({ where: { id: operationId } });
  if (!row) throw new AppError(404, 'ADMIN_OP_NOT_FOUND', 'Admin operation not found');
  const now = nowMs(deps);
  if (row.expiresAt.getTime() <= now || row.status === 'EXPIRED') {
    await prisma.adminOperation.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
    await revokeOpenSep7Requests(row.id);
    throw new AppError(410, 'ADMIN_OP_EXPIRED', 'This operation has expired; prepare a new one');
  }
  if (!['PREPARED', 'PARTIALLY_SIGNED'].includes(row.status)) {
    throw new AppError(409, 'ADMIN_OP_NOT_SIGNABLE', `Operation is ${row.status}`);
  }

  const admin = (row.sourceAccount && (deps.account ? await deps.account(row.sourceAccount) : await readAccount(row.sourceAccount))) || null;
  if (!admin) throw new AppError(503, 'ADMIN_STATE_UNAVAILABLE', 'Could not read the admin account state');

  const signedSet = new Set(parseSignatures(row).map((s) => s.signer));
  const signers = eligibleEd25519Signers(admin).filter((s) => !signedSet.has(s.key));
  const signingKey = Keypair.fromSecret(signingSecret);
  const expiresAtMs = Math.min(row.expiresAt.getTime(), now + config.SEP7_TOKEN_TTL_SECONDS * 1000);
  const expiresAt = new Date(expiresAtMs);
  const callbackBase = (config.SEP7_CALLBACK_BASE_URL || config.PUBLIC_API_BASE_URL).replace(/\/+$/, '');
  const originDomain = config.SEP7_ORIGIN_DOMAIN || config.AUTH_HOME_DOMAIN;
  const summary = typeof (row as any).summary === 'string' && (row as any).summary
    ? String((row as any).summary)
    : `Approve ${row.kind}`;

  const issued: Array<{
    signer: string;
    weight: number;
    uri: string;
    qrTooLarge: boolean;
    expiresAt: string;
    status: string;
  }> = [];

  for (const s of signers) {
    const token = generateSep7Token();
    const tokenHash = hashSep7Token(token);
    const callback = `url:${callbackBase}/sep7/callback/${token}`;
    const uri = buildTxUri(
      {
        xdr: row.unsignedXdr,
        callback,
        pubkey: s.key,
        msg: summary,
        networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
        originDomain,
      },
      signingKey,
    );

    // Store only the redacted URI placeholder and SHA-256 tokenHash in DB so raw tokens are never persisted.
    const storedRedactedUri = uri.replace(encodeURIComponent(token), '[redacted]');
    await (prisma as any).sep7Request.upsert({
      where: { operationId_signer: { operationId: row.id, signer: s.key } },
      create: {
        operationId: row.id,
        signer: s.key,
        tokenHash,
        status: 'ISSUED',
        uri: storedRedactedUri,
        expiresAt,
      },
      update: {
        tokenHash,
        status: 'ISSUED',
        uri: storedRedactedUri,
        expiresAt,
        usedAt: null,
        rejectCode: null,
      },
    });

    issued.push({
      signer: s.key,
      weight: s.weight,
      uri,
      qrTooLarge: isQrTooLarge(uri),
      expiresAt: expiresAt.toISOString(),
      status: 'ISSUED',
    });
  }

  await audit(row.id, 'SEP7_ISSUED', actor, { count: issued.length });
  return issued;
}

/** Returns per-signer SEP-7 status without ever returning raw callback tokens. */
export async function getSep7Status(operationId: string) {
  const row = await prisma.adminOperation.findUnique({ where: { id: operationId } });
  if (!row) throw new AppError(404, 'ADMIN_OP_NOT_FOUND', 'Admin operation not found');
  const requests: Array<{
    signer: string;
    status: string;
    expiresAt: Date;
    usedAt: Date | null;
    rejectCode: string | null;
  }> = (await (prisma as any).sep7Request?.findMany({
    where: { operationId },
    select: { signer: true, status: true, expiresAt: true, usedAt: true, rejectCode: true },
  })) ?? [];
  return requests;
}

/**
 * Handles an unauthenticated wallet SEP-7 callback (`POST /sep7/callback/:token`) (#270).
 */
export async function handleSep7Callback(
  token: string,
  signedXdr: string,
  io?: { to(room: string): { emit(event: string, payload: unknown): void } },
  deps: OpsDeps = {},
): Promise<{ status: string; weightCollected: number; requiredSigners: number; signatures: SignatureRecord[] }> {
  const tokenHash = hashSep7Token(token);
  const reqRow = await (prisma as any).sep7Request.findUnique({ where: { tokenHash } });
  const now = nowMs(deps);

  if (!reqRow || reqRow.status !== 'ISSUED' || new Date(reqRow.expiresAt).getTime() <= now) {
    throw new AppError(410, 'SEP7_TOKEN_INVALID', 'Signing request is no longer valid');
  }

  let parsed: unknown;
  try {
    parsed = TransactionBuilder.fromXDR(signedXdr, config.STELLAR_NETWORK_PASSPHRASE);
  } catch {
    throw new AppError(400, 'INVALID_SIGNED_XDR', 'xdr is not a valid Stellar transaction envelope');
  }

  // Reject fee-bump envelopes.
  if (parsed && typeof parsed === 'object' && 'innerTransaction' in parsed) {
    throw new AppError(400, 'FEE_BUMP_NOT_ALLOWED', 'Fee-bump envelopes are not accepted for SEP-7 signing');
  }

  const incomingTx = parsed as { hash(): Buffer; signatures?: Array<{ hint(): Buffer; signature(): Buffer }> };
  const expectedKey = Keypair.fromPublicKey(reqRow.signer);
  const expectedHint = expectedKey.signatureHint();
  const hasExpectedSignerSig = (incomingTx.signatures ?? []).some((sig) => {
    try {
      return sig.hint().equals(expectedHint) && expectedKey.verify(incomingTx.hash(), sig.signature());
    } catch {
      return false;
    }
  });
  if (!hasExpectedSignerSig) {
    throw new AppError(400, 'SIGNER_SIGNATURE_MISSING', 'Envelope does not contain a valid signature from the expected signer');
  }

  const row = await prisma.adminOperation.findUnique({ where: { id: reqRow.operationId } });
  if (!row || row.expiresAt.getTime() <= now || !['PREPARED', 'PARTIALLY_SIGNED'].includes(row.status)) {
    await revokeOpenSep7Requests(reqRow.operationId);
    throw new AppError(410, 'SEP7_TOKEN_INVALID', 'Signing request is no longer valid');
  }

  if (incomingTx.hash().toString('hex') !== row.txHash) {
    throw new AppError(409, 'ADMIN_OP_HASH_MISMATCH', 'Signed transaction body does not match the prepared operation');
  }

  const admin = (row.sourceAccount && (deps.account ? await deps.account(row.sourceAccount) : await readAccount(row.sourceAccount))) || null;
  if (!admin) throw new AppError(503, 'ADMIN_STATE_UNAVAILABLE', 'Could not read the admin account state');

  const isStillSigner = eligibleEd25519Signers(admin).some((s) => s.key === reqRow.signer);
  if (!isStillSigner) {
    await (prisma as any).sep7Request.update({
      where: { id: reqRow.id },
      data: { status: 'REJECTED', rejectCode: 'NOT_A_SIGNER' },
    });
    throw new AppError(403, 'NOT_A_SIGNER', 'Signer is no longer authorized on the source account');
  }

  // Compare-and-set single-use transition inside a transaction so concurrent
  // callbacks with the same token result in exactly one winner.
  const accepted = acceptSignatures(row, incomingTx, admin, now, `sep7:${reqRow.signer}`, 'sep7');
  await prisma.$transaction(async (tx: any) => {
    const claimed = await tx.sep7Request.updateMany({
      where: { id: reqRow.id, status: 'ISSUED' },
      data: { status: 'USED', usedAt: new Date(now) },
    });
    if (claimed.count !== 1) {
      throw new AppError(410, 'SEP7_TOKEN_INVALID', 'Signing request is no longer valid');
    }
    await tx.adminOperation.update({
      where: { id: row.id },
      data: {
        signedXdr: accepted.signedXdr,
        signatures: accepted.signatures as unknown as object,
        weightCollected: accepted.weightCollected,
        status: accepted.status,
      },
    });
    if (accepted.status === 'READY') {
      await tx.sep7Request.updateMany({
        where: { operationId: row.id, status: 'ISSUED' },
        data: { status: 'REVOKED' },
      });
    }
  });

  await audit(row.id, accepted.status, `sep7:${reqRow.signer}`, {
    weightCollected: accepted.weightCollected,
    required: accepted.requiredSigners,
    channel: 'sep7',
  });

  io?.to('admins').emit('ADMIN_OP_SIGNATURE_ADDED', {
    operationId: row.id,
    signer: reqRow.signer,
    channel: 'sep7',
    status: accepted.status,
    weightCollected: accepted.weightCollected,
    requiredSigners: accepted.requiredSigners,
  });

  return {
    status: accepted.status,
    weightCollected: accepted.weightCollected,
    requiredSigners: accepted.requiredSigners,
    signatures: accepted.signatures,
  };
}

/** Submits a READY operation and records its final result. No server key is used. */
export async function submitOperation(
  operationId: string,
  deps: OpsDeps = {},
): Promise<{ status: string; ledger?: number; resultXdr?: string; hash: string }> {
  const row = await prisma.adminOperation.findUnique({ where: { id: operationId } });
  if (!row) throw new AppError(404, 'ADMIN_OP_NOT_FOUND', 'Admin operation not found');
  const now = nowMs(deps);
  if (row.expiresAt.getTime() <= now) {
    await prisma.adminOperation.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
    await audit(row.id, 'EXPIRED', 'system');
    throw new AppError(410, 'ADMIN_OP_EXPIRED', 'This operation has expired; prepare a new one');
  }
  if (row.status !== 'READY' || !row.signedXdr) {
    throw new AppError(409, 'ADMIN_OP_NOT_READY', `Operation is ${row.status}; collect enough signatures first`);
  }
  if (config.STELLAR_NETWORK_PASSPHRASE !== Networks.TESTNET) {
    throw new AppError(403, 'TESTNET_ONLY', 'Admin submission is testnet-only');
  }

  const result = deps.submit
    ? await deps.submit(row.signedXdr)
    : await submitToRpc(row.signedXdr);

  const success = result.status === 'SUCCESS';
  await prisma.adminOperation.update({
    where: { id: row.id },
    data: {
      status: success ? 'SUCCESS' : 'FAILED',
      resultXdr: result.resultXdr,
      ledger: result.ledger,
      error: result.error !== undefined ? (result.error as object) : undefined,
    },
  });
  await audit(row.id, success ? 'SUCCESS' : 'FAILED', 'system', { hash: result.hash, ledger: result.ledger });
  return result;
}

async function submitToRpc(signedXdr: string): Promise<{ status: string; ledger?: number; resultXdr?: string; hash: string; error?: unknown }> {
  const tx = TransactionBuilder.fromXDR(signedXdr, config.STELLAR_NETWORK_PASSPHRASE);
  const hash = tx.hash().toString('hex');
  const sent = await rpcServer.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    return { status: 'FAILED', hash, error: sent.errorResult ?? sent };
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await rpcServer.getTransaction(hash);
    if (result.status !== 'NOT_FOUND') {
      const done = result as any;
      return {
        status: result.status,
        hash,
        ledger: done.ledger,
        resultXdr: done.resultXdr?.toXDR?.('base64') ?? undefined,
        error: result.status === 'FAILED' ? done.resultXdr : undefined,
      };
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { status: 'FAILED', hash, error: { message: 'Timed out waiting for the transaction result' } };
}

export async function recordSubmitted(operationId: string, txHash: string, actor: string): Promise<void> {
  const row = await prisma.adminOperation.findUnique({ where: { id: operationId } });
  if (!row) throw new AppError(404, 'ADMIN_OP_NOT_FOUND', 'Admin operation not found');
  const result = await rpcServer.getTransaction(txHash);
  const done = result as any;
  const success = result.status === 'SUCCESS';
  await prisma.adminOperation.update({
    where: { id: row.id },
    data: {
      status: success ? 'SUCCESS' : result.status === 'NOT_FOUND' ? 'SUBMITTED' : 'FAILED',
      resultXdr: done.resultXdr?.toXDR?.('base64') ?? undefined,
      ledger: done.ledger,
    },
  });
  await audit(row.id, success ? 'SUCCESS' : 'SUBMITTED', actor, { txHash });
}

export async function cancelOperation(operationId: string, actor: string): Promise<void> {
  const row = await prisma.adminOperation.findUnique({ where: { id: operationId } });
  if (!row) throw new AppError(404, 'ADMIN_OP_NOT_FOUND', 'Admin operation not found');
  if (['SUBMITTED', 'SUCCESS', 'FAILED', 'EXPIRED'].includes(row.status)) {
    throw new AppError(409, 'ADMIN_OP_NOT_CANCELLABLE', `Operation is ${row.status}`);
  }
  await prisma.adminOperation.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
  await revokeOpenSep7Requests(row.id);
  await audit(row.id, 'CANCELLED', actor);
}

export async function getOperation(operationId: string) {
  const row = await prisma.adminOperation.findUnique({ where: { id: operationId } });
  if (!row) throw new AppError(404, 'ADMIN_OP_NOT_FOUND', 'Admin operation not found');
  const sep7Requests: Array<{ signer: string; status: string; expiresAt: Date }> =
    (await (prisma as any).sep7Request?.findMany?.({
      where: { operationId },
      select: { signer: true, status: true, expiresAt: true },
    })) ?? [];
  const sigBySigner = new Map(parseSignatures(row).map((s) => [s.signer, s]));
  const reqBySigner = new Map(sep7Requests.map((r) => [r.signer, r]));
  const allSigners = new Set([...sigBySigner.keys(), ...reqBySigner.keys()]);
  const signers = [...allSigners].map((key) => {
    const sig = sigBySigner.get(key);
    const req = reqBySigner.get(key);
    return {
      key,
      signed: Boolean(sig),
      channel: sig?.channel ?? null,
      sep7Status: req?.status ?? null,
      sep7ExpiresAt: req?.expiresAt ? new Date(req.expiresAt).toISOString() : null,
    };
  });
  return { ...row, signers };
}

export async function listOperations(page: number, limit: number) {
  const [rows, total] = await Promise.all([
    prisma.adminOperation.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.adminOperation.count(),
  ]);
  return { rows, total };
}
