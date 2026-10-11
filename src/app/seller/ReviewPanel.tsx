'use client';
// One classification under review: the proposed line with its official chain, reasons in plain words, the questions code
// generated from the official chains, the actions (accept / override / publish) and the audit trail. Accept and override
// are optimistic with a 6 s Undo; publish asks for confirmation (and the case/band split when the line needs it).
import { useEffect, useRef, useState } from 'react';
import { citesStatisticalNumber } from '@/domain/classifier/questions';
import { parseUsdInput } from '@/domain/seller/form';
import { usd } from '@/domain/money/money';
import { formatUsd } from '@/lib/money';
import { Button } from '@/ui/Button';
import { Disclosure } from '@/ui/Disclosure';
import { officialChain } from '@/ui/dutyText';
import { Field, Input, Select } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { StatusBadge } from '@/ui/StatusBadge';
import { Toast } from '@/ui/Toast';
import { classificationStatus, reasonText } from '@/ui/reasonText';
import s from './seller.module.css';

interface Detail {
  id: string;
  status: string;
  input: { title: string; description?: string; origin: string | null };
  reasons: string[];
  threshold: number;
  top: { hts10: string; confidence: number; rationale: string; evidence: string[]; chain: string[]; componentReporting: boolean } | null;
  others: { hts10: string; confidence: number; chain: string[] }[];
  separatingAttributes: { name: string; value_from_listing: string | null }[];
  hts10: string | null;
  priceMinor: string;
  shippingMinor: string;
  listingId: string | null;
  questions: { choices: { id: string; text: string; options: { id: string; text: string; codes: string[] }[] }[]; exclusions: { code: string; text: string }[] };
  answers: Record<string, string>;
  exclusionsApply: boolean | null;
  statements: { question: string; answer: string; at: string }[];
  actions: { id: string; action: string; fromStatus: string; toStatus: string; fromHts10: string | null; toHts10: string | null; reason: string | null; at: string; undone: boolean; by: string }[];
  expanded: { code: string; chain: string[] }[];
  suggested: string | null;
  publish: { code: string | null; needsSplit: boolean; verifiedRate: boolean };
  quote: { quotable: true; dutyMinor: string; deliveredMinor: string } | { quotable: false; reason: string } | null;
}

const money = (minor: string) => formatUsd(usd(BigInt(minor)));
const NOT_SURE = 'not-sure'; // UI-only choice: never sent, never recorded
const timeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const ACTION_TEXT: Record<string, string> = { accept: 'Accepted', override: 'Overridden', publish: 'Published', answers: 'Routing reran after answers' };

async function call<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `the server answered ${res.status}`);
  return j;
}

export function ReviewPanel({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [excl, setExcl] = useState<boolean | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ovCode, setOvCode] = useState('');
  const [ovReason, setOvReason] = useState('');
  const [ovError, setOvError] = useState<string | null>(null);
  const [split, setSplit] = useState({ case: '', band: '' });
  const [pubError, setPubError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const apply = (next: Detail) => {
    setD(next);
    setDraft(next.answers);
    setExcl(next.exclusionsApply);
  };

  useEffect(() => {
    let stop = false;
    fetch(`/api/seller/classifications/${id}`, { cache: 'no-store' })
      .then(async (res) => {
        const j = (await res.json()) as Detail & { error?: string };
        if (stop) return;
        if (!res.ok) return setError(j.error ?? `the server answered ${res.status}`);
        apply(j);
        heading.current?.focus();
      })
      .catch(() => !stop && setError("This classification didn't load. Check your connection and try again."));
    return () => {
      stop = true;
    };
  }, [id]);

  async function act(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (error && !d) {
    return (
      <aside className={s.panel} aria-label="Classification">
        <p role="alert" className={s.error}>
          <Icon name="x-circle" />
          <span>{error}</span>
        </p>
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </aside>
    );
  }
  if (!d) {
    return (
      <aside className={s.panel} aria-label="Classification" aria-busy="true">
        <p className={s.muted}>Loading the classification…</p>
      </aside>
    );
  }

  const st = classificationStatus(d.status);
  const missing = d.separatingAttributes.filter((a) => a.value_from_listing === null).map((a) => a.name);
  const settledCode = d.hts10 ?? d.top?.hts10 ?? null;
  // Auto-accepted items are already settled: no Accept, Publish is the primary action (Override stays available).
  const canAccept = d.status === 'PENDING_REVIEW';
  const canOverride = ['PENDING_REVIEW', 'AUTO_ACCEPTED', 'ACCEPTED', 'OVERRIDDEN'].includes(d.status) && d.expanded.length > 0;
  const canPublish = ['AUTO_ACCEPTED', 'ACCEPTED', 'OVERRIDDEN'].includes(d.status);
  const canAnswer = canOverride && (d.questions.choices.length > 0 || d.questions.exclusions.length > 0);

  const accept = () =>
    act('accept', async () => {
      setD({ ...d, status: 'ACCEPTED', hts10: settledCode }); // optimistic
      const r = await call<{ actionId: string; detail: Detail }>(`/api/seller/classifications/${id}/accept`);
      apply(r.detail);
      setToast({ message: `Accepted ${r.detail.hts10 ?? ''}.`, undo: r.actionId });
    });

  const override = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ovCode) return setOvError('Choose a code from the official lines.');
    if (ovReason.trim().length < 3) return setOvError('Give a reason for the override.');
    setOvError(null);
    void act('override', async () => {
      const prev = d;
      setD({ ...d, status: 'OVERRIDDEN', hts10: ovCode }); // optimistic
      try {
        const r = await call<{ actionId: string; detail: Detail }>(`/api/seller/classifications/${id}/override`, { hts10: ovCode, reason: ovReason.trim() });
        apply(r.detail);
        setOverrideOpen(false);
        setToast({ message: `Overridden to ${ovCode}.`, undo: r.actionId });
      } catch (err) {
        setD(prev);
        throw err;
      }
    });
  };

  const undo = (actionId: string) =>
    act('undo', async () => {
      setToast(null);
      apply(await call<Detail>(`/api/seller/classifications/${id}/undo`, { actionId }));
      setToast({ message: 'Undone.' });
    });

  const saveAnswers = () =>
    act('answers', async () => {
      // "Not sure" records nothing: only real answers that changed are sent.
      const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== NOT_SURE && d.answers[k] !== v));
      apply(await call<Detail>(`/api/seller/classifications/${id}/answers`, { answers: changed, exclusionsApply: excl === d.exclusionsApply ? null : excl }));
      setToast({ message: 'Answers saved. Review reasons updated.' });
    });

  const publish = (e: React.FormEvent) => {
    e.preventDefault();
    let valueSplit: { caseMinor: number; bandMinor: number } | null = null;
    if (d.publish.needsSplit) {
      const c = parseUsdInput(split.case);
      const b = parseUsdInput(split.band);
      if (c === null || b === null) return setPubError('Enter a case value and a band value like 250.00.');
      if (c + b !== Number(d.priceMinor)) return setPubError(`Case and band values must add up to the price (${money(d.priceMinor)}).`);
      valueSplit = { caseMinor: c, bandMinor: b };
    }
    setPubError(null);
    void act('publish', async () => {
      try {
        apply(await call<Detail>(`/api/seller/classifications/${id}/publish`, { valueSplit }));
        dialog.current?.close();
      } catch (err) {
        setPubError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <aside className={s.panel} aria-labelledby="panel-h" data-testid="review-panel">
      <div className={s.panelHead}>
        <h2 id="panel-h" ref={heading} tabIndex={-1} className={s.panelTitle}>
          {d.input.title}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className={s.muted}>
        Origin {d.input.origin ?? 'unknown'} · price {money(d.priceMinor)} · shipping {money(d.shippingMinor)}
      </p>
      <StatusBadge tone={st.tone} data-testid="review-status">
        {st.text}
      </StatusBadge>

      {d.top ? (
        <div className={s.block}>
          <p className={s.proposed}>
            Proposed <span className={s.mono}>{d.top.hts10}</span>
            <span className={s.confidence}>
              <span className={s.muted}>confidence</span> {d.top.confidence.toFixed(2)}
            </span>
          </p>
          <p className={s.chain}>{officialChain(d.top.chain)}</p>
          {d.hts10 && d.hts10 !== d.top.hts10 ? (
            <p>
              Settled code: <span className={s.mono}>{d.hts10}</span>
            </p>
          ) : null}
        </div>
      ) : (
        <p className={s.muted}>No line was proposed.</p>
      )}

      {d.reasons.length ? (
        <ul className={s.reasons} aria-label="Why it needs review">
          {d.reasons.map((r) => (
            <li key={r}>{reasonText(r, { confidence: d.top?.confidence ?? null, threshold: d.threshold, missing })}</li>
          ))}
        </ul>
      ) : null}
      {d.suggested ? (
        <p>
          Your answers point to <span className={s.mono}>{d.suggested}</span>. Override the code if that&rsquo;s right.
        </p>
      ) : null}

      {canAnswer ? (
        <form
          className={s.block}
          aria-labelledby="q-h"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAnswers();
          }}
        >
          <h3 id="q-h" className={s.h3}>
            Questions for the seller
          </h3>
          <p className={s.muted}>Built by code from the official HTS descriptions. Your answers are recorded as statements; &ldquo;Not sure&rdquo; records nothing.</p>
          {d.questions.choices.map((q) => {
            // An option that cites a statistical reporting number: the seller may not know, and "Not sure" is safe.
            const statHint = q.options.some((o) => citesStatisticalNumber(o.text));
            return (
              <fieldset key={q.id} className={s.fieldset} aria-describedby={statHint ? `${q.id}-hint` : undefined}>
                <legend>{q.text}</legend>
                {statHint ? (
                  <p id={`${q.id}-hint`} className={s.questionHint} data-testid="question-stat-hint">
                    If you don&rsquo;t know, choose Not sure &mdash; the listing stays in review.
                  </p>
                ) : null}
                {[...q.options, { id: NOT_SURE, text: 'Not sure', codes: [] }].map((o) => (
                  <label key={o.id} className={s.radio}>
                    <input type="radio" name={q.id} value={o.id} checked={(draft[q.id] ?? NOT_SURE) === o.id} onChange={() => setDraft({ ...draft, [q.id]: o.id })} />
                    <span>{o.text}</span>
                  </label>
                ))}
              </fieldset>
            );
          })}
          {d.questions.exclusions.length ? (
            <fieldset className={s.fieldset}>
              <legend>Do any of these apply to the item?</legend>
              <ul className={s.exclusions}>
                {d.questions.exclusions.map((x) => (
                  <li key={x.code}>
                    <span className={s.mono}>{x.code}</span> {x.text}
                  </li>
                ))}
              </ul>
              <label className={s.radio}>
                <input type="radio" name="exclusions" checked={excl === true} onChange={() => setExcl(true)} />
                <span>None of these apply to this item.</span>
              </label>
              <label className={s.radio}>
                <input type="radio" name="exclusions" checked={excl === false} onChange={() => setExcl(false)} />
                <span>One of these applies.</span>
              </label>
            </fieldset>
          ) : null}
          <div>
            <Button type="submit" loading={busy === 'answers'} disabled={busy !== null}>
              Save answers
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className={s.error}>
          <Icon name="x-circle" />
          <span>{error}</span>
        </p>
      ) : null}

      {!settledCode && d.status !== 'PUBLISHED' ? (
        <p className={s.muted} data-testid="review-no-line">
          There is no official line to accept or override. Add detail to the listing (for example the material) and classify it again.
        </p>
      ) : null}

      {d.status === 'PUBLISHED' ? (
        <div className={s.block} data-testid="publish-result">
          <StatusBadge tone="success">Published as {d.listingId}</StatusBadge>
          {d.quote?.quotable ? (
            <p>
              Quotable: <strong>{money(d.quote.deliveredMinor)}</strong> delivered at {money(d.priceMinor)} (duty {money(d.quote.dutyMinor)}, shipping {money(d.shippingMinor)}).
            </p>
          ) : (
            <p>{d.quote && !d.quote.quotable ? d.quote.reason : 'No verified rate yet.'}</p>
          )}
        </div>
      ) : (
        // Primary action first (Accept, or Publish once settled), then Override.
        <div className={s.actions}>
          {canAccept && settledCode ? (
            <Button variant="primary" onClick={accept} loading={busy === 'accept'} disabled={busy !== null || !settledCode} data-testid="review-accept">
              Accept classification
            </Button>
          ) : null}
          {canPublish ? (
            <Button variant={canAccept ? 'secondary' : 'primary'} onClick={() => dialog.current?.showModal()} disabled={busy !== null} data-testid="review-publish">
              Publish listing…
            </Button>
          ) : null}
          {canOverride ? (
            <Button onClick={() => setOverrideOpen((v) => !v)} aria-expanded={overrideOpen} disabled={busy !== null}>
              Override code…
            </Button>
          ) : null}
        </div>
      )}

      {overrideOpen ? (
        <form className={s.block} onSubmit={override} aria-label="Override code" noValidate>
          <Field id="ov-code" label="Code (official lines this classification matched)" error={ovError && !ovCode ? ovError : null}>
            <Select value={ovCode} onChange={(e) => setOvCode(e.target.value)}>
              <option value="">Choose a line…</option>
              {d.expanded.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code} · {officialChain(x.chain.slice(-1))}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ov-reason" label="Reason" error={ovError && ovCode ? ovError : null}>
            <Input value={ovReason} onChange={(e) => setOvReason(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" loading={busy === 'override'} disabled={busy !== null}>
              Override code
            </Button>
          </div>
        </form>
      ) : null}

      <Disclosure summary={`Candidates (${(d.top ? 1 : 0) + d.others.length})`}>
        <ul className={s.others}>
          {d.top ? (
            <li>
              <span className={s.mono}>{d.top.hts10}</span> · confidence {d.top.confidence.toFixed(2)}
              <span className={s.chainSmall}>{officialChain(d.top.chain)}</span>
              {d.top.evidence.length ? <span className={s.chainSmall}>Evidence (checked by code): {d.top.evidence.map((q) => `“${q}”`).join(' · ')}</span> : null}
            </li>
          ) : null}
          {d.others.map((o) => (
            <li key={o.hts10}>
              <span className={s.mono}>{o.hts10}</span> · confidence {o.confidence.toFixed(2)}
              <span className={s.chainSmall}>{officialChain(o.chain)}</span>
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure summary={`Audit trail (${d.actions.length + d.statements.length})`}>
        <ol className={s.audit}>
          {[
            ...d.statements.map((x) => ({ at: x.at, text: `Answered “${x.question}”: ${x.answer}` })),
            ...d.actions.map((a) => ({
              at: a.at,
              text: `${ACTION_TEXT[a.action] ?? a.action}${a.toHts10 ? ` ${a.toHts10}` : ''}${a.reason && a.action === 'override' ? ` (“${a.reason}”)` : ''} by seller session …${a.by}${a.undone ? ' · undone' : ''}`,
            })),
          ]
            .sort((a, b) => a.at.localeCompare(b.at))
            .map((x, i) => (
              <li key={i}>
                <time dateTime={x.at}>{timeFmt.format(new Date(x.at))}</time> · {x.text}
              </li>
            ))}
        </ol>
      </Disclosure>

      <dialog ref={dialog} className={s.dialog} aria-labelledby="pub-h">
        <form onSubmit={publish} noValidate>
          <h3 id="pub-h" className={s.h3}>
            Publish listing
          </h3>
          <p>
            Publish &lsquo;{d.input.title}&rsquo; as <span className={s.mono}>{settledCode}</span>? It becomes quotable only if a verified rate row exists for {d.input.origin ?? 'its origin'} + {settledCode}.
          </p>
          {!d.publish.verifiedRate ? <p className={s.muted}>There is no verified rate row for this origin and line yet, so buyers will see it without a price.</p> : null}
          {d.publish.needsSplit ? (
            <div className={s.row2}>
              <p className={s.muted}>This line is reported by component: enter the case and band values (they must add up to {money(d.priceMinor)}).</p>
              <Field id="split-case" label="Case value (USD)" prefix="$">
                <Input inputMode="decimal" value={split.case} onChange={(e) => setSplit({ ...split, case: e.target.value })} data-testid="split-case" />
              </Field>
              <Field id="split-band" label="Band value (USD)" prefix="$">
                <Input inputMode="decimal" value={split.band} onChange={(e) => setSplit({ ...split, band: e.target.value })} data-testid="split-band" />
              </Field>
            </div>
          ) : null}
          {pubError ? (
            <p role="alert" className={s.error}>
              <Icon name="x-circle" />
              <span>{pubError}</span>
            </p>
          ) : null}
          <div className={s.actions}>
            <Button type="submit" variant="primary" loading={busy === 'publish'} data-testid="publish-confirm">
              Publish listing
            </Button>
            <Button onClick={() => dialog.current?.close()}>Cancel</Button>
          </div>
        </form>
      </dialog>

      {toast ? <Toast message={toast.message} {...(toast.undo ? { action: { label: 'Undo', onClick: () => void undo(toast.undo!) } } : {})} onDismiss={() => setToast(null)} /> : null}
    </aside>
  );
}
