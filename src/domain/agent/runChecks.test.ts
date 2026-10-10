import { describe, expect, it } from 'vitest';
import { demoOutcome, quotedVsSearched } from './runChecks';

type E = { type: string; name?: string; output?: unknown };
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

describe('demoOutcome (the demo query): DE proposed and the JP-B over-budget row present', () => {
  it('reads the proposed listing and whether L-P03-B was compared as over budget', () => {
    const ev = [search('L-P14', 'L-P03-B'), compare(['L-P14', true], ['L-P03-B', false]), propose('L-P14')];
    expect(demoOutcome(ev)).toEqual({ proposed: ['L-P14'], jpBOverBudget: true });
  });

  it('missing JP-B row → false', () => {
    expect(demoOutcome([search('L-P14'), compare(['L-P14', true]), propose('L-P14')]).jpBOverBudget).toBe(false);
  });
});
