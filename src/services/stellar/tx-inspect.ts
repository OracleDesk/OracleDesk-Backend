import { rpc, xdr } from '@stellar/stellar-sdk';
import { AppError } from '../../lib/app-error';
import { readClients } from './clients';
import { CONTRACTS } from '../../config/contracts';
import { extractContractEvents } from './tx-events';

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
  name: string | null;
  data: Record<string, any>;
  opIndex: number;
}

/**
 * Extracts and decodes Soroban events from a transaction response's
 * `events.contractEventsXdr` or `resultMetaXdr` (supporting TransactionMeta v3
 * and v4 per-operation events). Filters by `contractIdFilter` when provided.
 */
export function readContractEvents(response: rpc.Api.GetTransactionResponse): ContractEventParsed[] {
  const input = response as any;
  const extraction = extractContractEvents({
    resultMetaXdr: input.resultMetaXdr,
    contractEventsXdr: input.events?.contractEventsXdr,
  });
  if (extraction.skipped) throw new AppError(502, 'CHAIN_EVENT_UNDECODABLE', 'Stellar RPC returned an undecodable contract event', { skipped: extraction.skipped });

  const specs = new Map([
    [CONTRACTS.marketCore, readClients.marketCore().spec],
    [CONTRACTS.treasury, readClients.treasury().spec],
    [CONTRACTS.resolver, readClients.resolver().spec],
    [CONTRACTS.reasoningRegistry, readClients.reasoningRegistry().spec],
  ]);
  return extraction.events.map((event) => {
    const spec = specs.get(event.contractId);
    if (!spec) return { contractId: event.contractId, name: null, data: {}, opIndex: event.opIndex };
    try {
      const parsed = spec.parseEvent(event.topics, event.data);
      if (!parsed) throw new Error('No matching event in contract spec');
      return { contractId: event.contractId, name: parsed.name, data: parsed.data, opIndex: event.opIndex };
    } catch {
      throw new AppError(502, 'CHAIN_EVENT_UNDECODABLE', 'Contract event does not match its deployed spec', { contractId: event.contractId });
    }
  });
}
