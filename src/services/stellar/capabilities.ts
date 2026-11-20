/**
 * Capability layer (#237).
 *
 * The backend pins the contracts submodule at a specific commit; its
 * generated bindings describe every entrypoint it *could* call. Deployed
 * contracts may be older than those bindings (and will be during any
 * rolling upgrade): each one embeds its own `contractspecv0` spec that may
 * differ from the binding. Code that wants to call a new entrypoint must
 * ask here first — `supports()` returns true only if the deployed spec at
 * that contract id has that method with the same input/output signature as
 * the binding, so a legacy deployment never silently accepts an encoding
 * the contract will reject.
 *
 * This module is the stable surface the follow-up adoption issues
 * (`agent_buy_v2`, `agent_create_market_and_reveal`, `publish_trace_signed`
 * …) will call. It intentionally returns `false` everywhere until
 * `loadCapabilities()` has been called at boot — a safe default, so an
 * un-initialised runtime falls back to the legacy entrypoint.
 */

import type { BindingContract } from './spec-compat';

export type { BindingContract };
export type Capability = { contract: BindingContract; method: string };

export interface CapabilitySnapshot {
  contract: BindingContract;
  wasmHash: string;
  /** method name → typeKey signature (input names/types + outputs). */
  fns: Map<string, string>;
  events: Map<string, string>;
}

type CapabilityState = {
  loaded: boolean;
  snapshots: Map<BindingContract, CapabilitySnapshot>;
};

const state: CapabilityState = {
  loaded: false,
  snapshots: new Map(),
};

/**
 * Populate the capability table from the deployed specs. Call once, after
 * `runSpecCompatGate` so the gate's refusal still happens first. Safe to
 * call twice (second call is a reload).
 *
 * Implemented as a thin wrapper that will be replaced by a reader off
 * `spec-compat`'s `fetchDeployed` result in follow-up work; the shape here
 * is the stable one callers can already target.
 */
export async function loadCapabilities(
  _deps?: { fetch?: () => Promise<Iterable<CapabilitySnapshot>> },
): Promise<void> {
  const fetch = _deps?.fetch;
  state.snapshots = new Map();
  if (fetch) {
    for (const snapshot of await fetch()) {
      state.snapshots.set(snapshot.contract, snapshot);
    }
  }
  state.loaded = true;
}

/** Testing seam — reset to the pre-boot state. */
export function __resetCapabilitiesForTests(): void {
  state.loaded = false;
  state.snapshots = new Map();
}

/** Testing seam — install a known snapshot without calling the network. */
export function __installCapabilitySnapshotsForTests(
  snapshots: Iterable<CapabilitySnapshot>,
): void {
  state.snapshots = new Map();
  for (const snapshot of snapshots) {
    state.snapshots.set(snapshot.contract, snapshot);
  }
  state.loaded = true;
}

/**
 * True when the deployed contract at `contract` exposes `method` with the
 * same signature as the current binding. Returns `false` until
 * `loadCapabilities()` has been called, which is the safe default — an
 * un-initialised runtime behaves as if every optional capability were
 * missing and falls back to the legacy entrypoint.
 */
export function supports(contract: BindingContract, method: string): boolean {
  if (!state.loaded) return false;
  const snapshot = state.snapshots.get(contract);
  return Boolean(snapshot && snapshot.fns.has(method));
}

/** Same shape as {@link supports}, for events the indexer decodes. */
export function supportsEvent(contract: BindingContract, event: string): boolean {
  if (!state.loaded) return false;
  const snapshot = state.snapshots.get(contract);
  return Boolean(snapshot && snapshot.events.has(event));
}

/**
 * Throws `CAPABILITY_UNAVAILABLE` when `method` is not deployed. Use at the
 * call site of a new entrypoint whose caller has no sensible fallback.
 * Imported lazily to avoid a cycle with `middlewares/error.middleware`.
 */
export function requireCapability(contract: BindingContract, method: string): void {
  if (supports(contract, method)) return;
  // Lazy import so this module stays safe to import anywhere.
  const { AppError } = require('../../middlewares/error.middleware') as typeof import('../../middlewares/error.middleware');
  throw new AppError(501, 'CAPABILITY_UNAVAILABLE', `Deployed contract '${contract}' does not expose '${method}'`, {
    contract,
    method,
  });
}
