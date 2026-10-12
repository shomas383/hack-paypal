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

/**
 * A heading's own official text, trimmed for a sentence: the leading "Except …," clause and the trailing "as provided for in
 * … note" citation are dropped (the note is cited separately), and a long text stops at its first clause boundary.
 * The words that remain are the official ones, in order; "…" marks every cut.
 */
export function trimOfficial(text: string): string {
  let s = text.trim();
  const lead = /^Except\b.*?, (?=[a-z])/.exec(s);
  if (lead) s = `…${s.slice(lead[0].length)}`;
  s = s.replace(/,? as provided (?:for )?in (?:subdivisions? .*?of )?U\.S\. note \d+.*$/, '');
  const MAX = 120;
  if (s.length > MAX) {
    const boundary = /, (?:and|except|the foregoing|other than)\b|; /g;
    let cut = -1;
    for (const m of s.matchAll(boundary)) if (m.index! >= 30 && m.index! <= MAX) cut = cut === -1 ? m.index! : cut;
    if (cut === -1) cut = s.lastIndexOf(' ', MAX);
    s = `${s.slice(0, cut).replace(/[,;:]$/, '')}…`;
  }
  return s;
}

const described = (h: string, texts: Map<string, string>) => (texts.has(h) ? `heading ${h} (“${trimOfficial(texts.get(h)!)}”)` : `heading ${h}`);

/** Why a line can't be estimated, in one or two plain sentences. Cites note and heading numbers, never program names. */
export function cantText(reason: CantReason, detail: string, refs: string[], headings: { heading: string; text: string }[] = []): string {
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
      const texts = new Map(headings.map((h) => [h.heading, h.text]));
      const footnoted = refs.filter((r) => r.startsWith('footnote ')).map((r) => r.slice('footnote '.length));
      const own = refs.filter((r) => r.startsWith('heading ')).map((r) => r.slice('heading '.length)).filter((h) => !footnoted.includes(h));
      const notes = refs.filter((r) => r.startsWith('note ')).map(refText);
      const sentences: string[] = [];
      if (footnoted.length) sentences.push(`The line’s own footnote cites ${andList(footnoted.map((h) => described(h, texts)))}`);
      if (own.length) sentences.push(`${cap(andList(own.map((h) => described(h, texts))))} name${own.length === 1 ? 's' : ''} this line`);
      if (notes.length) {
        const tied = headings.map((h) => h.heading);
        const also = sentences.length ? ' also' : '';
        const verb = notes.length === 1 ? ['names', 'ties'] : ['name', 'tie'];
        sentences.push(`${cap(andList(notes))}${also} ${verb[0]} this line${tied.length ? ` and ${verb[1]} it to heading${tied.length === 1 ? '' : 's'} ${andList(tied)}` : ''}`);
      }
      if (!sentences.length) sentences.push('A Chapter 99 provision names this line');
      const many = new Set([...footnoted, ...own, ...headings.map((h) => h.heading)]).size > 1;
      return sentences.length === 1
        ? `${sentences[0]}, and the estimator doesn’t model ${many ? 'them' : 'it'} yet.`
        : `${sentences.join('. ')}. The estimator doesn’t model ${many ? 'them' : 'it'} yet.`;
    }
    case 'NEEDS_FACTS':
      return 'A verified rate row covers this line, but its duty depends on the answers below.';
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
  'Not included: Chapter 99 duties the estimator doesn’t model (lines they name are refused, not estimated), antidumping and countervailing duties, the merchandise and harbor maintenance fees, and carrier brokerage or other fees.';

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

/** Whether the classifier's routing reasons mean it isn't certain which line applies. */
export const isUncertain = (reasons: string[]) => reasons.some((r) => UNCERTAIN.has(r));

/**
 * When every candidate line comes to the same duty, one sentence: what would pick the line (the separating facts, else
 * where the official lines part) and that the estimate is the same either way. `amount` is the formatted duty.
 */
export function sameDutyText(separating: { name: string; value_from_listing: string | null }[], levels: string[] | null, amount: string, uncertain: boolean): string | null {
  const on = separating.length ? andList(separating.map((s) => fact(s.name))) : levels ? `whether it is ${orList(levels.map((l) => `“${l}”`))}` : null;
  if (uncertain) return on ? `Not certain which line applies — it depends on ${on} — but the estimate is ${amount} either way.` : `Not certain which line applies, but the estimate is ${amount} either way.`;
  return on ? `The exact line depends on ${on}, but the estimate is ${amount} either way.` : null;
}

/**
 * Plain questions for the facts a verified rate row's conditions turn on (the fact names come from the verified sheet; the
 * threshold is read from the name: steel_weight_share_ge_15pct → 15%). Null for a fact without one: it isn't asked.
 */
export function factQuestion(fact: string): string | null {
  const pct = /_ge_(\d+)pct$/.exec(fact)?.[1];
  switch (fact.replace(/_ge_\d+pct$/, '')) {
    case 'steel_weight_share':
      return pct ? `Is steel at least ${pct}% of the product’s weight?` : null;
    case 'steel_us_melted_poured':
      return pct ? `Was at least ${pct}% of the steel melted and poured in the United States?` : null;
    default:
      return null;
  }
}
