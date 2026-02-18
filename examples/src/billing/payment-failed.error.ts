import type { ZipbulValue } from '@zipbul/common';

export class PaymentFailedError extends Error {
  public readonly amount: number;
  public readonly reason: string;

  constructor(...args: ReadonlyArray<ZipbulValue>) {
    const amountCandidate = args[0];
    const reasonCandidate = args[1];
    const isAmount = typeof amountCandidate === 'number';
    const resolvedAmount = isAmount ? amountCandidate : 0;
    const resolvedReason = isAmount && typeof reasonCandidate === 'string' ? reasonCandidate : 'Unknown reason';
    const resolvedMessage = isAmount
      ? `Payment of $${resolvedAmount} failed: ${resolvedReason}`
      : typeof amountCandidate === 'string'
        ? amountCandidate
        : 'Payment failed';

    super(resolvedMessage);

    this.name = 'PaymentFailedError';
    this.amount = resolvedAmount;
    this.reason = resolvedReason;
  }
}
