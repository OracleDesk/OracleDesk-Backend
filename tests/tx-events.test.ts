import assert from 'node:assert/strict';
import test from 'node:test';
import { Address, Keypair, StrKey, xdr } from '@stellar/stellar-sdk';

import { AppError } from '../src/lib/app-error';
import { contractIdOf, extractContractEvents } from '../src/services/stellar/tx-events';
import { contractEventsField, metaV3, metaV4, transferEvent } from './helpers/sac-meta';

const contract = StrKey.encodeContract(Buffer.alloc(32, 7));
const otherContract = StrKey.encodeContract(Buffer.alloc(32, 8));
const from = Address.fromString(Keypair.random().publicKey());
const to = Address.fromString(Keypair.random().publicKey());

function event(eventContract = contract) {
  return transferEvent({ contract, eventContract, from: from.toString(), to: to.toString(), amount: 10n });
}

test('decodes raw contract hashes and normalizes v3, v4 and RPC event fields', () => {
  const raw = event();
  assert.equal(contractIdOf(raw), contract);

  const v3 = extractContractEvents({ resultMetaXdr: metaV3([raw]) });
  const v4 = extractContractEvents({ resultMetaXdr: metaV4([[raw]]) });
  const field = extractContractEvents({ contractEventsXdr: contractEventsField([[raw]]) });
  for (const result of [v3, v4, field]) {
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].contractId, contract);
    assert.equal(result.events[0].opIndex, 0);
  }
});

test('cross-checks duplicate RPC sources and rejects disagreement', () => {
  const raw = event();
  assert.equal(
    extractContractEvents({ resultMetaXdr: metaV4([[raw]]), contractEventsXdr: [[raw]] }).events.length,
    1,
  );
  assert.throws(
    () => extractContractEvents({ resultMetaXdr: metaV4([[raw]]), contractEventsXdr: [[event(otherContract)]] }),
    (error: unknown) => error instanceof AppError && error.code === 'CHAIN_READ_INCONSISTENT',
  );
});

test('excludes diagnostic and transaction-level events', () => {
  const diagnostic = transferEvent({
    contract,
    from: from.toString(),
    to: to.toString(),
    amount: 10n,
    type: 'diagnostic',
  });
  assert.deepEqual(extractContractEvents({ resultMetaXdr: metaV4([[diagnostic]]) }).events, []);
});

test('accepts meta versions without Soroban events', () => {
  const meta = new xdr.TransactionMeta(0, []);
  assert.deepEqual(extractContractEvents({ resultMetaXdr: meta }).events, []);
});
