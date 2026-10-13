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
      return 'Estimates are available for goods made in Japan, Germany or China for now.';
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
    case 'DATA_EXPIRED':
      return `${detail}.`;
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

/**
 * Note 20 exclusions in effect that name a line, in one sentence (subdivision and heading numbers only): "An exclusion in
 * effect under U.S. note 20(vvv)(iii)(1) to subchapter III (heading 9903.88.69) covers particular products under this line;
 * it isn't applied here and can only lower the duty."
 */
export function exclusionText(exclusions: { ref: string; heading: string; until?: string }[]): string | null {
  if (!exclusions.length) return null;
  // each heading with its own end date ("heading 9903.88.69, through November 9, 2026")
  const hs = [...new Map(exclusions.map((x) => [x.heading, x.until ? `${x.heading}, ${x.until}` : x.heading])).values()];
  const many = exclusions.length > 1;
  return `${many ? 'Exclusions' : 'An exclusion'} in effect under ${andList(exclusions.map((x) => refText(x.ref)))} (heading${hs.length > 1 ? 's' : ''} ${andList(hs)}) cover${many ? '' : 's'} particular products under this line; ${many ? 'they aren’t' : 'it isn’t'} applied here and can only lower the duty.`;
}

/**
 * Why there is no candidate line, in one or two sentences. TOO_BROAD names where the official lines part (verbatim levels,
 * built by code), so the seller knows which fact to add.
 */
export function stoppedText(s: { reason: 'TOO_BROAD' | 'NO_CANDIDATES' | 'INVALID_OUTPUT'; lines: number | null; differAt: string[] }): string {
  const hint = 'Add what it’s made of, what it’s used for, or the maker’s model name, and try again.';
  if (s.reason === 'INVALID_OUTPUT') return 'The classifier’s answer couldn’t be checked against the official schedule. Try again in a moment.';
  if (s.reason === 'NO_CANDIDATES') return `No official HTS line matched this description. ${hint}`;
  if (s.lines === null || s.differAt.length < 2) return `The description fits too many official lines to compare. ${hint}`;
  return `The description fits ${s.lines} official lines, more than the estimator compares at once. They differ at ${orList(s.differAt.map((l) => `“${l}”`))}: add which applies and try again.`;
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

/** Where the shown lines' official descriptions part: the options at that level, and whether the choice changes the duty. */
export interface LineDifference {
  /** The model's attribute name, only when it clearly matches this difference (see lineDifferences); else null. */
  name: string | null;
  /** The official level texts, shortened as on the refusal pages; "Other" last. */
  options: string[];
  /** Some two options lead to lines with no duty in common. */
  changesDuty: boolean;
}

/** Words that say what kind of fact an attribute is, not which one: they needn't appear in the official text. */
const GENERIC = new Set(['content', 'color', 'colour', 'type', 'kind', 'count', 'number', 'material', 'status', 'value', 'presence', 'whether', 'unit']);
const words = (s: string) => (s.toLowerCase().match(/[a-z]{3,}/g) ?? []).map((w) => w.replace(/s$/, ''));
/** An official level as a short option: ":" and a trailing category number ("(347)") dropped, then trimOfficial. */
const option = (level: string) => trimOfficial(level.trim().replace(/:$/, '').replace(/\s+\(\d+\)$/, ''));

/**
 * Every level where the shown lines' official descriptions part, found by code (decision 2026-10-12): lines are grouped
 * by their chains; at the first level a group's lines differ, that is one difference, and each branch is searched again.
 * Differences that change the duty come first, then by depth. The model never adds or removes a difference: its
 * attribute names (`separating`) only label one, when each of the name's content words (outside parentheses, generic
 * words aside) is in that difference's official text; otherwise the official text stands alone.
 */
export function lineDifferences(lines: { chain: string[]; dutyMinor: number | null }[], separating: { name: string; value_from_listing: string | null }[]): LineDifference[] {
  const found: (LineDifference & { depth: number })[] = [];
  const visit = (group: typeof lines, from: number) => {
    if (group.length < 2) return;
    const depth = Math.max(...group.map((l) => l.chain.length));
    let d = from;
    while (d < depth && group.every((l) => l.chain[d] === group[0]!.chain[d])) d++;
    if (d >= depth) return;
    const branches = new Map<string, typeof lines>();
    for (const l of group) branches.set(l.chain[d] ?? '', [...(branches.get(l.chain[d] ?? '') ?? []), l]);
    const duties = [...branches.values()].map((b) => new Set(b.map((l) => l.dutyMinor)));
    const changesDuty = duties.some((a, i) => duties.slice(i + 1).some((b) => [...a].every((x) => !b.has(x))));
    const options = [...branches.keys()].map(option).sort((a, b) => Number(a === 'Other') - Number(b === 'Other'));
    const text = new Set(words(options.join(' ')));
    const name = separating.find((s) => {
      const w = words(s.name.replace(/\([^)]*\)/g, '')).filter((x) => !GENERIC.has(x));
      return w.length > 0 && w.every((x) => text.has(x));
    });
    found.push({ name: name ? name.name.replace(/\s*\([^)]*\)/g, '').trim() : null, options, changesDuty, depth: d });
    for (const b of branches.values()) visit(b, d + 1);
  };
  visit(lines, 0);
  return found.sort((a, b) => Number(b.changesDuty) - Number(a.changesDuty) || a.depth - b.depth).map(({ depth, ...x }) => (void depth, x));
}

const differencePhrase = (d: LineDifference) => {
  const opts = d.options.map((o) => `“${o}”`).join(' vs ');
  return d.name ? `${fact(d.name)} (${opts})` : opts;
};

/**
 * When every shown line comes to the same duty, one short sentence: where the lines part (official text, or a model name
 * that clearly matches it) and that the estimate is the same either way. With no difference: only the either-way sentence.
 */
export function sameDutyText(differences: LineDifference[], amount: string, uncertain: boolean): string {
  if (!differences.length) return `The estimate is ${amount} either way.`;
  const on = andList(differences.map(differencePhrase));
  return uncertain ? `Not certain which line applies — it depends on ${on} — but the estimate is ${amount} either way.` : `The exact line depends on ${on}, but the estimate is ${amount} either way.`;
}

/** When the shown lines' duties differ and the classifier isn't certain: the differences, those that change the duty first. */
export function rangeReasonText(differences: LineDifference[], uncertain: boolean): string | null {
  if (!uncertain || !differences.length) return null;
  return `Not certain which line applies — it depends on ${andList(differences.map(differencePhrase))}.`;
}
