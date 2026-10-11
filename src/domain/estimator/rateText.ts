// Parser for the HTS General (column 1) rate text — estimator only; the verified rate path never uses it.
// Pure. Integers only: ad valorem in ppm, specific amounts in USD micros, scaled from the decimal string (no floats).
// Anything outside the grammar is refused with a reason, never approximated. Grammar: terms joined by "+", each
//   Free                                  (the whole text)
//   N%  [on the case | on the strap, band or bracelet | on (the) case and strap, band or bracelet | on the movement |
//        on the movement and case | on the battery | on the apparatus]
//   N¢ | $N   each | /kg | /t | /liter | /pr. | /doz. | /gross | /1000 | /thousand | /m2 | /m3 | /head | /bbl | /jewel | /article
import type { Mfn } from '@/domain/rates/schema';

/** Per-unit bases of a specific rate, as the official text names them. */
export type SpecificUnit = 'each' | 'pair' | 'dozen' | 'gross' | 'thousand' | 'head' | 'kg' | 't' | 'liter' | 'm2' | 'm3' | 'bbl' | 'jewel';
/** Value bases of an ad valorem term ("on the case", "on the strap, band or bracelet", …). */
export type ValueBase = 'full_value' | 'case' | 'band' | 'case_and_band' | 'movement' | 'movement_and_case' | 'battery' | 'apparatus';
/** What the buyer/seller must supply for a specific term. */
export type Measure = 'count' | 'pairs' | 'kg' | 'liter' | 'm2' | 'm3' | 'bbl' | 'jewels';

export type RateTerm =
  | { kind: 'ad_valorem'; rate_ppm: number; applies_to: ValueBase }
  | { kind: 'specific'; amount_usd_micros: number; per: SpecificUnit };

export type UnparseableReason = 'EMPTY' | 'REFERS_TO_OTHER_RATE' | 'SPECIAL_MEASURE' | 'SPECIAL_BASE' | 'CONDITIONAL' | 'PRECISION' | 'UNRECOGNISED';

export type ParsedRate =
  | {
      ok: true;
      text: string;
      type: 'free' | 'ad_valorem' | 'specific' | 'compound';
      terms: RateTerm[];
      measures: Measure[];
      splits: Exclude<ValueBase, 'full_value'>[];
    }
  | { ok: false; text: string; reason: UnparseableReason; detail: string };

// Checked in this order, before the grammar: each names why the text can't be computed from value and simple measures.
const REFUSALS: [UnparseableReason, RegExp, string][] = [
  ['REFERS_TO_OTHER_RATE', /^(the rate (of duty )?applicable|see additional u\.s\. note)/i, 'the rate is defined by another provision'],
  ['CONDITIONAL', /\bless\b|\bnot less than\b|\bover \d|\bbut if\b|\bfor each other piece\b/i, 'the rate depends on a threshold or condition'],
  ['SPECIAL_MEASURE', /drained weight|content|total sugars|clean kg|pf\.\s*liter|\/line\/|\bpins\b/i, 'needs a measure other than value, count, weight, volume or area'],
  ['SPECIAL_BASE', /on the value of|on the entire set/i, 'the rate applies to a value base we do not split'],
];

const VALUE_BASES: Record<string, ValueBase> = {
  'the case': 'case',
  'the strap, band or bracelet': 'band',
  'the case and strap, band or bracelet': 'case_and_band',
  'case and strap, band or bracelet': 'case_and_band', // the official text drops "the" on two lines (9101.19.40/.80)
  'the movement': 'movement',
  'the movement and case': 'movement_and_case',
  'the battery': 'battery',
  'the apparatus': 'apparatus',
};

const UNITS: Record<string, SpecificUnit> = {
  kg: 'kg',
  t: 't',
  liter: 'liter',
  'pr.': 'pair',
  'doz.': 'dozen',
  gross: 'gross',
  '1000': 'thousand',
  thousand: 'thousand',
  m2: 'm2',
  m3: 'm3',
  head: 'head',
  bbl: 'bbl',
  jewel: 'jewel',
  article: 'each',
};

const MEASURE_OF: Record<SpecificUnit, Measure> = {
  each: 'count',
  dozen: 'count',
  gross: 'count',
  thousand: 'count',
  head: 'count',
  pair: 'pairs',
  kg: 'kg',
  t: 'kg',
  liter: 'liter',
  m2: 'm2',
  m3: 'm3',
  bbl: 'bbl',
  jewel: 'jewels',
};

const AD_VALOREM = /^(\d+(?:\.\d+)?)%(?:\s+on\s+(.+))?$/;
const SPECIFIC = /^(\$)?(\d+(?:\.\d+)?)(¢)?(?:\s+each|\s*\/\s*(\S+))$/;

class Refusal extends Error {
  constructor(
    readonly reason: UnparseableReason,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** "12.5" with 4 decimals → 125000. More decimals than `decimals`, or beyond a safe integer → PRECISION. */
function scaled(num: string, decimals: number, what: string): number {
  const [int, frac = ''] = num.split('.');
  if (frac.length > decimals) throw new Refusal('PRECISION', `${what} ${num} has more than ${decimals} decimal places`);
  const n = BigInt(int!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Refusal('PRECISION', `${what} ${num} is too large`);
  return Number(n);
}

function parseTerm(raw: string): RateTerm {
  const av = AD_VALOREM.exec(raw);
  if (av) {
    const applies_to = av[2] === undefined ? 'full_value' : VALUE_BASES[av[2]];
    if (!applies_to) throw new Refusal('UNRECOGNISED', `unknown value base "${av[2]}"`);
    return { kind: 'ad_valorem', rate_ppm: scaled(av[1]!, 4, 'percent'), applies_to };
  }
  const sp = SPECIFIC.exec(raw);
  if (sp && Boolean(sp[1]) !== Boolean(sp[3])) {
    const per = sp[4] === undefined ? 'each' : UNITS[sp[4]];
    if (!per) throw new Refusal('UNRECOGNISED', `unknown unit "${sp[4]}"`);
    const amount_usd_micros = sp[1] ? scaled(sp[2]!, 6, 'dollar amount') : scaled(sp[2]!, 4, 'cent amount');
    return { kind: 'specific', amount_usd_micros, per };
  }
  throw new Refusal('UNRECOGNISED', `term "${raw}" is outside the rate grammar`);
}

const sortedUnique = <T extends string>(xs: T[]): T[] => [...new Set(xs)].sort();

export function parseRateText(text: string): ParsedRate {
  const t = text.trim();
  try {
    if (t === '') throw new Refusal('EMPTY', 'no General rate text');
    if (t === 'Free') return { ok: true, text, type: 'free', terms: [], measures: [], splits: [] };
    for (const [reason, re, detail] of REFUSALS) if (re.test(t)) throw new Refusal(reason, detail);
    const terms = t.split(/\s*\+\s*/).map((part) => {
      if (part === '') throw new Refusal('UNRECOGNISED', 'empty term around "+"');
      return parseTerm(part);
    });
    const specific = terms.filter((x) => x.kind === 'specific');
    const type =
      terms.length === 1 && terms[0]!.kind === 'ad_valorem' && terms[0]!.applies_to === 'full_value'
        ? 'ad_valorem'
        : specific.length === terms.length
          ? 'specific'
          : 'compound';
    return {
      ok: true,
      text,
      type,
      terms,
      measures: sortedUnique(specific.map((x) => MEASURE_OF[x.per])),
      splits: sortedUnique(terms.flatMap((x) => (x.kind === 'ad_valorem' && x.applies_to !== 'full_value' ? [x.applies_to] : []))),
    };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, text, reason: e.reason, detail: e.detail };
    throw e;
  }
}

/** The verified engine's MFN shape, or null when the rate is refused or uses a unit / value base that engine has no input for. */
export function toEngineMfn(p: ParsedRate): Mfn | null {
  if (!p.ok) return null;
  if (p.type === 'free') return { type: 'free' };
  if (p.type === 'ad_valorem') return { type: 'ad_valorem', rate_ppm: (p.terms[0] as RateTerm & { kind: 'ad_valorem' }).rate_ppm };
  const components: (Mfn & { type: 'compound' })['components'] = [];
  for (const x of p.terms) {
    if (x.kind === 'specific') {
      if (x.per !== 'each') return null;
      components.push({ kind: 'specific', amount_usd_micros: x.amount_usd_micros, per: 'each' });
    } else {
      if (x.applies_to !== 'full_value' && x.applies_to !== 'case' && x.applies_to !== 'band') return null;
      components.push({ kind: 'ad_valorem', rate_ppm: x.rate_ppm, applies_to: x.applies_to });
    }
  }
  return { type: p.type, text: p.text, components };
}
