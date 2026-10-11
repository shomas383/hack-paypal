import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chainThreshold, rankListings, singular, tokens, type SearchListing } from './search';

// The official Rev 20 chain of 9102.21.70, verbatim (as in src/ui/dutyText.test.ts).
const WATCH_CHAIN = [
  'Wrist watches, pocket watches and other watches, including stop watches, other than those of heading 9101:',
  'Other wrist watches, whether or not incorporating a stop watch facility:',
  'With automatic winding:',
  'Having over 17 jewels in the movement:',
  'With strap, band or bracelet of textile material or of base metal, whether or not gold- or silver-plated',
];
const chains: Record<string, string[]> = { '9102.21.70': WATCH_CHAIN };
const chainOf = (code: string) => chains[code] ?? null;

const at = (n: number) => new Date(Date.UTC(2026, 9, 7, 0, 0, n));
const seed = (id: string, title: string, n: number, hts10 = '9102.21.70'): SearchListing => ({ id, title, description: null, hts10, sellerPublished: false, createdAt: at(n) });
const seller = (id: string, title: string, n: number, hts10 = '9102.21.70'): SearchListing => ({ ...seed(id, title, n, hts10), sellerPublished: true });

describe('tokens — lowercase [a-z0-9]+, length ≥ 3, no all-digit tokens, STOP words dropped, singular forms', () => {
  it('normalises plurals on both sides', () => {
    expect(singular('watches')).toBe('watch');
    expect(singular('jewels')).toBe('jewel');
    expect(singular('glasses')).toBe('glass');
    expect(singular('boxes')).toBe('box');
    expect(singular('accessories')).toBe('accessory');
    expect(singular('jeans')).toBe('jean');
    expect(singular('glass')).toBe('glass');
    expect(singular('status')).toBe('status');
    expect(singular('analysis')).toBe('analysis');
    expect(singular('watch')).toBe('watch');
  });

  it('keeps tokens with digits as they are (1990s is not "1990"), drops all-digit tokens', () => {
    expect(tokens('1990s Japanese watch, 21 jewels')).toEqual(['1990s', 'japanese', 'watch', 'jewel']);
  });

  it('drops the query STOP words and the chain filler words', () => {
    expect(tokens('automatic diver watch under $400 delivered')).toEqual(['automatic', 'diver', 'watch']);
    expect(tokens('Other wrist watches, whether or not incorporating a stop watch facility:')).toEqual(['wrist', 'watch', 'stop', 'watch', 'facility']);
    expect(tokens('other than those of heading 9101, including, thereof, having, except, described, provided, subheading')).toEqual([]);
  });

  it('Japanese text yields no tokens (no translation, ever)', () => {
    expect(tokens('自動巻き ダイバーズウォッチ ステンレスケース ステンレスブレス 1990年代')).toEqual([]);
  });
});

describe('chainThreshold — a chain-only match needs min(2, query tokens) matched tokens', () => {
  it('values', () => {
    expect(chainThreshold(1)).toBe(1);
    expect(chainThreshold(2)).toBe(2);
    expect(chainThreshold(3)).toBe(2);
  });
});

describe('rankListings — title matches, then HTS-description (chain-only) matches', () => {
  const ja = seller('L-C-ja', '自動巻き ダイバーズウォッチ ステンレスケース', 100);

  it('a seller-published Japanese listing matches through its official chain (automatic + watch), with the matched levels', () => {
    const r = rankListings('automatic diver watch', [ja], chainOf);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ score: 2, source: 'hts_description' });
    expect(r[0]!.htsMatch).toEqual({
      hts: '9102.21.70',
      terms: ['automatic', 'watch'],
      official_levels: [WATCH_CHAIN[0], WATCH_CHAIN[1], WATCH_CHAIN[2]],
      official_chain: WATCH_CHAIN,
    });
  });

  it('chain threshold: "pocket knife" does not return the watch (1 of 2); "watch" does (1 of 1)', () => {
    expect(rankListings('pocket knife', [ja], chainOf)).toEqual([]);
    expect(rankListings('watch', [ja], chainOf).map((x) => x.listing.id)).toEqual(['L-C-ja']);
  });

  it('seed (non-seller) listings never match through the chain', () => {
    expect(rankListings('automatic diver watch', [seed('L-SEED-ja', '自動巻き ダイバーズウォッチ', 1)], chainOf)).toEqual([]);
    expect(rankListings('stop watch facility', [seed('L-P03', 'Automatic diver watch', 1)], chainOf).map((x) => [x.listing.id, x.source, x.score])).toEqual([['L-P03', 'title', 1]]);
  });

  it('a listing whose title matches is a title match, scored on the title only (the chain adds nothing)', () => {
    const r = rankListings('automatic winding watch', [seller('L-C-en', 'Automatic watch', 100)], chainOf);
    expect(r.map((x) => [x.source, x.score, x.htsMatch])).toEqual([['title', 2, undefined]]);
  });

  it('a listing with no chain (unknown code) is not a chain match', () => {
    expect(rankListings('automatic watch', [seller('L-C-x', 'テスト', 1, '0000.00.0000')], chainOf)).toEqual([]);
  });

  it('title matches ALWAYS rank above chain-only matches, even with a lower score', () => {
    const low = seed('L-Z-low', 'Diver accessory', 5); // title score 1
    const r = rankListings('automatic diver watch', [ja, low], chainOf);
    expect(r.map((x) => [x.listing.id, x.source, x.score])).toEqual([
      ['L-Z-low', 'title', 1],
      ['L-C-ja', 'hts_description', 2],
    ]);
  });

  it('within a source: score desc → created_at asc → id', () => {
    const r = rankListings('automatic diver watch', [
      seller('L-A-new', 'Automatic diver watch', 50), // score 3, created later than the seed rows
      seed('L-P14', 'Automatic diver watch (Germany)', 4),
      seed('L-P03', 'Automatic diver watch (Japan)', 1),
      seed('L-B-two', 'Diver watch', 0), // score 2
      seed('L-P13b', 'Automatic diver watch (China)', 3),
      seed('L-P13a', 'Automatic diver watch (China)', 3), // same created_at → id
      seller('L-C-jb', '自動巻き', 300),
      seller('L-C-ja2', '自動巻き', 200),
    ], chainOf);
    expect(r.map((x) => x.listing.id)).toEqual(['L-P03', 'L-P13a', 'L-P13b', 'L-P14', 'L-A-new', 'L-B-two', 'L-C-ja2', 'L-C-jb']);
  });

  it('query tokens are de-duplicated (watch watches counts once)', () => {
    expect(rankListings('watch watches', [seed('L-1', 'Watch', 1)], chainOf)[0]!.score).toBe(1);
  });

  it('deterministic: any input order gives the same ranking', () => {
    const catalog = [
      seed('L-P03', '1990s Japanese automatic diver watch', 1),
      seed('L-P03-B', 'Automatic diver watch, 1980s', 2),
      seed('L-P13', 'Automatic diver watch (China)', 3),
      seed('L-P14', 'Automatic diver watch (Germany)', 4),
      seed('L-P05', 'Articulated PVC collectible figure', 5, '9503.00.0090'),
      seller('L-C-1', '自動巻き ダイバーズウォッチ', 10),
      seller('L-C-2', '自動巻き ダイバーズウォッチ 21石', 9),
      seller('L-C-3', 'Automatic diver watch', 11),
    ];
    const expected = rankListings('automatic diver watch', catalog, chainOf).map((x) => x.listing.id);
    fc.assert(
      fc.property(fc.shuffledSubarray(catalog, { minLength: catalog.length, maxLength: catalog.length }), (shuffled) => {
        expect(rankListings('automatic diver watch', shuffled, chainOf).map((x) => x.listing.id)).toEqual(expected);
      }),
    );
  });
});
