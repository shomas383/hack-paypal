// Buyer-agent catalog search (pure; SPEC §4.4). A listing matches on its own title/description words, or — only for a
// seller-published listing whose title/description matches nothing — on the OFFICIAL Rev 20 English description chain of
// its settled HTS code (verbatim from the committed HTS index). No translation and no model keywords: a Japanese title
// yields no tokens, so it can be found only through the official text of the code the seller console settled.

/** Query filler and HTS-chain filler, dropped on both sides. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'under', 'below', 'delivered', 'shipped', 'max', 'than', 'less', 'over', 'from', 'usd',
  'other', 'whether', 'not', 'including', 'those', 'heading', 'subheading', 'thereof', 'having', 'except', 'described', 'provided', 'incorporating',
]);

/** Singular form of a lowercase word (watches → watch, accessories → accessory, jewels → jewel); words with digits unchanged. */
export function singular(t: string): string {
  if (/\d/.test(t)) return t;
  if (/(?:ch|sh|x|ss|z)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.endsWith('s') && !/(?:ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/** Lowercase [a-z0-9]+ words, length ≥ 3, not all digits, singular, STOP words dropped. */
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t))
    .map(singular)
    .filter((t) => !STOP.has(t));
}

/** A chain-only match needs this many matched query tokens: "pocket knife" must not return a watch. */
export const chainThreshold = (queryTokens: number) => Math.min(2, queryTokens);

export interface SearchListing {
  id: string;
  title: string;
  description: string | null;
  hts10: string;
  /** Published from the seller console (settled code). Only these are matched through the HTS chain. */
  sellerPublished: boolean;
  createdAt: Date;
}

export type MatchSource = 'title' | 'hts_description';

export interface HtsMatch {
  hts: string;
  /** The query tokens the chain matched, in query order. */
  terms: string[];
  /** The chain levels (verbatim) that contain a matched term, in chain order. */
  official_levels: string[];
  /** The whole chain, verbatim. */
  official_chain: string[];
}

export interface Ranked<L extends SearchListing> {
  listing: L;
  score: number;
  source: MatchSource;
  htsMatch?: HtsMatch;
}

/** The search key of a query (compare_landed_costs must use a query whose key was searched). */
export const queryKey = (query: string) => [...new Set(tokens(query))].join(' ');

/**
 * Matching listings only, ranked: title matches before HTS-description matches (always), then score (desc), then
 * created_at (asc: seed rows predate seller listings), then id.
 */
export function rankListings<L extends SearchListing>(query: string, catalog: readonly L[], chainOf: (code: string) => readonly string[] | null): Ranked<L>[] {
  const q = [...new Set(tokens(query))];
  const out: Ranked<L>[] = [];
  for (const l of catalog) {
    const own = new Set(tokens(`${l.title} ${l.description ?? ''}`));
    const score = q.filter((t) => own.has(t)).length;
    if (score > 0) {
      out.push({ listing: l, score, source: 'title' });
      continue;
    }
    const chain = l.sellerPublished ? chainOf(l.hts10) : null;
    if (!chain?.length) continue;
    const levelTokens = chain.map((level) => new Set(tokens(level)));
    const terms = q.filter((t) => levelTokens.some((s) => s.has(t)));
    if (terms.length === 0 || terms.length < chainThreshold(q.length)) continue;
    out.push({
      listing: l,
      score: terms.length,
      source: 'hts_description',
      htsMatch: { hts: l.hts10, terms, official_levels: chain.filter((_, i) => terms.some((t) => levelTokens[i]!.has(t))), official_chain: [...chain] },
    });
  }
  const rank = (s: MatchSource) => (s === 'title' ? 0 : 1);
  return out.sort(
    (a, b) =>
      rank(a.source) - rank(b.source) ||
      b.score - a.score ||
      a.listing.createdAt.getTime() - b.listing.createdAt.getTime() ||
      (a.listing.id < b.listing.id ? -1 : a.listing.id > b.listing.id ? 1 : 0),
  );
}
