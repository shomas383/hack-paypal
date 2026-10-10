// Seller-entered amounts (price, shipping) → integer USD minor units, exactly (string digits, no floats). The model never
// sees or sets these (invariant 5).
const MAX_MINOR = 100_000_000; // $1,000,000

export function parseUsdInput(input: string, opts: { allowZero?: boolean } = {}): number | null {
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const minor = Number(m[1]!.replace(/,/g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (minor > MAX_MINOR) return null;
  if (minor === 0) return opts.allowZero ? 0 : null;
  return minor;
}
