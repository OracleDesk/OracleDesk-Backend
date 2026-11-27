import { Address, StrKey, xdr } from '@stellar/stellar-sdk';
import { AppError } from '../../lib/app-error';

export interface ExtractedEvent {
  opIndex: number;
  contractId: string;
  topics: xdr.ScVal[];
  data: xdr.ScVal;
  source: 'meta-v3' | 'meta-v4' | 'rpc-field';
}

export interface Extraction {
  events: ExtractedEvent[];
  metaVersion: number | null;
  sources: Array<'meta' | 'rpc-field'>;
  skipped: number;
}

export interface TxEventsInput {
  resultMetaXdr?: xdr.TransactionMeta | string | null;
  contractEventsXdr?: (xdr.ContractEvent | string)[][] | null;
}

export function contractIdOf(event: xdr.ContractEvent): string | null {
  const id: unknown = event.contractId();
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (Buffer.isBuffer(id) || id instanceof Uint8Array) return StrKey.encodeContract(Buffer.from(id));
  return Address.fromScAddress(id as xdr.ScAddress).toString();
}

function parseEvent(raw: xdr.ContractEvent | string, opIndex: number, source: ExtractedEvent['source']): ExtractedEvent | null | undefined {
  const event = typeof raw === 'string' ? xdr.ContractEvent.fromXDR(raw, 'base64') : raw;
  if (event.type().name !== 'contract') return undefined;
  const contractId = contractIdOf(event);
  if (!contractId) return null;
  const body = event.body().v0();
  return { opIndex, contractId, topics: body.topics(), data: body.data(), source };
}

function readEvents(groups: (xdr.ContractEvent | string)[][], source: ExtractedEvent['source']): { events: ExtractedEvent[]; skipped: number } {
  const events: ExtractedEvent[] = [];
  let skipped = 0;
  groups.forEach((group, opIndex) => {
    for (const raw of group) {
      try {
        const event = parseEvent(raw, opIndex, source);
        if (event) events.push(event);
        else if (event === null) skipped++;
      } catch {
        skipped++;
      }
    }
  });
  return { events, skipped };
}

function fingerprint(event: ExtractedEvent): string {
  return [event.opIndex, event.contractId, ...event.topics.map((topic) => topic.toXDR('base64')), event.data.toXDR('base64')].join('|');
}

export function extractContractEvents(input: TxEventsInput): Extraction {
  const sources: Extraction['sources'] = [];
  let metaVersion: number | null = null;
  let metaEvents: ExtractedEvent[] = [];
  let skipped = 0;

  if (input.resultMetaXdr != null) {
    const meta = typeof input.resultMetaXdr === 'string'
      ? xdr.TransactionMeta.fromXDR(input.resultMetaXdr, 'base64')
      : input.resultMetaXdr;
    metaVersion = meta.switch();
    sources.push('meta');
    if (metaVersion === 3) {
      const raw = meta.v3().sorobanMeta()?.events() ?? [];
      const result = readEvents([raw], 'meta-v3');
      metaEvents = result.events;
      skipped += result.skipped;
    } else if (metaVersion === 4) {
      const result = readEvents(meta.v4().operations().map((operation) => operation.events()), 'meta-v4');
      metaEvents = result.events;
      skipped += result.skipped;
    } else if (metaVersion < 0 || metaVersion > 2) {
      throw new AppError(502, 'CHAIN_META_UNSUPPORTED', 'Unsupported Stellar transaction meta version', { version: metaVersion });
    }
  }

  let fieldEvents: ExtractedEvent[] = [];
  if (input.contractEventsXdr != null) {
    const result = readEvents(input.contractEventsXdr, 'rpc-field');
    fieldEvents = result.events;
    skipped += result.skipped;
    sources.push('rpc-field');
  }

  if (sources.length === 2) {
    const left = metaEvents.map(fingerprint);
    const right = fieldEvents.map(fingerprint);
    if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
      throw new AppError(502, 'CHAIN_READ_INCONSISTENT', 'Stellar RPC event sources disagree', {
        metaEvents: left.length, rpcEvents: right.length,
      });
    }
  }
  return { events: sources.includes('rpc-field') ? fieldEvents : metaEvents, metaVersion, sources, skipped };
}
