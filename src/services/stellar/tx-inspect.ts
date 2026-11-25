import { Address, rpc, StrKey, xdr } from '@stellar/stellar-sdk';
import { AppError } from '../../middlewares/error.middleware';
import { readClients } from './clients';
import { CONTRACTS } from '../../config/contracts';

/**
 * Unwraps fee-bump envelopes to get the inner Transaction.
 */
export function innerTransaction(envelope: xdr.TransactionEnvelope): xdr.Transaction {
  switch (envelope.switch().name) {
    case 'envelopeTypeTx':
      return envelope.v1().tx();
    case 'envelopeTypeTxFeeBump':
      return envelope.feeBump().tx().innerTx().v1().tx();
    default:
      throw new AppError(400, 'PAYMENT_WRONG_TOKEN', 'Unsupported transaction envelope');
  }
}

export interface TransactionReader {
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
}

let sharedReader: TransactionReader | null = null;

export function getTransactionReader(): TransactionReader {
  if (sharedReader) return sharedReader;
  const { rpcServer } = require('./clients');
  return rpcServer;
}

export function setTransactionReader(next: TransactionReader): TransactionReader {
  const prev = getTransactionReader();
  sharedReader = next;
  return prev;
}

export interface TransactionSender {
  sendTransaction(tx: any): Promise<any>;
}

let sharedSender: TransactionSender | null = null;

export function getTransactionSender(): TransactionSender {
  if (sharedSender) return sharedSender;
  const { rpcServer } = require('./clients');
  return rpcServer;
}

export function setTransactionSender(next: TransactionSender): TransactionSender {
  const prev = getTransactionSender();
  sharedSender = next;
  return prev;
}

export interface ContractEventParsed {
  contractId: string;
  name: string;
  data: Record<string, any>;
  rawEvent?: any;
}

/**
 * Extracts and decodes Soroban events from a transaction response's
 * `events.contractEventsXdr` or `resultMetaXdr` (supporting TransactionMeta v3
 * and v4 per-operation events). Filters by `contractIdFilter` when provided.
 */
export function readContractEvents(
  response: rpc.Api.GetTransactionResponse,
  contractIdFilter?: string,
): ContractEventParsed[] {
  const results: ContractEventParsed[] = [];
  const rawEvents: any[] = [];

  // Prefer RPC >= 23 per-operation contractEventsXdr when present and non-empty
  const rpcContractEvents = (response as any)?.events?.contractEventsXdr;
  if (Array.isArray(rpcContractEvents) && rpcContractEvents.some((ops: any) => Array.isArray(ops) && ops.length > 0)) {
    for (const ops of rpcContractEvents) {
      if (!Array.isArray(ops)) continue;
      for (const ev of ops) {
        if (typeof ev === 'string') {
          try {
            rawEvents.push(xdr.ContractEvent.fromXDR(ev, 'base64'));
          } catch {}
        } else if (ev) {
          rawEvents.push(ev);
        }
      }
    }
  }

  if (rawEvents.length === 0) {
    let meta = (response as any).resultMetaXdr as any;
    if (!meta) return results;

    if (typeof meta === 'string') {
      try {
        meta = xdr.TransactionMeta.fromXDR(meta, 'base64');
      } catch {
        return results;
      }
    }

    if (Array.isArray(meta.events)) {
      rawEvents.push(...meta.events);
    } else {
      let switchVal: number | null = null;
      try {
        switchVal = typeof meta.switch === 'function' ? meta.switch() : null;
      } catch {
        switchVal = null;
      }

      if (switchVal === 3 || (switchVal === null && typeof meta.v3 === 'function')) {
        try {
          const sm = meta.v3().sorobanMeta?.();
          const evs = sm && typeof sm.events === 'function' ? sm.events() : [];
          if (Array.isArray(evs)) rawEvents.push(...evs);
        } catch {}
      }

      if (rawEvents.length === 0 && (switchVal === 4 || (switchVal === null && typeof meta.v4 === 'function'))) {
        try {
          const v4 = meta.v4();
          const operations = typeof v4?.operations === 'function' ? (v4.operations() ?? []) : [];
          for (const op of operations) {
            const evs = op && typeof op.events === 'function' ? op.events() : [];
            if (Array.isArray(evs)) rawEvents.push(...evs);
          }
          if (rawEvents.length === 0) {
            const sm = v4?.sorobanMeta?.();
            const evs = sm && typeof sm.events === 'function' ? sm.events() : [];
            if (Array.isArray(evs)) rawEvents.push(...evs);
          }
        } catch {}
      }
    }
  }

  const marketCoreSpec = readClients.marketCore().spec;

  for (const ev of rawEvents) {
    try {
      let contractId = '';
      if (ev.contractId) {
        if (typeof ev.contractId === 'string') {
          contractId = ev.contractId;
        } else if (typeof ev.contractId.contractId === 'function') {
          const cid = ev.contractId.contractId();
          contractId = typeof cid === 'string' ? cid : StrKey.encodeContract(cid);
        } else if (typeof ev.contractId === 'function') {
          const scAddr = ev.contractId();
          if (scAddr) {
            contractId = Address.fromScAddress(scAddr).toString();
          }
        } else if (Buffer.isBuffer(ev.contractId)) {
          contractId = StrKey.encodeContract(ev.contractId);
        }
      }

      if (contractIdFilter && contractId && contractId !== contractIdFilter) {
        continue;
      }
      if (contractId && contractId !== CONTRACTS.marketCore) {
        continue;
      }

      let topics: xdr.ScVal[] = [];
      let data: xdr.ScVal | undefined;

      if (ev.body && typeof ev.body.v0 === 'function') {
        const v0 = ev.body.v0();
        topics = v0.topics?.() ?? [];
        data = v0.data?.();
      } else if (ev.body && ev.body.topics) {
        topics = ev.body.topics;
        data = ev.body.data;
      } else if (ev.topic) {
        topics = Array.isArray(ev.topic)
          ? ev.topic.map((t: any) => (typeof t === 'string' ? xdr.ScVal.fromXDR(t, 'base64') : t))
          : [];
        data = typeof ev.value === 'string' ? xdr.ScVal.fromXDR(ev.value, 'base64') : ev.value;
      }

      if (topics.length > 0 && data) {
        const parsed = marketCoreSpec.parseEvent(topics, data);
        if (parsed) {
          results.push({
            contractId: contractId || CONTRACTS.marketCore,
            name: parsed.name,
            data: parsed.data,
            rawEvent: ev,
          });
        }
      }
    } catch {}
  }

  return results;
}
