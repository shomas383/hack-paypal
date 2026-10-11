'use client';

// /agent — the buyer agent UI (SPEC §4.4, docs/design/wireframes.md §1). Every number comes from a tool result (stored
// quotes computed by the rate engine) or from code (within/over budget, the insight line, the completion summary); the
// agent's streamed text is shown as text only. The seller-instructions notice is generated here from the search flags
// (withheldNotice over the whole catalog), never by the model. The agent can only PREPARE a purchase: approving and paying happen at checkout.
import { Fragment, useState } from 'react';
import { parseBudgetField, parseDeliveredBudget } from '@/domain/agent/checks';
import { runSummary, type QuoteView } from '@/domain/agent/insight';
import { uncheckedScriptNotice, withheldNotice } from '@/domain/agent/instructionNotice';
import { deepestLevels } from '@/domain/agent/search';
import { usd } from '@/domain/money/money';
import { formatUsd } from '@/lib/money';
import { Button } from '@/ui/Button';
import { Disclosure } from '@/ui/Disclosure';
import { officialChain } from '@/ui/dutyText';
import { markTerms, shortLevel } from '@/ui/htsMatchText';
import { Field, Input, Textarea } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { PageHeader } from '@/ui/PageHeader';
import { StatusBadge } from '@/ui/StatusBadge';
import { DutyBreakdown, type BreakdownLine } from '@/ui/patterns/DutyBreakdown';
import { InsightLine } from '@/ui/patterns/InsightLine';
import { ProposalSummary } from '@/ui/patterns/ProposalSummary';
import { QuotesTable, type QuoteRow } from '@/ui/patterns/QuotesTable';
import { ToolCallStep } from '@/ui/patterns/ToolCallStep';
import s from './agent.module.css';

type Json = Record<string, unknown>;
type HtsMatch = { hts: string; terms: string[]; official_levels: string[]; official_chain: string[] };
type SearchResult = {
  listingId: string;
  origin: string;
  goods: string;
  shipping: string;
  match_score: number;
  match_source?: 'title' | 'hts_description';
  hts_match?: HtsMatch;
  seller_text_contains_instructions: boolean;
  seller_text_unchecked_script?: boolean;
  untrusted_seller_text: { title: string; description: string | null };
};

type Item =
  | { kind: 'text'; text: string }
  | { kind: 'search'; id: string; query: string; results?: SearchResult[]; catalogSize?: number; withheld?: number; unchecked?: number; error?: string }
  | { kind: 'quotes'; rows: QuoteRow[]; pendingCompare?: string | undefined }
  | { kind: 'breakdown'; id: string; out?: Json; error?: string }
  | { kind: 'proposal'; id: string; reasoning: string; out?: Json; error?: string }
  | { kind: 'other'; id: string; name: string; out?: unknown; error?: string };

type Done = { steps: number; usage: { input: number; output: number }; ms: number };

const DEFAULT_MESSAGE = 'automatic diver watch under $400 delivered';

function Bold({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

/** Kana → the seller's title is Japanese (for screen readers); the title itself is shown as written, never translated. */
const titleLang = (title: string) => (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title) ? 'ja' : undefined);

/**
 * Why an HTS-description result matched: one official level per matched term, the deepest containing it, recomputed from
 * the chain so older recordings render the same (verbatim, cut at ~60 chars),
 * matched words marked, and the whole official chain one disclosure away. Official Rev 20 text only.
 */
function HtsMatchLine({ listingId, m }: { listingId: string; m: HtsMatch }) {
  return (
    <div className={s.match} data-testid={`agent-search-hts-match-${listingId}`}>
      <span className={s.matchLabel}>
        Matched on official HTS description (<span className={s.mono}>{m.hts}</span>):
      </span>
      <ul className={s.matchLevels}>
        {deepestLevels(m.official_chain, m.terms).map((level, i) => (
          <li key={i}>
            {markTerms(shortLevel(level), m.terms).map((seg, k) => (seg.mark ? <mark key={k} className={s.mark}>{seg.text}</mark> : <Fragment key={k}>{seg.text}</Fragment>))}
          </li>
        ))}
      </ul>
      <Disclosure summary="Full official description" className={s.matchFull}>
        <p className={s.matchChain}>{officialChain(m.official_chain)}</p>
      </Disclosure>
    </div>
  );
}

const budgetText = (minor: number) => formatUsd(usd(BigInt(minor)));

const STOPPED = '…(stopped)';

/** When a run stops early, the last (partial) agent text says so instead of ending mid-sentence. */
function markStopped(items: Item[]): Item[] {
  const i = items.map((it) => it.kind).lastIndexOf('text');
  if (i < 0) return items;
  const it = items[i] as Extract<Item, { kind: 'text' }>;
  if (it.text.endsWith(STOPPED)) return items;
  const next = [...items];
  next[i] = { kind: 'text', text: `${it.text.trimEnd()}${STOPPED}` };
  return next;
}

export function AgentClient({ endpoint = '/api/agent' }: { endpoint?: string }) {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [budget, setBudget] = useState(() => {
    const m = parseDeliveredBudget(DEFAULT_MESSAGE);
    return m === null ? '' : formatUsd(usd(BigInt(m))).slice(1).replace(/,/g, '');
  });
  const [budgetEdited, setBudgetEdited] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  const budgetMinor = parseBudgetField(budget);
  const isConfirmed = confirmed !== null && confirmed === budget && budgetMinor !== null;
  const budgetError = budget.trim() !== '' && budgetMinor === null ? 'Enter an amount like 400.00.' : null;

  function onMessage(v: string) {
    setMessage(v);
    setConfirmed(null);
    if (!budgetEdited) {
      const m = parseDeliveredBudget(v);
      setBudget(m === null ? '' : formatUsd(usd(BigInt(m))).slice(1).replace(/,/g, ''));
    }
  }

  function apply(e: Json) {
    setItems((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      const id = String(e.id ?? '');
      switch (e.type) {
        case 'text':
          if (last?.kind === 'text') next[next.length - 1] = { kind: 'text', text: last.text + String(e.text) };
          else next.push({ kind: 'text', text: String(e.text) });
          break;
        case 'tool-call': {
          const input = (e.input ?? {}) as Json;
          if (e.name === 'search_listings') next.push({ kind: 'search', id, query: String(input.query ?? '') });
          else if (e.name === 'compare_landed_costs') {
            // The comparison's rows arrive with its result; until then the quotes step shows as running.
            const qi = next.findIndex((x) => x.kind === 'quotes');
            if (qi >= 0) next[qi] = { ...(next[qi] as Extract<Item, { kind: 'quotes' }>), pendingCompare: id };
            else next.push({ kind: 'quotes', rows: [], pendingCompare: id });
          } else if (e.name === 'get_landed_cost_quote') {
            const qi = next.findIndex((x) => x.kind === 'quotes');
            const row: QuoteRow = { id, listingId: String(input.listingId ?? '') };
            if (qi >= 0) {
              const q = next[qi] as Extract<Item, { kind: 'quotes' }>;
              next[qi] = { kind: 'quotes', rows: [...q.rows, row] };
            } else next.push({ kind: 'quotes', rows: [row] });
          } else if (e.name === 'get_duty_breakdown') next.push({ kind: 'breakdown', id });
          else if (e.name === 'propose_purchase') next.push({ kind: 'proposal', id, reasoning: String(input.reasoning ?? '') });
          else next.push({ kind: 'other', id, name: String(e.name) });
          break;
        }
        case 'tool-result':
        case 'tool-error': {
          const out = e.type === 'tool-result' ? (e.output as Json) : undefined;
          const err = e.type === 'tool-error' ? String(e.error) : undefined;
          for (let i = 0; i < next.length; i++) {
            const it = next[i]!;
            if (it.kind === 'quotes') {
              if (it.pendingCompare === id) {
                // compare_landed_costs: one row per compared listing (already sorted by delivered total in code).
                const compared = ((out?.compared ?? []) as Json[]).map((o, k) => ({ id: `${id}-${k}`, listingId: String(o.listingId), out: { listingId: String(o.listingId), ...o } as QuoteRow['out'] }));
                const failed = err ?? (out?.error ? String(out.error) : undefined);
                next[i] = { kind: 'quotes', rows: [...it.rows, ...compared, ...(failed ? [{ id, listingId: '(comparison)', error: failed }] : [])] };
                continue;
              }
              const ri = it.rows.findIndex((r) => r.id === id);
              if (ri >= 0) {
                const rows = [...it.rows];
                // A refused single quote (listing not shown in a search) is a failed row with the code's message.
                const refused = out?.refused ? String(out.refused) : undefined;
                rows[ri] = { ...rows[ri]!, ...(out && !refused ? { out: { listingId: rows[ri]!.listingId, ...out } as QuoteRow['out'] } : {}), ...(err || refused ? { error: err ?? refused } : {}) };
                next[i] = { ...it, rows };
              }
            } else if ('id' in it && it.id === id) {
              if (it.kind === 'search')
                next[i] = {
                  ...it,
                  ...(out
                    ? { results: (out.results ?? []) as SearchResult[], catalogSize: Number(out.catalog_size ?? 0), withheld: Number(out.withheld_instructions ?? 0), unchecked: Number(out.withheld_unchecked_script ?? 0) }
                    : {}),
                  ...(err ? { error: err } : {}),
                };
              else next[i] = { ...it, ...(out ? { out } : {}), ...(err ? { error: err } : {}) } as Item;
            }
          }
          break;
        }
        case 'error':
          setError(String(e.message));
          return markStopped(next);
        case 'done':
          setDone(e as unknown as Done);
          break;
        default:
          break;
      }
      return next;
    });
  }

  async function run() {
    if (!isConfirmed) return;
    setItems([]);
    setDone(null);
    setError(null);
    setRunning(true);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, budget }) });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(res.status === 429 ? `Run limit reached: ${j.error ?? 'try again later'}.` : (j.error ?? `the server answered ${res.status}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) apply(JSON.parse(line) as Json);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems(markStopped);
    } finally {
      setRunning(false);
    }
  }

  const quoteRows = items.flatMap((it) => (it.kind === 'quotes' ? it.rows : []));
  const quoteViews = quoteRows.flatMap((r) => (r.out ? [r.out as QuoteView] : []));
  const proposalItem = items.find((it): it is Extract<Item, { kind: 'proposal' }> => it.kind === 'proposal');
  const proposalOut = proposalItem?.out;
  const proposedQuote = proposalOut?.proposed === true ? quoteRows.find((r) => (r.out as Json | undefined)?.quoteId === proposalOut.quoteId)?.out : undefined;
  const firstTextIndex = items.findIndex((it) => it.kind === 'text');

  return (
    <div className={s.page}>
      <PageHeader title="Shopping agent" lead="Compares delivered prices (goods, shipping and estimated US import duty) and prepares a purchase for you to approve." />

      <section className={s.request} aria-label="Request">
        <Field id="msg" label="What are you looking for?">
          <Textarea data-testid="agent-message" value={message} onChange={(e) => onMessage(e.target.value)} disabled={running} rows={2} />
        </Field>
        <Field
          id="budget"
          label="Budget, delivered (USD)"
          prefix="$"
          error={budgetError}
          after={
            isConfirmed ? (
              <span className={s.confirmedRow}>
                <StatusBadge tone="success" data-testid="agent-budget-confirmed">
                  Budget confirmed: {budgetText(budgetMinor!)} delivered
                </StatusBadge>
                <Button variant="ghost" size="sm" onClick={() => setConfirmed(null)} disabled={running}>
                  Change
                </Button>
              </span>
            ) : (
              <Button data-testid="agent-confirm-budget" disabled={budgetMinor === null || running} onClick={() => setConfirmed(budget)}>
                Confirm budget
              </Button>
            )
          }
        >
          <Input
            data-testid="agent-budget"
            inputMode="decimal"
            value={budget}
            disabled={running}
            onChange={(e) => {
              setBudget(e.target.value);
              setBudgetEdited(true);
              setConfirmed(null);
            }}
          />
        </Field>
        <p className={s.hint}>
          {budgetMinor === null
            ? "Enter a budget to continue. The agent can't run without one."
            : "Delivered = goods + shipping + estimated US import duty. The budget and spend caps are checked in code; the agent can't change them."}
        </p>
        <div className={s.runRow}>
          <Button variant="primary" data-testid="agent-run" disabled={!isConfirmed || message.trim().length < 3} loading={running} onClick={run} aria-describedby={!isConfirmed ? 'run-why' : undefined}>
            Run comparison
          </Button>
          {!isConfirmed && !running ? (
            <span id="run-why" className={s.hint}>
              Confirm the budget to run the comparison.
            </span>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className={s.error} role="alert">
          <Icon name="x-circle" />
          <span>The comparison stopped: {error.replace(/[.\s]+$/, '')}. Run it again; nothing was bought.</span>
        </div>
      ) : null}

      {items.length ? (
        <div role="log" aria-label="Agent steps">
        <ol className={s.log}>
          {items.map((it, i) => {
            if (it.kind === 'text') {
              return (
                <li key={i} className={s.textItem}>
                  {i === firstTextIndex ? <span className={s.textLabel}>Agent&rsquo;s explanation</span> : null}
                  <p className={s.text} data-testid="agent-text">
                    <Bold text={it.text} />
                  </p>
                </li>
              );
            }
            if (it.kind === 'search') {
              // Rendered exactly as the tool returned it (the tool returns only matches; no second filter here).
              const matching = it.results ?? [];
              const notice = it.results ? withheldNotice(it.withheld) : null;
              const uncheckedNotice = it.results ? uncheckedScriptNotice(it.unchecked) : null;
              return (
                <ToolCallStep
                  key={i}
                  state={it.error ? 'failed' : it.results ? 'done' : 'running'}
                  title={<>Searched listings for &ldquo;{it.query}&rdquo;</>}
                  meta={it.results ? `${matching.length} of ${it.catalogSize || matching.length} match` : 'Searching…'}
                >
                  {it.error ? <p className={s.failed}>This step failed: {it.error}</p> : null}
                  {it.results ? (
                    <div className={s.scroll} role="region" aria-label="Matching listings" tabIndex={0}>
                      <table className={s.table} data-testid="agent-search">
                        <caption className={s.caption}>Matching listings</caption>
                        <thead>
                          <tr>
                            <th scope="col">Listing</th>
                            <th scope="col">Origin</th>
                            <th scope="col" className={s.num}>Goods (USD)</th>
                            <th scope="col" className={s.num}>Shipping (USD)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matching.map((r) => {
                            const m = r.match_source === 'hts_description' ? r.hts_match : undefined;
                            return (
                              <Fragment key={r.listingId}>
                                <tr className={m ? s.hasMatch : undefined}>
                                  <th scope="row">
                                    <span className={s.mono}>{r.listingId}</span>
                                    <span className={s.sub} lang={titleLang(r.untrusted_seller_text.title)}>
                                      {r.untrusted_seller_text.title}
                                    </span>
                                  </th>
                                  <td>{r.origin}</td>
                                  <td className={s.num}>{r.goods.replace(/^\$/, '')}</td>
                                  <td className={s.num}>{r.shipping.replace(/^\$/, '')}</td>
                                </tr>
                                {m ? (
                                  // Full table width (readable at 375 px), directly under the listing it explains.
                                  <tr className={s.matchRow}>
                                    <td colSpan={4}>
                                      <HtsMatchLine listingId={r.listingId} m={m} />
                                    </td>
                                  </tr>
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {notice ? (
                    <StatusBadge tone="warning" data-testid="agent-instruction-notice">
                      {notice}
                    </StatusBadge>
                  ) : null}
                  {uncheckedNotice ? (
                    <StatusBadge tone="warning" data-testid="agent-unchecked-notice">
                      {uncheckedNotice}
                    </StatusBadge>
                  ) : null}
                </ToolCallStep>
              );
            }
            if (it.kind === 'quotes') {
              const pending = it.rows.filter((r) => !r.out && !r.error).length + (it.pendingCompare ? 1 : 0);
              const version = it.rows.find((r) => r.out)?.out as Json | undefined;
              return (
                <ToolCallStep
                  key={i}
                  state={pending ? 'running' : it.rows.some((r) => r.error) ? 'failed' : 'done'}
                  title={it.pendingCompare && !it.rows.length ? 'Comparing landed costs…' : `Quoted ${it.rows.length} ${it.rows.length === 1 ? 'listing' : 'listings'}`}
                  meta={version?.rate_version ? `rate version ${String(version.rate_version)}` : 'Quoting…'}
                >
                  <QuotesTable rows={it.rows} pending={0} />
                  {!pending ? <InsightLine rows={it.rows.flatMap((r) => (r.out ? [r.out as QuoteView] : []))} /> : null}
                </ToolCallStep>
              );
            }
            if (it.kind === 'breakdown') {
              const o = it.out;
              return (
                <ToolCallStep
                  key={i}
                  state={it.error ? 'failed' : o ? 'done' : 'running'}
                  title={o ? `Read the duty breakdown for ${String(o.listingId)} (${String(o.origin)})` : 'Reading the duty breakdown…'}
                  meta={o ? `HTS ${String(o.hts)}` : undefined}
                >
                  {it.error ? <p className={s.failed}>This step failed: {it.error}</p> : null}
                  {o ? (
                    <DutyBreakdown
                      hts={String(o.hts)}
                      lines={(o.duty_lines ?? []) as BreakdownLine[]}
                      total={String(o.us_import_duty_est)}
                      htsRevision={o.hts_revision ? String(o.hts_revision) : undefined}
                      verifiedOn={o.verified_on ? String(o.verified_on) : undefined}
                      rateVersion={o.rate_version ? String(o.rate_version) : undefined}
                    />
                  ) : null}
                </ToolCallStep>
              );
            }
            if (it.kind === 'proposal') {
              const o = it.out;
              return (
                <ToolCallStep
                  key={i}
                  state={it.error ? 'failed' : o ? (o.proposed === true ? 'done' : 'failed') : 'running'}
                  title={o?.proposed === true && proposedQuote ? `Prepared a purchase for ${proposedQuote.listingId} (${proposedQuote.origin ?? ''})` : o ? 'Tried to prepare a purchase' : 'Preparing a purchase…'}
                >
                  {it.error ? <p className={s.failed}>This step failed: {it.error}</p> : null}
                </ToolCallStep>
              );
            }
            return (
              <ToolCallStep key={i} state={it.error ? 'failed' : it.out ? 'done' : 'running'} title={it.name}>
                {it.error ? <p className={s.failed}>This step failed: {it.error}</p> : null}
              </ToolCallStep>
            );
          })}
        </ol>
        </div>
      ) : null}

      {proposalOut ? (
        <ProposalSummary
          proposed={proposalOut.proposed === true}
          listingId={proposedQuote?.listingId}
          origin={proposedQuote?.origin}
          title={(proposedQuote as { untrusted_seller_text?: { title?: string } } | undefined)?.untrusted_seller_text?.title}
          delivered={proposalOut.delivered_total ? String(proposalOut.delivered_total) : undefined}
          budget={proposalOut.budget ? String(proposalOut.budget) : undefined}
          checkoutUrl={proposalOut.checkoutUrl ? String(proposalOut.checkoutUrl) : undefined}
          reasoning={proposalItem?.reasoning}
          refusal={proposalOut.message ? String(proposalOut.message) : undefined}
        />
      ) : null}

      {done ? (
        <p className={s.footer} data-testid="agent-done">
          {done.steps} steps · {(done.ms / 1000).toFixed(1)} s · {done.usage.input.toLocaleString('en-US')} input / {done.usage.output.toLocaleString('en-US')} output tokens
        </p>
      ) : null}

      <p role="status" className="sr-only">
        {done ? runSummary(quoteViews, proposalOut?.proposed === true && proposedQuote ? { listingId: proposedQuote.listingId, delivered_total: String(proposalOut.delivered_total) } : null) : ''}
      </p>
    </div>
  );
}
