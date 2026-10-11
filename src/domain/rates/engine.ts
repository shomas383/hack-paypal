// Deterministic duty engine (invariants 2, 3, 5). Pure: no I/O, no LLM, no rate literals — every number comes from the
// rate table. Anything not covered by a verified row returns UNSUPPORTED; the engine never guesses or interpolates.
// Math: each duty line is an exact integer in (cents × ppm) units, rounded half up to the cent once per line.
// Rules: docs/SPEC.md §4.2 and docs/HTS_VERIFICATION_SPEC.md.
import { PPM, roundHalfUpDiv } from '../money/math';
import { usd, type Money } from '../money/money';
import type { Additional, RateFile, RateRow } from './schema';

export interface QuoteInput {
  /** ISO 3166 alpha-2 country of origin (from the label). */
  origin: string;
  hts10: string;
  /** YYYY-MM-DD */
  entryDate: string;
  /** Transaction value of the goods only — itemized international shipping excluded. USD. */
  customsValue: Money;
  quantity: number;
  /** Needed when the row's compound rate has case/band components (watches). Must add up to customsValue. */
  valueSplit?: { case: Money; band: Money };
  /** Listing facts that a row's conditions depend on (e.g. steel ≥15% of weight). */
  facts?: Record<string, boolean>;
}

export interface DutyLine {
  kind: 'MFN' | string;
  chapter99?: string;
  amount: Money;
  basis: string;
  sourceRef: string;
}

export type QuoteResult =
  | {
      kind: 'OK';
      rowId: string;
      lines: DutyLine[];
      totalDuty: Money;
      /** totalDuty ÷ customsValue in ppm, rounded half up. */
      effectiveRatePpm: number;
      /** Ad valorem equivalent of a specific/compound MFN rate at this price, in ppm. */
      avePpm?: number;
      rateVersion: string;
    }
  | { kind: 'UNSUPPORTED'; reason: string };

const unsupported = (reason: string): QuoteResult => ({ kind: 'UNSUPPORTED', reason });
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const pct = (ppm: number): string => `${ppm / 10_000}%`;

/** The rate-row fields the duty math reads. A verified RateRow is one; the estimator builds others (never charged). */
export type EngineRow = Pick<RateRow, 'id' | 'hts10' | 'mfn' | 'additional' | 'source_refs'>;

function checkInput(input: QuoteInput): QuoteResult | null {
  const value = input.customsValue;
  if (value.currency !== 'USD') return unsupported(`customs value must be USD, got ${value.currency}`);
  if (value.amountMinor <= 0n) return unsupported('customs value must be positive');
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) return unsupported(`quantity must be a whole number ≥ 1, got ${input.quantity}`);
  return null;
}

export function quoteDuty(table: RateFile, input: QuoteInput): QuoteResult {
  const bad = checkInput(input);
  if (bad) return bad;
  if (!ISO_DATE.test(input.entryDate)) return unsupported(`entry date must be YYYY-MM-DD, got "${input.entryDate}"`);

  const row = table.rows.find((r) => r.origin === input.origin && r.hts10 === input.hts10);
  if (!row) return unsupported(`no verified rate row for ${input.origin} ${input.hts10} in ${table.version}`);
  if (input.entryDate < row.effective_from || (row.effective_to !== null && input.entryDate >= row.effective_to)) {
    return unsupported(`${row.id} is effective ${row.effective_from}–${row.effective_to ?? 'open'}; entry date ${input.entryDate} is outside it`);
  }
  return computeRow(row, table.version, input);
}

/** The duty math for one row (no lookup, no effective-date check): conditions, MFN, additional lines, totals. */
export function computeRow(row: EngineRow, version: string, input: QuoteInput): QuoteResult {
  const bad = checkInput(input);
  if (bad) return bad;
  const value = input.customsValue;

  for (const a of row.additional) {
    for (const c of a.conditions) {
      const got = input.facts?.[c.fact];
      if (got === undefined) return unsupported(`${row.id} needs the listing fact "${c.fact}" (${c.ref})`);
      if (got !== c.required_value) return unsupported(`${row.id} is verified only for ${c.fact} = ${c.required_value} (${c.ref})`);
    }
  }

  const mfn = mfnNumerator(row, input);
  if (typeof mfn === 'string') return unsupported(mfn);
  const V = value.amountMinor;
  const mfnCents = roundHalfUpDiv(mfn, PPM);
  const htsRef = row.source_refs.find((s) => s.kind === 'hts_line')?.ref ?? row.hts10;

  const lines: DutyLine[] = [{ kind: 'MFN', amount: usd(mfnCents), basis: describeMfn(row), sourceRef: htsRef }];
  for (const a of row.additional) lines.push(additionalLine(a, V, mfn, mfnCents));

  const total = lines.reduce((sum, l) => sum + l.amount.amountMinor, 0n);
  const compound = row.mfn.type === 'specific' || row.mfn.type === 'compound';
  return {
    kind: 'OK',
    rowId: row.id,
    lines,
    totalDuty: usd(total),
    effectiveRatePpm: Number(roundHalfUpDiv(total * PPM, V)),
    ...(compound ? { avePpm: Number(roundHalfUpDiv(mfn, V)) } : {}),
    rateVersion: version,
  };
}

/** MFN duty as an exact integer in (cents × ppm) units, or an UNSUPPORTED reason. */
function mfnNumerator(row: EngineRow, input: QuoteInput): bigint | string {
  const V = input.customsValue.amountMinor;
  const m = row.mfn;
  if (m.type === 'free') return 0n;
  if (m.type === 'ad_valorem') return V * BigInt(m.rate_ppm);

  let n = 0n;
  for (const c of m.components) {
    if (c.kind === 'specific') {
      // micros → cents is ÷10_000; × PPM (10^6) → ×100.
      n += BigInt(c.amount_usd_micros) * BigInt(input.quantity) * 100n;
      continue;
    }
    let base = V;
    if (c.applies_to !== 'full_value') {
      const split = input.valueSplit;
      if (!split) return `${row.id} has a compound rate (${m.text}) — needs the case/band value split`;
      if (split.case.currency !== 'USD' || split.band.currency !== 'USD') return 'value split must be USD';
      if (split.case.amountMinor + split.band.amountMinor !== V) return 'case + band value split must equal the customs value';
      base = c.applies_to === 'case' ? split.case.amountMinor : split.band.amountMinor;
    }
    n += base * BigInt(c.rate_ppm);
  }
  return n;
}

function additionalLine(a: Additional, V: bigint, mfn: bigint, mfnCents: bigint): DutyLine {
  const ref = (heading: string): string => `${heading} — ${a.ref}`;
  if (a.rule === 'combined_cap') {
    const capNumerator = V * BigInt(a.rate_ppm);
    if (mfn < capNumerator) {
      // Base (or AVE) below the cap: top up so the total is exactly round(cap × value).
      return {
        kind: a.program,
        chapter99: a.chapter99,
        amount: usd(roundHalfUpDiv(capNumerator, PPM) - mfnCents),
        basis: `combined cap ${pct(a.rate_ppm)} (base or AVE below cap)`,
        sourceRef: ref(a.chapter99),
      };
    }
    const heading = a.chapter99_at_or_above_cap ?? a.chapter99;
    return { kind: a.program, chapter99: heading, amount: usd(0), basis: `base ≥ ${pct(a.rate_ppm)} cap — no add-on`, sourceRef: ref(heading) };
  }
  if (a.rule === 'additive') {
    return {
      kind: a.program,
      chapter99: a.chapter99,
      amount: usd(roundHalfUpDiv(V * BigInt(a.rate_ppm), PPM)),
      basis: `+${pct(a.rate_ppm)} of full customs value`,
      sourceRef: ref(a.chapter99),
    };
  }
  return { kind: a.program, chapter99: a.chapter99, amount: usd(0), basis: 'exempt — no add-on', sourceRef: ref(a.chapter99) };
}

function describeMfn(row: EngineRow): string {
  const m = row.mfn;
  if (m.type === 'free') return 'Free';
  if (m.type === 'ad_valorem') return `${pct(m.rate_ppm)} of customs value`;
  return m.text;
}
