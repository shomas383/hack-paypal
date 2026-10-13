'use client';
// /estimate (SPEC §4.7): a seller describes a product, its country of origin and its US selling price, and gets the
// estimated US import duty per candidate HTS line. The grounded classifier runs on the server; this page polls its REAL
// progress. Every amount comes from the server's code (verified rate rows first, else the automated estimator) — the page
// only formats integer cents. Never charged; nothing here creates a quote or an order.
import { useEffect, useRef, useState } from 'react';
import type { ProgressView } from '@/domain/classifier/progress';
import { CURRENT_HTS_REVISION } from '@/domain/rates/current';
import { cantText, exclusionText, isUncertain, lineDifferences, NOT_INCLUDED, rangeReasonText, stoppedText, plainBasis, reasonText, refText, sameDutyText, separatingLevels } from '@/domain/estimator/explain';
import { formatUsd } from '@/lib/money';
import type { CandidateView, EstimateView, OutcomeView } from '@/domain/estimator/view';
import { usd } from '@/domain/money/money';
import { parseUsdInput } from '@/domain/seller/form';
import { Button } from '@/ui/Button';
import { Disclosure } from '@/ui/Disclosure';
import { officialChain } from '@/ui/dutyText';
import { Field, Input, Select, Textarea } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Money } from '@/ui/Money';
import { PageHeader } from '@/ui/PageHeader';
import { StatusBadge } from '@/ui/StatusBadge';
import { ClassificationProgress } from '@/ui/patterns/ClassificationProgress';
import s from './estimate.module.css';

export type FormValues = { description: string; origin: string; price: string; shipping: string };
type View = EstimateView & { progress?: ProgressView };
type Answers = { facts: Record<string, boolean>; valueSplit?: { caseMinor: number; bandMinor: number } };

const ORIGINS = [
  { value: 'JP', label: 'Japan' },
  { value: 'DE', label: 'Germany' },
  { value: 'CN', label: 'China' },
  { value: 'OTHER', label: 'Another country (not supported yet)' },
];
const EMPTY: FormValues = { description: '', origin: 'JP', price: '', shipping: '' };
const TITLE_MAX = 500;
const DETAILS_MAX = 2000;

const m = (cents: number) => usd(cents);

function validate(f: FormValues): Partial<Record<keyof FormValues, string>> {
  const e: Partial<Record<keyof FormValues, string>> = {};
  if (f.description.trim().length < 3) e.description = 'Describe the product in at least 3 characters.';
  if (parseUsdInput(f.price) === null) e.price = 'Enter a price like 400.00.';
  if (f.shipping.trim() !== '' && parseUsdInput(f.shipping, { allowZero: true }) === null) e.shipping = 'Enter shipping like 25.00, or leave it empty.';
  return e;
}

/** One description field → the API's title (first 500 characters) and details (the rest). */
function splitDescription(text: string): { title: string; details?: string } {
  const t = text.trim();
  return t.length <= TITLE_MAX ? { title: t } : { title: t.slice(0, TITLE_MAX), details: t.slice(TITLE_MAX, TITLE_MAX + DETAILS_MAX) };
}

function errorText(status: number, message: string | undefined): string {
  if (status === 429) return message ? `${message.charAt(0).toUpperCase()}${message.slice(1)}.` : 'Too many estimates for now. Try again later.';
  if (status === 422 || status === 400) return message ?? 'Check the form and try again.';
  // the committed estimate data is past its valid_until ("Estimate data needs a rebuild (valid until …)")
  if (status === 503 && message) return `${message}.`;
  return 'Something went wrong on our side. Try again in a moment.';
}

export function EstimateClient({ fixture, initial }: { fixture: string | null; initial?: FormValues }) {
  const [form, setForm] = useState<FormValues>(initial ?? EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<{ status: number; text: string } | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [answers, setAnswers] = useState<Answers>({ facts: {} });
  const [answering, setAnswering] = useState(false);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const unsupportedOrigin = form.origin === 'OTHER';
  const running = id !== null && (view === null || view.status === 'ESTIMATING');

  // Poll the real progress while the classifier runs (the live API only; fixtures answer at once).
  useEffect(() => {
    if (!id || fixture) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/estimates/${id}`, { cache: 'no-store' });
        const j = (await res.json()) as View & { error?: string };
        if (stop) return;
        if (!res.ok) return setRequestError({ status: res.status, text: errorText(res.status, j.error) });
        setView(j);
        if (j.status === 'ESTIMATING' && j.progress?.state !== 'failed') timer = setTimeout(poll, 1000);
      } catch {
        if (!stop) setRequestError({ status: 0, text: errorText(0, undefined) });
      }
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, fixture]);

  useEffect(() => {
    if (view?.status === 'READY') resultRef.current?.focus();
  }, [view?.status, view?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    setRequestError(null);
    if (Object.keys(errs).length || unsupportedOrigin) return;
    setSubmitting(true);
    setView(null);
    setId(null);
    setAnswers({ facts: {} });
    try {
      if (fixture) {
        const res = await fetch(`/api/dev/estimate-fixture?name=${encodeURIComponent(fixture)}`, { cache: 'no-store' });
        if (!res.ok) return setRequestError({ status: res.status, text: errorText(res.status, undefined) });
        const v = (await res.json()) as View;
        setId(v.id);
        setView(v);
        return;
      }
      const shipping = form.shipping.trim() === '' ? undefined : parseUsdInput(form.shipping, { allowZero: true })!;
      const res = await fetch('/api/estimates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...splitDescription(form.description), origin: form.origin, sellingPriceMinor: parseUsdInput(form.price)!, ...(shipping !== undefined ? { shippingMinor: shipping } : {}) }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !j.id) return setRequestError({ status: res.status, text: errorText(res.status, j.error) });
      setId(j.id);
    } catch {
      setRequestError({ status: 0, text: errorText(0, undefined) });
    } finally {
      setSubmitting(false);
    }
  }

  async function answer(next: Answers) {
    if (!view) return;
    setAnswers(next);
    setAnswering(true);
    setRequestError(null);
    try {
      const url = fixture ? `/api/dev/estimate-fixture?name=${encodeURIComponent(fixture)}` : `/api/estimates/${view.id}/answers`;
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
      const j = (await res.json()) as View & { error?: string };
      if (!res.ok) return setRequestError({ status: res.status, text: errorText(res.status, j.error) });
      setView(j);
    } catch {
      setRequestError({ status: 0, text: errorText(0, undefined) });
    } finally {
      setAnswering(false);
    }
  }

  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className={s.page}>
      <PageHeader
        title="Estimate import duty"
        lead="For sellers sourcing goods to sell to US buyers, duty paid. Describe the product, where it was made and what the buyer pays; the estimate comes from the official HTS schedule."
      />

      <form className={s.form} onSubmit={submit} noValidate aria-describedby="est-form-note" data-testid="estimate-form">
        <Field id="est-description" label="Product description (any language)" hint="What it is, what it’s made of and what it’s for. The maker’s model name helps." error={errors.description}>
          <Textarea rows={3} value={form.description} onChange={set('description')} maxLength={TITLE_MAX + DETAILS_MAX} data-testid="estimate-description" />
        </Field>
        <Field id="est-origin" label="Where was it made?" hint="Country of origin, not where you bought it. A German watch bought in Japan is German-origin.">
          <Select value={form.origin} onChange={set('origin')} data-testid="estimate-origin">
            {ORIGINS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {unsupportedOrigin ? (
          <p className={s.inlineNote} data-testid="estimate-origin-unsupported">
            <StatusBadge tone="warning">Not supported yet</StatusBadge> Estimates cover goods made in Japan, Germany or China for now.
          </p>
        ) : null}
        <div className={s.money}>
          <Field id="est-price" label="Selling price to the US buyer (USD)" prefix="$" hint="This is the customs value." error={errors.price}>
            <Input inputMode="decimal" autoComplete="off" value={form.price} onChange={set('price')} data-testid="estimate-price" />
          </Field>
          <Field id="est-shipping" label="Shipping to the buyer (USD), optional" prefix="$" hint="Not part of the customs value." error={errors.shipping}>
            <Input inputMode="decimal" autoComplete="off" value={form.shipping} onChange={set('shipping')} data-testid="estimate-shipping" />
          </Field>
        </div>
        <div className={s.actions}>
          <Button type="submit" variant="primary" loading={submitting || running} disabled={unsupportedOrigin} data-testid="estimate-submit">
            Estimate duty
          </Button>
          <p id="est-form-note" className={s.muted}>
            Uses the official HTS {CURRENT_HTS_REVISION} schedule. Estimate — not a customs ruling.
          </p>
        </div>
      </form>

      <section aria-labelledby="est-result-title" className={s.result} aria-busy={running || answering || undefined}>
        <h2 id="est-result-title" className="sr-only">
          Result
        </h2>
        {requestError ? (
          <p className={s.error} role="alert" data-testid={requestError.status === 429 ? 'estimate-rate-limited' : 'estimate-error'}>
            <StatusBadge tone={requestError.status === 429 ? 'warning' : 'danger'}>{requestError.status === 429 ? 'Rate limited' : 'Error'}</StatusBadge> {requestError.text}
          </p>
        ) : null}
        {view?.status === 'ESTIMATING' && view.progress ? <ClassificationProgress steps={view.progress.steps} /> : null}
        {view?.status === 'FAILED' ? (
          <p className={s.error} role="alert" data-testid="estimate-failed">
            <StatusBadge tone="danger">Failed</StatusBadge> The classification didn’t finish. Try again.
          </p>
        ) : null}
        {view?.status === 'READY' ? <Result view={view} answers={answers} answering={answering} onAnswer={answer} headingRef={resultRef} /> : null}
      </section>
    </div>
  );
}

/** Title when the classifier stopped before choosing a line. */
const STOPPED_TITLE = { TOO_BROAD: 'Too many possible HTS lines', NO_CANDIDATES: 'No HTS line matched', INVALID_OUTPUT: 'Couldn’t classify this description' } as const;

function Result({ view, answers, answering, onAnswer, headingRef }: { view: View; answers: Answers; answering: boolean; onAnswer: (a: Answers) => void; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const estimated = view.candidates.filter((c): c is CandidateView & { outcome: Extract<OutcomeView, { kind: 'ESTIMATE' }> } => c.outcome.kind === 'ESTIMATE');
  const duties = estimated.map((c) => c.outcome.dutyMinor);
  const min = Math.min(...duties);
  const max = Math.max(...duties);
  const levels = separatingLevels(view.candidates.map((c) => c.chain));
  // The estimator's own disclosures (e.g. special-program rates), once each, as sentences.
  // The not-a-ruling notice is shown on its own under the result, so it is left out here.
  const disclosures = [...new Set(estimated.flatMap((c) => c.outcome.disclosures))].filter((d) => d !== view.notice).map((d) => (/[.!?]$/.test(d) ? d : `${d}.`));
  // Every candidate estimated and all at the same duty: one combined sentence; the top line in full, the rest collapsed.
  const sameDuty = estimated.length > 1 && estimated.length === view.candidates.length && min === max;
  // Where the shown lines' official descriptions part (code; the model's names only label a matching difference).
  const differences = lineDifferences(view.candidates.map((c) => ({ chain: c.chain, dutyMinor: c.outcome.kind === 'ESTIMATE' ? c.outcome.dutyMinor : null })), view.separating);
  const sameText = sameDuty ? sameDutyText(differences, formatUsd(m(min)), isUncertain(view.reasons)) : null;
  const reason = sameDuty ? null : (rangeReasonText(differences, isUncertain(view.reasons)) ?? reasonText(view.reasons, []));
  // A line whose verified row (or split) only needs answers isn't a refusal: the title asks instead.
  const asking = view.candidates.some((c) => c.outcome.kind === 'CANT_ESTIMATE' && (c.outcome.reason === 'NEEDS_FACTS' || c.outcome.reason === 'NEEDS_SPLIT'));
  const needsSplit = view.candidates.some((c) => c.outcome.kind === 'CANT_ESTIMATE' && c.outcome.reason === 'NEEDS_SPLIT');
  // names of the duty-changing differences, only where a model name clearly matches the official text
  const decides = differences.filter((d) => d.changesDuty && d.name).map((d) => `${d.name!.charAt(0).toUpperCase()}${d.name!.slice(1)}`);
  const [top, ...others] = view.candidates;
  const candidate = (c: CandidateView, i: number) => <Candidate key={c.code} c={c} rank={i + 1} view={view} answers={answers} answering={answering} onAnswer={onAnswer} />;

  return (
    <div className={s.resultBody} data-testid="estimate-result">
      <h3 ref={headingRef} tabIndex={-1} className={s.summaryTitle}>
        {view.candidates.length === 0
          ? STOPPED_TITLE[view.stopped?.reason ?? 'NO_CANDIDATES']
          : estimated.length === 0
            ? asking
              ? 'Answer the questions below to estimate the duty'
              : 'Can’t estimate this product yet'
            : min === max
              ? 'US import duty (est.)'
              : 'US import duty (est.), depending on the HTS line'}
      </h3>
      {view.candidates.length === 0 ? <p data-testid="estimate-stopped">{stoppedText(view.stopped ?? { reason: 'NO_CANDIDATES', lines: null, differAt: [] })}</p> : null}
      {estimated.length > 0 ? (
        <p className={s.summary} data-testid="estimate-summary">
          {min === max ? (
            <>
              <Money value={m(min)} strong /> on a <Money value={m(view.sellingPriceMinor)} /> sale
              {sameDuty ? ' for every likely HTS line' : ''}.
            </>
          ) : (
            <>
              <Money value={m(min)} strong /> to <Money value={m(max)} strong /> on a <Money value={m(view.sellingPriceMinor)} /> sale.
            </>
          )}
        </p>
      ) : null}
      {reason && view.candidates.length > 0 ? (
        <p className={s.inlineNote} data-testid="estimate-reason">
          {reason}
        </p>
      ) : null}
      {sameText ? (
        <p className={s.separating} data-testid="estimate-same-duty">
          <Icon name="info" />
          <span>{sameText}</span>
        </p>
      ) : null}
      {levels && estimated.length > 1 && min !== max ? (
        <p className={s.separating} data-testid="estimate-separating">
          <Icon name="info" />
          <span>
            The official lines part at:{' '}
            {view.candidates.map((c, i) => (
              <span key={c.code}>
                {i > 0 ? '; ' : ''}“{levels[i]}” → {c.outcome.kind === 'ESTIMATE' ? <Money value={m(c.outcome.dutyMinor)} /> : 'can’t estimate'}
              </span>
            ))}
            .{decides.length ? ` What decides it: ${decides.join(', ')}.` : ''}
          </span>
        </p>
      ) : null}

      {needsSplit ? <SplitQuestion price={view.sellingPriceMinor} answers={answers} answering={answering} onAnswer={onAnswer} /> : null}

      {sameDuty && top ? (
        <>
          <ol className={s.candidates}>{candidate(top, 0)}</ol>
          <Disclosure summary={`Other likely lines (same duty): ${others.map((c) => c.code).join(', ')}`} data-testid="estimate-other-lines">
            <ol className={s.candidates} start={2}>
              {others.map((c, i) => candidate(c, i + 1))}
            </ol>
          </Disclosure>
        </>
      ) : view.candidates.length > 0 ? (
        <ol className={s.candidates}>{view.candidates.map(candidate)}</ol>
      ) : null}

      <Disclosure summary="What the estimator includes and leaves out" data-testid="estimate-disclosures">
        <ul className={s.disclosures}>
          {disclosures.map((d) => (
            <li key={d}>{d}</li>
          ))}
          <li>{NOT_INCLUDED}</li>
          <li>Shipping is not part of the customs value; the delivered total adds it after the duty.</li>
        </ul>
        <p className={s.muted} data-testid="estimate-versions">
          Estimator data {view.estimatorVersion} · verified rates {view.rateVersion} · HTS {CURRENT_HTS_REVISION}
          {view.cached ? ' · classification reused from an identical description in the last 24 hours' : ''}
        </p>
      </Disclosure>
      <p className={s.notice} data-testid="estimate-notice">
        <Icon name="alert" /> {view.notice}
      </p>
    </div>
  );
}

/** The official sentences a question rests on, trimmed, each with where it is ("U.S. note 16(c) to subchapter III"). */
function OfficialQuotes({ quotes }: { quotes: { ref: string; text: string }[] }) {
  return (
    <>
      {quotes.map((q) => (
        <figure key={q.ref} className={s.quoteFig}>
          <blockquote className={s.official}>{q.text}</blockquote>
          <figcaption className={s.muted}>{refText(q.ref)}</figcaption>
        </figure>
      ))}
    </>
  );
}

function YesNo({ name, value, disabled, onChange }: { name: string; value: boolean | undefined; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={s.radios}>
      {[true, false].map((v) => (
        <label key={String(v)}>
          <input type="radio" name={name} checked={value === v} disabled={disabled} onChange={() => onChange(v)} />
          {v ? 'Yes' : 'No'}
        </label>
      ))}
    </div>
  );
}

function Candidate({ c, rank, view, answers, answering, onAnswer }: { c: CandidateView; rank: number; view: View; answers: Answers; answering: boolean; onAnswer: (a: Answers) => void }) {
  const o = c.outcome;
  const chain = officialChain(c.chain);
  const setFact = (fact: string, v: boolean) => onAnswer({ ...answers, facts: { ...answers.facts, [fact]: v } });
  return (
    <li className={s.candidate} data-testid={`estimate-candidate-${c.code}`}>
      <div className={s.candidateHead}>
        <span className={s.rank}>{rank}.</span>
        <span className={s.code}>{c.code}</span>
        <span className={s.muted}>Confidence {Math.round(c.confidence * 100)}%</span>
        {o.kind === 'ESTIMATE' ? (
          <StatusBadge tone={o.source === 'verified' ? 'success' : 'info'} data-testid="estimate-source">
            {o.sourceLabel}
          </StatusBadge>
        ) : o.reason === 'NEEDS_FACTS' ? (
          <StatusBadge tone="info" data-testid="estimate-needs-facts">
            {o.facts?.length === 1 ? 'One question to answer' : `${o.facts?.length ?? 0} questions to answer`}
          </StatusBadge>
        ) : (
          <StatusBadge tone="warning" data-testid="estimate-cant">
            Can’t estimate
          </StatusBadge>
        )}
      </div>
      {chain ? <p className={s.chain}>{chain}</p> : null}
      {o.kind === 'ESTIMATE' ? (
        <>
          {o.answered?.length ? (
            <div className={s.answered} data-testid="estimate-answered">
              <ul className={s.answerList}>
                {o.answered.map((a) => (
                  <li key={a.fact}>
                    {a.question} <strong>{a.answer ? 'Yes' : 'No'}</strong>
                  </li>
                ))}
              </ul>
              <Button variant="ghost" size="sm" disabled={answering} onClick={() => onAnswer({ ...answers, facts: Object.fromEntries(Object.entries(answers.facts).filter(([f]) => !o.answered!.some((a) => a.fact === f))) })}>
                Change answers
              </Button>
            </div>
          ) : null}
          <table className={s.lines}>
            <caption className="sr-only">Duty lines for {c.code}</caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Basis</th>
                <th scope="col" className={s.num}>
                  Amount (USD)
                </th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l, i) => (
                <tr key={i}>
                  <th scope="row">
                    {l.chapter99 ? (
                      <span className={s.lineCode}>{l.chapter99}</span>
                    ) : (
                      <>
                        General rate <span className={s.lineCode}>{c.code}</span>
                      </>
                    )}
                  </th>
                  <td data-testid="estimate-basis">{plainBasis(l, view.origin)}</td>
                  <td className={s.num}>
                    <Money value={m(l.amountMinor)} bare />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  US import duty (est.)
                </th>
                <td className={s.num}>
                  <Money value={m(o.dutyMinor)} bare strong data-testid="estimate-duty" />
                </td>
              </tr>
              <tr>
                <th scope="row" colSpan={2}>
                  Delivered to the buyer (price {view.shippingMinor ? '+ shipping ' : ''}+ duty)
                </th>
                <td className={s.num}>
                  <Money value={m(o.ddpTotalMinor)} bare strong data-testid="estimate-ddp" />
                </td>
              </tr>
            </tfoot>
          </table>
          {o.exclusions.length ? (
            <p className={s.inlineNote} data-testid="estimate-exclusions">
              <StatusBadge tone="info">Exclusion may apply</StatusBadge> {exclusionText(o.exclusions)}
            </p>
          ) : null}
          <Disclosure summary="Official text and exact basis" data-testid="estimate-official">
            <dl className={s.officialList}>
              {o.lines.map((l, i) => (
                <div key={i}>
                  <dt>{l.chapter99 ? <span className={s.code}>Heading {l.chapter99}</span> : <span className={s.code}>General rate · {c.code}</span>}</dt>
                  {l.officialText ? (
                    <dd>
                      <blockquote className={s.official}>{l.officialText}</blockquote>
                    </dd>
                  ) : null}
                  <dd className={s.muted}>
                    Computed as: <span className={s.code}>{l.basis}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Disclosure>
          {o.ifYes.map((q) => (
            <fieldset key={q.fact} className={s.question} data-testid={`estimate-question-${q.fact}`}>
              <legend>Does this describe the product? (heading {q.heading})</legend>
              <blockquote className={s.official}>{q.question}</blockquote>
              <p className={s.muted}>
                If yes, the duty is <Money value={m(q.dutyMinor)} /> (delivered <Money value={m(q.ddpTotalMinor)} />).
              </p>
              <YesNo name={`q-${c.code}-${q.fact}`} value={answers.facts[q.fact]} disabled={answering} onChange={(v) => setFact(q.fact, v)} />
            </fieldset>
          ))}
        </>
      ) : (
        <>
          <p className={s.cant} data-testid="estimate-cant-reason">
            {cantText(o.reason, o.detail, o.refs, o.headings)}
          </p>
          {o.facts?.map((f) => (
            <fieldset key={f.fact} className={s.question} data-testid={`estimate-fact-${f.fact}`}>
              <legend>{f.question}</legend>
              <OfficialQuotes quotes={f.quotes} />
              <p className={s.muted}>The verified rate row covers the answer “{f.required ? 'Yes' : 'No'}”.</p>
              <YesNo name={`f-${c.code}-${f.fact}`} value={answers.facts[f.fact]} disabled={answering} onChange={(v) => setFact(f.fact, v)} />
            </fieldset>
          ))}
          {o.ifAnswered ? (
            <p className={s.cant} data-testid="estimate-if-answered">
              With the answers the verified rate row covers, the duty is <Money value={m(o.ifAnswered.dutyMinor)} strong /> (delivered <Money value={m(o.ifAnswered.ddpTotalMinor)} />), from the {o.ifAnswered.sourceLabel.charAt(0).toLowerCase()}
              {o.ifAnswered.sourceLabel.slice(1)}.
            </p>
          ) : null}
          {o.headings?.length ? (
            <Disclosure summary="Official text of the headings named" data-testid="estimate-cant-official">
              <dl className={s.officialList}>
                {o.headings.map((h) => (
                  <div key={h.heading}>
                    <dt>
                      <span className={s.code}>Heading {h.heading}</span>
                    </dt>
                    <dd>
                      <blockquote className={s.official}>{h.text}</blockquote>
                    </dd>
                  </div>
                ))}
              </dl>
            </Disclosure>
          ) : null}
        </>
      )}
    </li>
  );
}

function SplitQuestion({ price, answers, answering, onAnswer }: { price: number; answers: Answers; answering: boolean; onAnswer: (a: Answers) => void }) {
  const [caseValue, setCase] = useState(answers.valueSplit ? String(answers.valueSplit.caseMinor / 100) : '');
  const [error, setError] = useState<string | null>(null);
  const caseMinor = parseUsdInput(caseValue, { allowZero: true });
  const band = caseMinor !== null && caseMinor <= price ? price - caseMinor : null;
  return (
    <form
      className={s.split}
      data-testid="estimate-split"
      onSubmit={(e) => {
        e.preventDefault();
        if (caseMinor === null || band === null) return setError(`Enter the case value, up to the price.`);
        setError(null);
        onAnswer({ ...answers, valueSplit: { caseMinor, bandMinor: band } });
      }}
    >
      <p className={s.splitLead}>
        The official rate for watches is charged separately on the case and on the strap, band or bracelet. How much of the <Money value={m(price)} /> is the case?
      </p>
      <Field id="est-case" label="Value of the watch case (USD)" prefix="$" hint={band !== null ? `Strap, band or bracelet: the rest, ${(band / 100).toFixed(2)}.` : 'The strap, band or bracelet is the rest.'} error={error}>
        <Input inputMode="decimal" autoComplete="off" value={caseValue} onChange={(e) => setCase(e.target.value)} data-testid="estimate-case-value" />
      </Field>
      <Button type="submit" variant="secondary" loading={answering} data-testid="estimate-split-submit">
        Estimate with this split
      </Button>
    </form>
  );
}
