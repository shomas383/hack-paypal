'use client';

// /agent — the buyer agent UI (SPEC §4.4). Every number on the cards comes from a tool result (stored quotes computed by the
// rate engine) or from code; the agent's streamed text is shown as text only. The seller-instructions notice is generated
// here from the search flags (instructionNotice), never by the model. The agent can only PREPARE a purchase: the proposal
// card links to the checkout, where the buyer approves and pays with PayPal.
import { Fragment, useState, type ReactNode } from 'react';
import { parseBudgetField, parseDeliveredBudget } from '@/domain/agent/checks';
import { instructionNotice } from '@/domain/agent/instructionNotice';
import s from './agent.module.css';

type Json = Record<string, unknown>;
type SearchResult = { listingId: string; origin: string; goods: string; shipping: string; match_score: number; seller_text_contains_instructions: boolean; untrusted_seller_text: { title: string; description: string | null } };
type DutyLine = { kind?: string; chapter99: string | null; amount: string; basis: string; source: string; official_text: string | null };

type Item =
  | { kind: 'text'; text: string }
  | { kind: 'search'; id: string; query: string; results?: SearchResult[]; error?: string }
  | { kind: 'quotes'; rows: { id: string; listingId: string; out?: Json; error?: string }[] }
  | { kind: 'breakdown'; id: string; out?: Json; error?: string }
  | { kind: 'proposal'; id: string; reasoning: string; out?: Json; error?: string }
  | { kind: 'other'; id: string; name: string; out?: unknown; error?: string };

type Done = { steps: number; usage: { input: number; output: number }; ms: number };

const centsLabel = (minor: number) => `$${(minor / 100).toFixed(2)}`;

function Bold({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

function Card({ n, title, children, className }: { n: number; title: string; children: ReactNode; className?: string | undefined }) {
  return (
    <section className={`${s.card} ${className ?? ''}`}>
      <h3 className={s.cardTitle}>
        <span className={s.step}>{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function AgentClient() {
  const [message, setMessage] = useState('vintage automatic diver watch under $400 delivered');
  const [budget, setBudget] = useState(() => {
    const m = parseDeliveredBudget('vintage automatic diver watch under $400 delivered');
    return m === null ? '' : (m / 100).toFixed(2);
  });
  const [budgetEdited, setBudgetEdited] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  const budgetMinor = parseBudgetField(budget);
  const isConfirmed = confirmed !== null && confirmed === budget && budgetMinor !== null;

  function onMessage(v: string) {
    setMessage(v);
    setConfirmed(null);
    if (!budgetEdited) {
      const m = parseDeliveredBudget(v);
      setBudget(m === null ? '' : (m / 100).toFixed(2));
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
          else if (e.name === 'get_landed_cost_quote') {
            const qi = next.findIndex((x) => x.kind === 'quotes');
            const row = { id, listingId: String(input.listingId ?? '') };
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
              const ri = it.rows.findIndex((r) => r.id === id);
              if (ri >= 0) {
                const rows = [...it.rows];
                rows[ri] = { ...rows[ri]!, ...(out ? { out } : {}), ...(err ? { error: err } : {}) };
                next[i] = { kind: 'quotes', rows };
              }
            } else if ('id' in it && it.id === id) {
              if (it.kind === 'search') next[i] = { ...it, ...(out ? { results: (out.results ?? []) as SearchResult[] } : {}), ...(err ? { error: err } : {}) };
              else next[i] = { ...it, ...(out ? { out } : {}), ...(err ? { error: err } : {}) } as Item;
            }
          }
          break;
        }
        case 'error':
          setError(String(e.message));
          break;
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
      const res = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, budget }) });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
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
    } finally {
      setRunning(false);
    }
  }

  let n = 0;
  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <h1>
            Shopping agent <span className={s.sandbox}>PayPal sandbox</span>
          </h1>
          <nav>
            <a href="/listings">Listings</a>
          </nav>
        </header>

        <section className={`${s.card} ${s.form}`}>
          <label htmlFor="msg">What are you looking for?</label>
          <textarea id="msg" data-testid="agent-message" value={message} onChange={(e) => onMessage(e.target.value)} disabled={running} />
          <div className={s.row}>
            <div className={s.budgetField}>
              <label htmlFor="budget">Budget, delivered (USD)</label>
              <div className={s.budgetInput}>
                <span>$</span>
                <input
                  id="budget"
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
              </div>
            </div>
            {isConfirmed ? (
              <span className={s.confirmed} data-testid="agent-budget-confirmed">
                ✓ Budget confirmed: {centsLabel(budgetMinor!)} delivered
              </span>
            ) : (
              <button type="button" data-testid="agent-confirm-budget" className={`${s.btn} ${s.btnSecondary}`} disabled={budgetMinor === null || running} onClick={() => setConfirmed(budget)}>
                Confirm budget
              </button>
            )}
            <button type="button" data-testid="agent-run" className={`${s.btn} ${s.btnPrimary}`} disabled={!isConfirmed || running || message.trim().length < 3} onClick={run}>
              {running ? 'Working…' : 'Find and compare'}
            </button>
          </div>
          <p className={s.hint}>
            {budgetMinor === null
              ? 'Enter a budget to continue. The agent cannot run without one.'
              : 'Delivered = goods + shipping + estimated US import duty. Budget and spend caps are enforced by code, not by the agent.'}
          </p>
        </section>

        {error ? <p className={s.error} role="alert">{error}</p> : null}

        {items.map((it, i) => {
          if (it.kind === 'text') {
            return (
              <p key={i} className={s.text} data-testid="agent-text">
                <Bold text={it.text} />
              </p>
            );
          }
          n++;
          if (it.kind === 'search') {
            const notice = it.results ? instructionNotice(it.results) : null;
            return (
              <Card key={i} n={n} title={`Searched listings — “${it.query}”`}>
                {!it.results && !it.error ? <p className={s.muted}>Searching…</p> : null}
                {it.error ? <p className={s.error}>{it.error}</p> : null}
                {it.results ? (
                  <table className={s.table} data-testid="agent-search">
                    <thead>
                      <tr>
                        <th>Listing</th>
                        <th>Origin</th>
                        <th className={s.num}>Goods</th>
                        <th className={s.num}>Shipping</th>
                      </tr>
                    </thead>
                    <tbody>
                      {it.results.filter((r) => r.match_score > 0).map((r) => (
                        <tr key={r.listingId}>
                          <td>
                            <span className={s.code}>{r.listingId}</span> <span className={s.muted}>{r.untrusted_seller_text.title}</span>
                          </td>
                          <td>{r.origin}</td>
                          <td className={s.num}>{r.goods}</td>
                          <td className={s.num}>{r.shipping}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {it.results ? (
                  <p className={`${s.small} ${s.muted}`}>
                    {it.results.filter((r) => r.match_score > 0).length} matching of {it.results.length} listings in the catalog.
                  </p>
                ) : null}
                {notice ? (
                  <p className={s.notice} data-testid="agent-instruction-notice">
                    {notice}
                  </p>
                ) : null}
              </Card>
            );
          }
          if (it.kind === 'quotes') {
            return (
              <Card key={i} n={n} title="Landed-cost quotes compared">
                <table className={s.table} data-testid="agent-quotes">
                  <thead>
                    <tr>
                      <th>Listing</th>
                      <th>Origin</th>
                      <th>HTS</th>
                      <th className={s.num}>Goods</th>
                      <th className={s.num}>Shipping</th>
                      <th className={s.num}>US import duty (est.)</th>
                      <th className={s.num}>Delivered</th>
                      <th>Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {it.rows.map((r) => {
                      const o = r.out;
                      if (!o) return (
                        <tr key={r.id}>
                          <td className={s.code}>{r.listingId}</td>
                          <td colSpan={7} className={s.muted}>{r.error ?? 'Quoting…'}</td>
                        </tr>
                      );
                      if (o.unsupported) return (
                        <tr key={r.id}>
                          <td className={s.code}>{r.listingId}</td>
                          <td colSpan={7} className={s.muted}>Not quotable: {String(o.unsupported)}</td>
                        </tr>
                      );
                      return (
                        <tr key={r.id} data-testid={`agent-quote-${r.listingId}`}>
                          <td className={s.code}>{r.listingId}</td>
                          <td>{String(o.origin)}</td>
                          <td className={s.code}>{String(o.hts)}</td>
                          <td className={s.num}>{String(o.goods)}</td>
                          <td className={s.num}>{String(o.shipping)}</td>
                          <td className={s.num}>{String(o.us_import_duty_est)}</td>
                          <td className={s.num}>
                            <strong>{String(o.delivered_total)}</strong>
                          </td>
                          <td>{o.within_budget ? <span className={s.badgeOk}>✓ within</span> : <span className={s.badgeBad}>✗ over</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className={`${s.small} ${s.muted}`}>Amounts are stored quotes from the verified rate table; “within” is checked in code against your confirmed budget.</p>
              </Card>
            );
          }
          if (it.kind === 'breakdown') {
            const o = it.out;
            const lines = (o?.duty_lines ?? []) as DutyLine[];
            return (
              <Card key={i} n={n} title={o ? `Duty breakdown — ${String(o.listingId)} (${String(o.origin)})` : 'Duty breakdown'}>
                {!o && !it.error ? <p className={s.muted}>Reading…</p> : null}
                {it.error ? <p className={s.error}>{it.error}</p> : null}
                {o ? (
                  <div data-testid="agent-breakdown">
                    {lines.map((l, j) => (
                      <div key={j} className={s.dutyLine}>
                        <div className={s.dutyHead}>
                          <span>
                            {l.chapter99 ? <>Chapter 99 heading <span className={s.code}>{l.chapter99}</span></> : <>HTS <span className={s.code}>{String(o.hts)}</span> (column 1 General)</>}
                          </span>
                          <span className={s.num}>{l.amount}</span>
                        </div>
                        <div className={`${s.small} ${s.muted}`}>
                          {l.basis} · source: {l.source}
                        </div>
                        {l.official_text ? <blockquote className={s.official}>“{l.official_text}”</blockquote> : null}
                      </div>
                    ))}
                    <div className={s.dutyHead} style={{ borderTop: '1px solid var(--line)', paddingTop: '0.5rem' }}>
                      <span>US import duty (est.)</span>
                      <span className={s.num}>{String(o.us_import_duty_est)}</span>
                    </div>
                    <p className={`${s.small} ${s.muted}`}>
                      HTS {String(o.hts_revision ?? '')}, rate row verified {String(o.verified_on ?? '')} · rate version {String(o.rate_version)}. Estimate, not a customs ruling.
                    </p>
                  </div>
                ) : null}
              </Card>
            );
          }
          if (it.kind === 'proposal') {
            const o = it.out;
            const ok = o?.proposed === true;
            return (
              <Card key={i} n={n} title={ok ? 'Proposed by your agent' : 'Proposal'} className={o && !ok ? s.refusal : s.proposal}>
                {!o && !it.error ? <p className={s.muted}>Preparing…</p> : null}
                {it.error ? <p className={s.error}>{it.error}</p> : null}
                {o && ok ? (
                  <div data-testid="agent-proposal">
                    <div className={s.proposalTotal}>{String(o.delivered_total)}</div>
                    <div className={s.muted}>delivered · your confirmed budget {String(o.budget)}</div>
                    {it.reasoning ? (
                      <p className={s.small}>
                        <span className={s.muted}>Agent’s reasoning: </span>
                        {it.reasoning}
                      </p>
                    ) : null}
                    <p className={s.small}>
                      Nothing is bought yet. Review the duty lines on the checkout, then approve and pay with your own PayPal login.
                    </p>
                    <a className={s.cta} href={String(o.checkoutUrl)} data-testid="agent-checkout-link">
                      Review at checkout →
                    </a>
                  </div>
                ) : null}
                {o && !ok ? (
                  <p data-testid="agent-refusal">
                    <strong>Refused by code:</strong> {String(o.message)}
                  </p>
                ) : null}
              </Card>
            );
          }
          return (
            <Card key={i} n={n} title={it.name}>
              <pre className={s.small}>{JSON.stringify(it.out ?? it.error ?? 'Working…', null, 1)}</pre>
            </Card>
          );
        })}

        {done ? (
          <p className={s.footer} data-testid="agent-done">
            {done.steps} steps · {(done.ms / 1000).toFixed(1)} s · {done.usage.input.toLocaleString()} input / {done.usage.output.toLocaleString()} output tokens
          </p>
        ) : null}
      </div>
    </div>
  );
}
