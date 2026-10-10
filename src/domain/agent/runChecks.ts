// Checks over an agent run's events (pnpm agent:live and the replay e2e): every quoted listing appeared in a search the
// buyer saw, and — for the demo query — what was proposed and whether the over-budget JP-B row was compared.
type Ev = { type: string; name?: string; output?: unknown };
type Row = { listingId?: unknown; quoteId?: unknown; within_budget?: unknown; refused?: unknown };

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

export function demoOutcome(events: readonly Ev[]): { proposed: string[]; jpBOverBudget: boolean } {
  const rows = quotedRows(events);
  const proposedQuoteIds = outputs(events, 'propose_purchase').filter((p) => p.proposed === true).map((p) => p.quoteId);
  return {
    proposed: rows.filter((r) => proposedQuoteIds.includes(r.quoteId)).map((r) => String(r.listingId)),
    jpBOverBudget: rows.some((r) => r.listingId === 'L-P03-B' && r.within_budget === false),
  };
}
