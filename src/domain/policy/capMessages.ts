// Spend-cap refusal messages with the numbers, computed in code (shared by approveQuote and the agent's propose_purchase).
// The session cap counts CAPTURED orders in this session (sessionCapturedMinor; the same number decideCapture uses).
import { formatDisplay } from '../money/format';
import { usd } from '../money/money';

const m = (minor: bigint) => formatDisplay(usd(minor));

export function orderCapMessage(i: { orderMinor: bigint; capMinor: bigint }): string {
  return `This order: ${m(i.orderMinor)}; per-order cap: ${m(i.capMinor)}.`;
}

export function sessionCapMessage(i: { alreadyMinor: bigint; capMinor: bigint; orderMinor: bigint }): string {
  return `Already captured this session: ${m(i.alreadyMinor)} of the ${m(i.capMinor)} session cap. This order (${m(i.orderMinor)}) would exceed it.`;
}
