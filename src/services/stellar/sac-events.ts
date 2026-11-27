/**
 * Decodes Stellar Asset Contract (SEP-41) `transfer` events out of a
 * transaction's meta (#51).
 *
 * Payment verification must derive value movement from what the token
 * contract actually did, not from what the envelope asked for. The SAC emits
 * a `transfer` event for every executed transfer; it is recorded in the
 * transaction meta. This module turns those events into a flat list of
 * {@link SacTransfer}s, supporting both the legacy layout (topics
 * `[transfer, from, to, asset]`, `i128` data) and the CAP-67 unified layout
 * (map data with `amount` and `to_muxed_id`), and both `TransactionMeta` v3
 * and v4 as well as the RPC `events.contractEventsXdr` field.
 */
import { Address, scValToNative, xdr } from '@stellar/stellar-sdk';
import { AppError } from '../../lib/app-error';
import { extractContractEvents, type ExtractedEvent, type TxEventsInput } from './tx-events';

export interface SacTransfer {
  /** C… contract that emitted the event. */
  contractId: string;
  /** Base G…/C… address the value moved from. */
  from: string;
  /** Base G…/C… address the value moved to. */
  to: string;
  amount: bigint;
  /** Muxed id of the recipient when present (CAP-67), else null. */
  toMuxedId: string | null;
  /** Operation index the event came from, when known. */
  opIndex: number | null;
  /** Asset string topic (`CODE:ISSUER`) when the event carried one. */
  asset: string | null;
}

export type SacMetaInput = TxEventsInput;

/** Decodes one contract event into a transfer, or null when it is not one. */
export function decodeSacTransferEvent(event: ExtractedEvent): SacTransfer | null {
  try {
    const { topics, data } = event;
    if (!topics || topics.length < 3 || !data) return null;

    let name: unknown;
    try {
      name = scValToNative(topics[0]);
    } catch {
      return null;
    }
    if (name !== 'transfer') return null;

    let from: string;
    let to: string;
    try {
      from = Address.fromScVal(topics[1]).toString();
      to = Address.fromScVal(topics[2]).toString();
    } catch {
      return null;
    }

    let asset: string | null = null;
    if (topics.length >= 4) {
      try {
        const a = scValToNative(topics[3]);
        asset = typeof a === 'string' ? a : null;
      } catch {
        asset = null;
      }
    }

    const decoded = decodeAmount(data);
    if (decoded === null) return null;

    return {
      contractId: event.contractId,
      from,
      to,
      amount: decoded.amount,
      toMuxedId: decoded.toMuxedId,
      opIndex: event.opIndex,
      asset,
    };
  } catch {
    return null;
  }
}

/** Reads the amount (and optional muxed id) from legacy or CAP-67 event data. */
function decodeAmount(data: xdr.ScVal): { amount: bigint; toMuxedId: string | null } | null {
  let switchName: string | null = null;
  try {
    const sw = typeof (data as any).switch === 'function' ? (data as any).switch() : null;
    switchName = typeof sw === 'string' ? sw : (sw?.name ?? null);
  } catch {
    switchName = null;
  }

  if (switchName === 'scvMap') {
    const entries = typeof (data as any).map === 'function' ? (data as any).map() : null;
    if (!Array.isArray(entries)) return null;
    let amount: bigint | null = null;
    let toMuxedId: string | null = null;
    for (const entry of entries) {
      let key: unknown;
      const val = typeof entry.val === 'function' ? entry.val() : entry.val;
      try {
        key = scValToNative(entry.key());
      } catch {
        continue;
      }
      if (key === 'amount') {
        const n = scValToNative(val);
        if (typeof n === 'bigint') amount = n;
      } else if (key === 'to_muxed_id') {
        const id = scValToNative(val);
        toMuxedId = typeof id === 'bigint' ? id.toString() : String(id);
      }
    }
    return amount === null ? null : { amount, toMuxedId };
  }

  const native = scValToNative(data);
  if (typeof native === 'bigint') return { amount: native, toMuxedId: null };
  return null;
}

/**
 * Extracts SAC `transfer` events from a transaction response.
 */
export function sacTransfersFromMeta(input: SacMetaInput): SacTransfer[] {
  const extraction = extractContractEvents(input);
  if (extraction.skipped) throw new AppError(502, 'CHAIN_EVENT_UNDECODABLE', 'Stellar RPC returned an undecodable contract event', { skipped: extraction.skipped });
  return extraction.events.flatMap((event) => {
    const transfer = decodeSacTransferEvent(event);
    return transfer ? [transfer] : [];
  });
}
