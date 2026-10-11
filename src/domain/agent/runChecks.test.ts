import { describe, expect, it } from 'vitest';
import { chainMatchesNotQuoted, chainOnlyResults, demoOutcome, quotedVsSearched, toolStrings } from './runChecks';

type E = { type: string; id?: string; name?: string; input?: unknown; output?: unknown };
const search = (...ids: string[]): E => ({ type: 'tool-result', name: 'search_listings', output: { results: ids.map((listingId) => ({ listingId })) } });
const compare = (...rows: [string, boolean][]): E => ({ type: 'tool-result', name: 'compare_landed_costs', output: { compared: rows.map(([listingId, within_budget], i) => ({ quoteId: `q-${listingId}`, listingId, within_budget, delivered_total: `$${300 + i}.00` })) } });
const quote = (listingId: string): E => ({ type: 'tool-result', name: 'get_landed_cost_quote', output: { quoteId: `q-${listingId}`, listingId, within_budget: true } });
const propose = (listingId: string): E => ({ type: 'tool-result', name: 'propose_purchase', output: { proposed: true, quoteId: `q-${listingId}` } });

describe('quotedVsSearched: every quoted listing must appear in a rendered search step', () => {
  it('passes when all compared / quoted ids were returned by a search', () => {
    const r = quotedVsSearched([search('L-P14', 'L-P03', 'L-P13', 'L-P03-B'), compare(['L-P14', true], ['L-P03', true], ['L-P13', true], ['L-P03-B', false])]);
    expect(r).toEqual({ quoted: ['L-P14', 'L-P03', 'L-P13', 'L-P03-B'], unseen: [] });
  });

  it('flags a quote for a listing no search returned (the 2026-10-10 production case)', () => {
    expect(quotedVsSearched([search('L-P03', 'L-P13'), quote('L-C-bce3add4')]).unseen).toEqual(['L-C-bce3add4']);
  });

  it('refused quotes are not quotes', () => {
    const refused: E = { type: 'tool-result', name: 'get_landed_cost_quote', output: { listingId: 'L-X', refused: 'Search first; only listings shown in a search can be quoted.' } };
    expect(quotedVsSearched([search('L-P03'), refused])).toEqual({ quoted: [], unseen: [] });
  });
});

describe('HTS-description matches in a run', () => {
  const call = (id: string, name: string, input: unknown): E => ({ type: 'tool-call', id, name, input });
  const searchOut = (id: string, rows: [string, 'title' | 'hts_description'][]): E => ({
    type: 'tool-result',
    id,
    name: 'search_listings',
    output: {
      results: rows.map(([listingId, match_source]) => ({
        listingId,
        match_source,
        untrusted_seller_text: { title: listingId.startsWith('L-C') ? '自動巻き ダイバーズウォッチ' : 'Automatic diver watch' },
        ...(match_source === 'hts_description' ? { hts_match: { hts: '9102.21.70', terms: ['automatic', 'watch'], official_levels: ['With automatic winding:'], official_chain: ['Wrist watches:', 'With automatic winding:'] } } : {}),
      })),
    },
  });
  const compareOut = (id: string, query: string, ...ids: string[]): E => ({ type: 'tool-result', id, name: 'compare_landed_costs', output: { query, compared: ids.map((listingId) => ({ quoteId: `q-${listingId}`, listingId, within_budget: true })) } });
  const rows: [string, 'title' | 'hts_description'][] = [
    ['L-P03', 'title'],
    ['L-P03-B', 'title'],
    ['L-P13', 'title'],
    ['L-P14', 'title'],
    ['L-C-a', 'hts_description'],
    ['L-C-b', 'hts_description'],
    ['L-C-c', 'hts_description'],
  ];

  it('chainOnlyResults: the hts_description rows with their whole official chain (every level counts for the quote check)', () => {
    expect(chainOnlyResults([searchOut('s1', rows.slice(3, 5))])).toEqual([{ listingId: 'L-C-a', official_chain: ['Wrist watches:', 'With automatic winding:'] }]);
  });

  it('chainMatchesNotQuoted: every hts_description row within the compare cap of a compared search must be quoted', () => {
    const ev = [call('s1', 'search_listings', { query: 'automatic diver watches' }), searchOut('s1', rows), call('c1', 'compare_landed_costs', { query: 'automatic diver watch' })];
    // the 7th row (L-C-c) is beyond the cap of 6: shown, not required
    expect(chainMatchesNotQuoted([...ev, compareOut('c1', 'automatic diver watch', 'L-P03', 'L-P03-B', 'L-P13', 'L-P14', 'L-C-a', 'L-C-b')], 6)).toEqual([]);
    expect(chainMatchesNotQuoted([...ev, compareOut('c1', 'automatic diver watch', 'L-P03', 'L-P03-B', 'L-P13', 'L-P14', 'L-C-a')], 6)).toEqual(['L-C-b']);
  });

  it('a search that was never compared requires nothing', () => {
    expect(chainMatchesNotQuoted([call('s1', 'search_listings', { query: 'watch' }), searchOut('s1', rows)], 6)).toEqual([]);
  });

  it('toolStrings: every string leaf of every tool result (incl. seller titles)', () => {
    const s = toolStrings([searchOut('s1', rows.slice(4, 5))]);
    expect(s).toContain('自動巻き ダイバーズウォッチ');
    expect(s).toContain('With automatic winding:');
  });
});

describe('demoOutcome (the demo query): DE proposed and the JP-B over-budget row present', () => {
  it('reads the proposed listing and whether L-P03-B was compared as over budget', () => {
    const ev = [search('L-P14', 'L-P03-B'), compare(['L-P14', true], ['L-P03-B', false]), propose('L-P14')];
    expect(demoOutcome(ev)).toEqual({ proposed: ['L-P14'], jpBOverBudget: true });
  });

  it('missing JP-B row → false', () => {
    expect(demoOutcome([search('L-P14'), compare(['L-P14', true]), propose('L-P14')]).jpBOverBudget).toBe(false);
  });
});
