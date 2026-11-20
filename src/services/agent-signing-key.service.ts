/**
 * Agent trace signing key lifecycle service (#273).
 *
 * Manages on-chain registration, status checks, boot gating, and rotation for
 * detached Ed25519 trace signing keys in `reasoning-registry`.
 */
import { config } from '../config';
import { CONTRACTS } from '../config/contracts';
import { logger } from '../lib/logger';
import { AppError } from '../middlewares/error.middleware';
import { keyBindMessage, traceSigner } from '../lib/trace-signing';
import { agentSigner } from './stellar/clients';

export interface SigningKeyHistoryRecord {
  publicKey: string;
  addedAt: number;
  retiredAt?: number | null;
}

export type OurSigningKeyState = 'ACTIVE' | 'RETIRED' | 'UNBOUND' | 'BOUND_TO_OTHER_AGENT';

export interface SigningKeyStatus {
  agent: string;
  ourPublicKey: string | null;
  active: string[];
  history: SigningKeyHistoryRecord[];
  ours: OurSigningKeyState;
}

export interface SigningKeyChainDeps {
  agentAddress?: string;
  registryId?: string;
  networkPassphrase?: string;
  overrideSeed?: string;
  isAgentActive?: (agent: string) => Promise<boolean>;
  getSigningKeys?: (agent: string) => Promise<string[]>;
  getKeyAgent?: (publicKeyHex: string) => Promise<string | null>;
  getHistory?: (agent: string) => Promise<SigningKeyHistoryRecord[]>;
  submitAddKey?: (args: { agent: string; publicKey: Buffer; proofSig: Buffer }) => Promise<{ txHash: string }>;
  prepareAddKey?: (args: { agent: string; publicKey: Buffer; proofSig: Buffer }) => Promise<{ xdr: string }>;
  submitRetireKey?: (args: { agent: string; publicKey: Buffer }) => Promise<{ txHash: string }>;
  prepareRetireKey?: (args: { agent: string; publicKey: Buffer }) => Promise<{ xdr: string }>;
}

function resolveAgent(deps: SigningKeyChainDeps): string {
  const addr = deps.agentAddress ?? agentSigner().publicKey;
  if (!addr) {
    throw new AppError(503, 'AGENT_NOT_CONFIGURED', 'Agent public key is not configured');
  }
  return addr;
}

export async function signingKeyStatus(deps: SigningKeyChainDeps = {}): Promise<SigningKeyStatus> {
  const agent = resolveAgent(deps);
  let ourPublicKey: string | null = null;
  try {
    ourPublicKey = traceSigner(deps.overrideSeed).publicKeyHex;
  } catch {
    ourPublicKey = null;
  }

  const active = deps.getSigningKeys ? await deps.getSigningKeys(agent) : [];
  const history = deps.getHistory ? await deps.getHistory(agent) : [];

  let ours: OurSigningKeyState = 'UNBOUND';
  if (ourPublicKey) {
    if (active.includes(ourPublicKey)) {
      ours = 'ACTIVE';
    } else {
      const boundAgent = deps.getKeyAgent ? await deps.getKeyAgent(ourPublicKey) : null;
      if (boundAgent && boundAgent !== agent) {
        ours = 'BOUND_TO_OTHER_AGENT';
      } else if (boundAgent === agent || history.some((h) => h.publicKey === ourPublicKey)) {
        ours = 'RETIRED';
      } else {
        ours = 'UNBOUND';
      }
    }
  }

  return { agent, ourPublicKey, active, history, ours };
}

/**
 * Idempotently registers the configured `TRACE_SIGNING_KEY` for the agent by
 * signing `keyBindMessage` with the trace key itself (proof of possession).
 * Supports `submit` (direct agent auth) and `prepare` (unsigned XDR for multisig).
 */
export async function ensureSigningKeyRegistered(
  opts: { mode: 'submit' | 'prepare' },
  deps: SigningKeyChainDeps = {},
): Promise<{ alreadyActive?: boolean; publicKey: string; txHash?: string; xdr?: string }> {
  const agent = resolveAgent(deps);
  const signer = traceSigner(deps.overrideSeed);

  if (deps.isAgentActive) {
    const activeAgent = await deps.isAgentActive(agent);
    if (!activeAgent) {
      throw new AppError(409, 'AGENT_NOT_ACTIVE', 'Agent must be active in reasoning-registry before adding a signing key');
    }
  }

  const status = await signingKeyStatus(deps);
  if (status.ours === 'ACTIVE') {
    return { alreadyActive: true, publicKey: signer.publicKeyHex };
  }
  if (status.ours === 'BOUND_TO_OTHER_AGENT') {
    throw new AppError(409, 'KEY_ALREADY_BOUND', 'Signing key is already bound to another agent');
  }
  if (status.ours === 'RETIRED') {
    throw new AppError(409, 'KEY_ALREADY_BOUND', 'Retired signing key cannot be re-added; rotate to a fresh key');
  }
  if (status.active.length >= 4) {
    throw new AppError(409, 'TOO_MANY_KEYS', 'Agent already has the maximum number of active signing keys (4); retire one first');
  }

  const msg = keyBindMessage({
    networkPassphrase: deps.networkPassphrase ?? config.STELLAR_NETWORK_PASSPHRASE,
    registry: deps.registryId ?? CONTRACTS.reasoningRegistry,
    agent,
    publicKey: signer.publicKey,
  });
  const proofSig = signer.sign(msg);

  if (opts.mode === 'prepare') {
    if (!deps.prepareAddKey) {
      throw new AppError(501, 'PREPARE_UNAVAILABLE', 'Prepared unsigned XDR builder requires live registry bindings');
    }
    const { xdr } = await deps.prepareAddKey({ agent, publicKey: signer.publicKey, proofSig });
    return { publicKey: signer.publicKeyHex, xdr };
  }

  if (!deps.submitAddKey) {
    throw new AppError(501, 'SUBMIT_UNAVAILABLE', 'Signing key submission requires live chain mode');
  }
  const { txHash } = await deps.submitAddKey({ agent, publicKey: signer.publicKey, proofSig });
  return { publicKey: signer.publicKeyHex, txHash };
}

/**
 * Retires an active signing key for the agent while preserving `KeyToAgent`
 * binding on-chain so historic trace signatures continue to verify.
 */
export async function retireSigningKey(
  publicKeyHex: string,
  opts: { mode: 'submit' | 'prepare' },
  deps: SigningKeyChainDeps = {},
): Promise<{ publicKey: string; txHash?: string; xdr?: string }> {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) {
    throw new AppError(400, 'INVALID_KEY', 'publicKey must be a 64-char hex Ed25519 public key');
  }
  const agent = resolveAgent(deps);
  if (deps.isAgentActive) {
    const activeAgent = await deps.isAgentActive(agent);
    if (!activeAgent) {
      throw new AppError(409, 'AGENT_NOT_ACTIVE', 'Agent must be active in reasoning-registry to retire a signing key');
    }
  }

  const normalized = publicKeyHex.toLowerCase();
  const publicKey = Buffer.from(normalized, 'hex');
  if (opts.mode === 'prepare') {
    if (!deps.prepareRetireKey) {
      throw new AppError(501, 'PREPARE_UNAVAILABLE', 'Prepared unsigned XDR builder requires live registry bindings');
    }
    const { xdr } = await deps.prepareRetireKey({ agent, publicKey });
    return { publicKey: normalized, xdr };
  }

  if (!deps.submitRetireKey) {
    throw new AppError(501, 'SUBMIT_UNAVAILABLE', 'Signing key retirement requires live chain mode');
  }
  const { txHash } = await deps.submitRetireKey({ agent, publicKey });
  return { publicKey: normalized, txHash };
}

/**
 * Boot gate (#273): when `TRACE_SIGNING_REQUIRED=true` in live mode, refuses
 * to boot unless the configured `TRACE_SIGNING_KEY` is currently `ACTIVE` on-chain.
 */
export async function runTraceSigningBootGate(deps: SigningKeyChainDeps = {}): Promise<void> {
  if (!config.TRACE_SIGNING_REQUIRED || config.CHAIN_EXECUTION_MODE !== 'live') {
    return;
  }
  const status = await signingKeyStatus(deps);
  if (status.ours !== 'ACTIVE') {
    logger.fatal({ ours: status.ours, agent: status.agent }, 'TRACE_SIGNING_REQUIRED=true but trace signing key is not ACTIVE');
    throw new AppError(503, 'TRACE_SIGNING_KEY_NOT_ACTIVE', `Trace signing key status is ${status.ours}; register it before booting`);
  }
}
