// Checks over an agent run's events (pnpm agent:live and the replay e2e): every quoted listing appeared in a search the
// buyer saw, HTS-description matches within the compare cap were quoted, and — for the demo query — what was proposed and
// whether the over-budget JP-B row was compared.
import { queryKey } from './search';

type Ev = { type: string; id?: string; name?: string; input?: unknown; output?: unknown };
type Row = { listingId?: unknown; quoteId?: unknown; within_budget?: unknown; refused?: unknown; match_source?: unknown; hts_match?: { official_levels?: unknown } };

const outputs = (events: readonly Ev[], name: string) => events.filter((e) => e.type === 'tool-result' && e.name === name).map((e) => (e.output ?? {}) as Record<string, unknown>);

/** Quoted rows (compare_landed_costs rows + single quotes), excluding refused / unquotable ones. */
function quotedRows(events: readonly Ev[]): Row[] {
  const compared = outputs(events, 'compare_landed_costs').flatMap((o) => (Array.isArray(o.compared) ? (o.compared as Row[]) : []));
  const single = outputs(events, 'get_landed_cost_quote') as Row[];
  return [...compared, ...single].filter((r) => typeof r.quoteId === 'string');
}

export function quotedVsSearched(events: readonly Ev[]): { quoted: string[]; unseen: string[] } {
  const searched = new Set(outputs(events, 'search_listings').flatMap((o) => (Array.isArray(o.results) ? (o.results as Row[]).map((r) => String(r.listingId)) : [])));
  const quoted = quotedRows(events).map((r) => String(r.listingId));
  return { quoted, unseen: quoted.filter((id) => !searched.has(id)) };
}

const searchRows = (o: Record<string, unknown>) => (Array.isArray(o.results) ? (o.results as Row[]) : []);

/** The HTS-description (chain-only) search results of a run, once per listing, with their matched official levels. */
export function chainOnlyResults(events: readonly Ev[]): { listingId: string; official_levels: string[] }[] {
  const seen = new Map<string, string[]>();
  for (const r of outputs(events, 'search_listings').flatMap(searchRows)) {
    if (r.match_source !== 'hts_description' || seen.has(String(r.listingId))) continue;
    const levels = r.hts_match?.official_levels;
    seen.set(String(r.listingId), Array.isArray(levels) ? levels.map(String) : []);
  }
  return [...seen].map(([listingId, official_levels]) => ({ listingId, official_levels }));
}

/**
 * HTS-description results within the compare cap of a compared search that were not quoted. compare_landed_costs quotes
 * the first `maxCompare` results of the latest search with the same query key, so each of those must appear as quoted.
 */
export function chainMatchesNotQuoted(events: readonly Ev[], maxCompare: number): string[] {
  const queryOf = new Map(events.filter((e) => e.type === 'tool-call' && e.name === 'search_listings').map((e) => [e.id, String((e.input as { query?: unknown } | undefined)?.query ?? '')]));
  const quoted = new Set(quotedRows(events).map((r) => String(r.listingId)));
  const latest = new Map<string, Row[]>();
  const missing = new Set<string>();
  for (const e of events) {
    if (e.type !== 'tool-result') continue;
    const o = (e.output ?? {}) as Record<string, unknown>;
    if (e.name === 'search_listings') latest.set(queryKey(queryOf.get(e.id) ?? ''), searchRows(o));
    if (e.name === 'compare_landed_costs' && typeof o.query === 'string') {
      for (const r of (latest.get(queryKey(o.query)) ?? []).slice(0, maxCompare)) {
        if (r.match_source === 'hts_description' && !quoted.has(String(r.listingId))) missing.add(String(r.listingId));
      }
    }
  }
  return [...missing];
}

/** Every string leaf of every tool result (what the agent could have quoted verbatim). */
export function toolStrings(events: readonly Ev[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const e of events) if (e.type === 'tool-result') walk(e.output);
  return out;
}

export function demoOutcome(events: readonly Ev[]): { proposed: string[]; jpBOverBudget: boolean } {
  const rows = quotedRows(events);
  const proposedQuoteIds = outputs(events, 'propose_purchase').filter((p) => p.proposed === true).map((p) => p.quoteId);
  return {
    proposed: rows.filter((r) => proposedQuoteIds.includes(r.quoteId)).map((r) => String(r.listingId)),
    jpBOverBudget: rows.some((r) => r.listingId === 'L-P03-B' && r.within_budget === false),
  };
}
