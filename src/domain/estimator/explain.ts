// Plain-language text for estimate results (the /estimate page). Text only: no amount is computed here.
import type { CantReason } from './estimate';

/** "note III 16(c)(vii)" → "U.S. note 16(c)(vii) to subchapter III"; "heading 9903.41.10"; "footnote …" → its heading. */
export function refText(ref: string): string {
  const note = /^note (\S+) (.+)$/.exec(ref);
  if (note) return note[1] === 'chapter' ? `U.S. note ${note[2]} to chapter 99` : `U.S. note ${note[2]} to subchapter ${note[1]}`;
  const foot = /^footnote (.+)$/.exec(ref);
  if (foot) return `the line's own footnote to heading ${foot[1]}`;
  return ref;
}

const MEASURE: Record<string, string> = {
  kg: 'weight (kilograms)',
  liter: 'volume (liters)',
  pairs: 'the number of pairs',
  count: 'the number of items',
  m2: 'area (square meters)',
  m3: 'volume (cubic meters)',
  bbl: 'barrels',
  jewels: 'the number of jewels',
  battery: 'the battery value',
  movement: 'the movement value',
  movement_and_case: 'the movement and case values',
  case_and_band: 'the case and band values',
  apparatus: 'the apparatus value',
};

/** Why a line can't be estimated, in one or two plain sentences. */
export function cantText(reason: CantReason, detail: string, refs: string[]): string {
  switch (reason) {
    case 'SPECIAL_PROVISION':
      return 'This is a Chapter 98 or 99 special provision. Its duty depends on how the goods are entered, so it can’t be estimated.';
    case 'ORIGIN_UNSUPPORTED':
      return 'Estimates are available for goods made in Japan or Germany for now.';
    case 'BLOCKED_BY_GATE':
      return 'The part of the estimator that covers this line failed its checks against the official text, so it is switched off until it is fixed.';
    case 'UNKNOWN_CODE':
      return 'This code is not a line in the current HTS revision.';
    case 'NO_RATE':
      return 'The official schedule shows no General rate for this line.';
    case 'UNPARSEABLE':
      return 'The official General rate for this line can’t be computed from the price alone: it refers to another provision, or depends on a measure such as drained weight or sugar content.';
    case 'NEEDS_MEASURES': {
      const needs = /needs (.+)$/.exec(detail)?.[1]?.split(', ').map((m) => MEASURE[m] ?? m) ?? [];
      return `The official rate depends on ${needs.join(' and ') || 'a measure other than price'}. Estimates by weight, volume or count aren’t supported yet.`;
    }
    case 'NEEDS_SPLIT':
      return 'The official rate is charged separately on the watch case and on the strap, band or bracelet. Enter both values to estimate it.';
    case 'UNMODELED_REGIME': {
      // A heading also cited by the line's own footnote is named once (as the footnote).
      const noted = new Set(refs.flatMap((r) => (/^footnote (.+)$/.exec(r)?.[1] ? [r.slice('footnote '.length)] : [])));
      const named = [...new Set(refs.filter((r) => !noted.has(r.replace(/^heading /, '')) || r.startsWith('footnote ')).map(refText))].join(', ');
      const who = named ? `${named.charAt(0).toUpperCase()}${named.slice(1)}` : 'Another Chapter 99 provision';
      return `${who} names this line, and the estimator doesn’t model it yet. Often these are Section 232 duties on steel, aluminum or copper goods, or measures for particular products or countries.`;
    }
    case 'PARTIAL_LIST':
      return 'Only some statistical numbers under this line are listed in an exemption, so the 10-digit code decides the duty.';
  }
}

/**
 * Where candidates part: for each candidate, the first level of its official chain that differs from the others (verbatim,
 * trailing ":" removed). Null when there is one candidate or the chains don't differ.
 */
export function separatingLevels(chains: string[][]): string[] | null {
  if (chains.length < 2) return null;
  const len = Math.max(...chains.map((c) => c.length));
  for (let i = 0; i < len; i++) {
    const at = chains.map((c) => c[i]?.trim().replace(/:$/, '') ?? '');
    if (new Set(at).size > 1) return at;
  }
  return null;
}

/** The disclosures every estimate carries beyond the estimator's own (what it never includes). */
export const NOT_INCLUDED =
  'Not included: Section 232 and other Chapter 99 duties the estimator doesn’t model (lines they name are refused, not estimated), antidumping and countervailing duties, the merchandise and harbor maintenance fees, and carrier brokerage or other fees.';

/** Whose combined rate a note 52 cap is, by origin (DE is covered as an EU member, note 52(k)). */
const RATE_OF: Record<string, string> = { JP: 'Japan’s', DE: 'the EU’s' };
const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/**
 * The rate engine's basis text in plain words for the duty table ("combined cap 12.5% (base or AVE below cap)" →
 * "Japan's 12.5% combined rate applies (heading 9903.05.49)"). Every number comes from the engine's text; an unrecognised
 * basis is returned as written. The exact text stays on the page in the official-text section.
 */
export function plainBasis(line: { label: string; chapter99?: string | undefined; basis: string }, origin: string): string {
  const b = line.basis;
  const h = line.chapter99;
  const whose = RATE_OF[origin] ?? 'the';
  if (!h) {
    if (b === 'Free') return 'General rate: free';
    const adv = /^(\d+(?:\.\d+)?%) of customs value$/.exec(b);
    return `General rate: ${adv ? `${adv[1]} of the price` : b}`;
  }
  const below = /^combined cap (\d+(?:\.\d+)?%) \(base or AVE below cap\)$/.exec(b);
  if (below) return `${cap(whose)} ${below[1]} combined rate applies (heading ${h})`;
  const above = /^base ≥ (\d+(?:\.\d+)?%) cap — no add-on$/.exec(b);
  if (above) return `The General rate is already at least ${whose} ${above[1]} combined rate, so heading ${h} adds nothing`;
  const add = /^\+(\d+(?:\.\d+)?%) of full customs value$/.exec(b);
  if (add) return `Heading ${h} adds ${add[1]} of the price`;
  if (b === 'exempt — no add-on') return `Heading ${h} applies: no additional duty`;
  return b;
}

const orList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);
/** A fact name mid-sentence: "Fiber content" → "fiber content"; an acronym ("UV filter") is kept. */
const fact = (n: string) => (/^[A-Z][a-z]/.test(n) ? `${n.charAt(0).toLowerCase()}${n.slice(1)}` : n);
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Routing reasons that mean "not certain which line" (review.ts); the rest are shown by the result itself. */
const UNCERTAIN = new Set(['LOW_CONFIDENCE', 'TOP2_DIFFER_6', 'MISSING_ATTRIBUTES', 'MODEL_FLAGGED', 'INVALID_CODE', 'UNVERIFIED_EVIDENCE', 'TOO_BROAD']);

/** The classifier's routing reasons as one plain sentence (never the codes), or null when it was certain. */
export function reasonText(reasons: string[], separating: { name: string; value_from_listing: string | null }[]): string | null {
  if (!reasons.some((r) => UNCERTAIN.has(r))) return null;
  const missing = separating.filter((s) => s.value_from_listing === null).map((s) => fact(s.name));
  return missing.length
    ? `Not certain which line applies — the description doesn’t say ${orList(missing)}.`
    : 'Not certain which line applies — compare the official descriptions below with the product.';
}

/** When every candidate line comes to the same duty: what would pick the line, and that it doesn't change the estimate. */
export function sameDutyText(separating: { name: string; value_from_listing: string | null }[], levels: string[] | null): string | null {
  if (separating.length) return `The exact line depends on ${andList(separating.map((s) => fact(s.name)))}, but the estimate is the same either way.`;
  if (levels) return `The exact line depends on whether it is ${orList(levels.map((l) => `“${l}”`))}, but the estimate is the same either way.`;
  return null;
}
