// Search over the REAL seed catalog (data/seed/listings.json) and the REAL Rev 20 description chains (the committed HTS
// index, read-only). Pins the before/after table for the seed queries and the demo query's result set with 0–3 seller-published
// Japanese watches. "before" is the pre-feature search (frozen copy below) so the comparison stays reproducible.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentHtsIndex } from '@/server/hts';
import { rankListings, type SearchListing } from './search';

const MAX_COMPARE = 6; // src/agent/tools.ts
const SEARCH_CAP = 10;

const { chains } = currentHtsIndex();
const chainOf = (code: string) => chains.get(code) ?? null;

type SeedRow = { id: string; title: string; hts10: string; description?: string };
const seedRows = (JSON.parse(readFileSync('data/seed/listings.json', 'utf8')) as { listings: SeedRow[] }).listings;
// Seed rows are inserted before any seller listing (local DB, 2026-10-10: seed 10-07…10-10 03:22, seller rows 10-10 16:55+);
// file order stands in for insert order (the watches' local order is P03, P03-B, P13, P14 too).
const SEED: SearchListing[] = seedRows.map((r, i) => ({ id: r.id, title: r.title, description: r.description ?? null, hts10: r.hts10, sellerPublished: false, createdAt: new Date(Date.UTC(2026, 9, 7, 0, 0, i)) }));

const JA_TITLE = '自動巻き ダイバーズウォッチ ステンレスケース ステンレスブレス 1990年代';
const jaWatch = (n: number): SearchListing => ({ id: `L-C-ja${n}`, title: JA_TITLE, description: null, hts10: '9102.21.70', sellerPublished: true, createdAt: new Date(Date.UTC(2026, 9, 10, 17, n)) });

/** The search as it was before HTS-description matching (src/agent/tools.ts at 16209b4), frozen for the comparison. */
function before(query: string, catalog: SearchListing[]): string[] {
  const STOP = new Set(['the', 'and', 'for', 'with', 'under', 'below', 'delivered', 'shipped', 'max', 'than', 'less', 'over', 'from', 'usd']);
  const tok = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
  const q = tok(query);
  return catalog
    .map((l) => ({ l, score: q.filter((t) => new Set(tok(`${l.title} ${l.description ?? ''}`)).has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.l.id.localeCompare(b.l.id))
    .slice(0, SEARCH_CAP)
    .map((x) => x.l.id);
}
const after = (query: string, catalog: SearchListing[]) => rankListings(query, catalog, chainOf).slice(0, SEARCH_CAP).map((x) => x.listing.id);

const WATCHES = ['L-P03', 'L-P03-B', 'L-P13', 'L-P14'];

describe('seed queries: before → after (seed catalog; chain matching never applies to seed rows)', () => {
  const table: [string, string[], string[]][] = [
    ['automatic diver watch under $400 delivered', WATCHES, WATCHES],
    ['vintage automatic diver watch under $400 delivered', WATCHES, WATCHES],
    ['watch', WATCHES, WATCHES],
    ['figure', ['L-P05', 'L-T-INJ'], ['L-P05', 'L-T-INJ']],
    ['chef knife', ['L-P11'], ['L-P11']],
    ['denim jeans', ['L-P08'], ['L-P08']],
    ['anime disc box set', ['L-P12'], ['L-P12']],
    ['watches', [], WATCHES], // the only change: plural normalisation
    ['toy', [], []], // 9503 chain says "other toys", but seed rows never match through the chain
  ];
  it.each(table)('%s', (query, b, a) => {
    expect(before(query, SEED)).toEqual(b);
    expect(after(query, SEED)).toEqual(a);
  });
});

describe('demo query with 0–3 seller-published Japanese watches (real 9102.21.70 chain)', () => {
  const Q = 'automatic diver watch under $400 delivered';

  it('the real chain matches automatic + watch (diver is not in it), as hts_description', () => {
    const [r] = rankListings(Q, [jaWatch(0)], chainOf);
    expect(r).toMatchObject({ source: 'hts_description', score: 2, htsMatch: { hts: '9102.21.70', terms: ['automatic', 'watch'] } });
    expect(r!.htsMatch!.official_levels.every((l) => r!.htsMatch!.official_chain.includes(l))).toBe(true);
    expect(r!.htsMatch!.official_levels.map((l) => l.replace(/:$/, ''))).toEqual(['Other wrist watches, whether or not incorporating a stop watch facility', 'With automatic winding']);
  });

  it.each([0, 1, 2, 3])('%i JA watch(es): the four English watches are always first; compare = first 6', (n) => {
    const ja = Array.from({ length: n }, (_, i) => jaWatch(i));
    const ids = after(Q, [...SEED, ...ja.slice().reverse()]);
    expect(ids.slice(0, 4)).toEqual(WATCHES);
    expect(ids.slice(4)).toEqual(ja.map((x) => x.id)); // created_at order
    expect(ids.slice(0, MAX_COMPARE)).toEqual([...WATCHES, ...ja.slice(0, 2).map((x) => x.id)]);
  });

  it('an English-titled seller watch (score 3) sorts after the seed watches; with 2 JA watches the four English still hold 1–4', () => {
    const en: SearchListing = { id: 'L-C-00000000', title: 'Automatic diver watch, steel bracelet', description: null, hts10: '9102.21.70', sellerPublished: true, createdAt: new Date(Date.UTC(2026, 9, 10, 18)) };
    const ids = after(Q, [en, ...SEED, jaWatch(0), jaWatch(1)]);
    expect(ids).toEqual([...WATCHES, 'L-C-00000000', 'L-C-ja0', 'L-C-ja1']);
    expect(ids.slice(0, MAX_COMPARE)).toEqual([...WATCHES, 'L-C-00000000', 'L-C-ja0']);
  });
});
