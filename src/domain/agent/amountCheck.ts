// Live-run check (SPEC §4.4): every $ amount in the agent's text must come from stored-quote or rate data (any tool-result
// value outside untrusted_seller_text, including amounts inside strings such as "$1.53 each + 4.2% case …") or be the
// buyer-confirmed budget. An amount found only in seller text, or nowhere, fails.
const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

const cents = (whole: string, frac?: string) => Number(whole.replace(/,/g, '')) * 100 + Number((frac ?? '').padEnd(2, '0') || '0');

function amountsIn(text: string): { raw: string; cents: number }[] {
  return [...text.matchAll(AMOUNT)].map((m) => ({ raw: m[0], cents: cents(m[1]!, m[2]) }));
}

function collect(value: unknown, into: { trusted: Set<number>; seller: Set<number> }, inSeller = false): void {
  if (typeof value === 'string') {
    for (const a of amountsIn(value)) (inSeller ? into.seller : into.trusted).add(a.cents);
  } else if (Array.isArray(value)) {
    for (const v of value) collect(v, into, inSeller);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, into, inSeller || k === 'untrusted_seller_text');
  }
}

export type AmountSource = 'tool' | 'budget' | 'seller-only' | 'nowhere';

export function checkStatedAmounts(agentText: string, toolOutputs: unknown[], budgetMinor: number) {
  const sets = { trusted: new Set<number>(), seller: new Set<number>() };
  for (const o of toolOutputs) collect(o, sets);
  const seen = new Set<string>();
  const amounts: { amount: string; source: AmountSource }[] = [];
  for (const a of amountsIn(agentText)) {
    if (seen.has(a.raw)) continue;
    seen.add(a.raw);
    const source: AmountSource = sets.trusted.has(a.cents) ? 'tool' : a.cents === budgetMinor ? 'budget' : sets.seller.has(a.cents) ? 'seller-only' : 'nowhere';
    amounts.push({ amount: a.raw, source });
  }
  return { ok: amounts.every((a) => a.source === 'tool' || a.source === 'budget'), amounts };
}
