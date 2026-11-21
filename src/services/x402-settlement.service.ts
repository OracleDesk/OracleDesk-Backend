export interface X402Receipt { paymentId: string; userId: string; wallet: string; traceId?: string; }
export interface X402PaymentEntry { state: 'settled' | 'delivered' | 'settling' | 'failed'; traceId: string; traceHash: string; payer: string; payTo: string; amountRaw: string; settlementTx: string; }
export interface X402SettlementDeps {
  fetchPayment(paymentId: string): Promise<X402PaymentEntry>;
  verifyTransfer(input: { txHash: string; from: string; to: string; minAmount: bigint }): Promise<void>;
  recordSettlement(input: { paymentId: string; userId: string; traceId: string; txHash: string; amountRaw: string }): Promise<{ subscriptionId: string }>;
}

export class X402SettlementService {
  constructor(private readonly deps: X402SettlementDeps) {}

  async ingest(receipt: X402Receipt): Promise<{ status: 'RECORDED' | 'PENDING'; subscriptionId?: string }> {
    if (!receipt.paymentId.trim() || !receipt.userId.trim() || !receipt.wallet.trim()) throw new Error('paymentId, userId and wallet are required');
    const payment = await this.deps.fetchPayment(receipt.paymentId);
    if (payment.state === 'settling') return { status: 'PENDING' };
    if (payment.state !== 'settled' && payment.state !== 'delivered') throw new Error('x402 payment is not settled');
    if (payment.payer !== receipt.wallet) throw new Error('x402 payer does not match the connected wallet');
    if (receipt.traceId && receipt.traceId !== payment.traceId) throw new Error('x402 trace does not match the receipt');
    await this.deps.verifyTransfer({ txHash: payment.settlementTx, from: payment.payer, to: payment.payTo, minAmount: BigInt(payment.amountRaw) });
    const recorded = await this.deps.recordSettlement({ paymentId: receipt.paymentId, userId: receipt.userId, traceId: payment.traceId, txHash: payment.settlementTx, amountRaw: payment.amountRaw });
    return { status: 'RECORDED', subscriptionId: recorded.subscriptionId };
  }
}
