'use client';
// Classify a listing (seller console, docs/design/wireframes.md §3). The grounded classifier runs on the server after the
// POST; this panel polls its REAL progress (three stored stages) and shows the result. Prices are the seller's own
// entries, parsed to integer minor units (never from the model).
import { useEffect, useRef, useState } from 'react';
import type { ProgressView } from '@/domain/classifier/progress';
import { parseUsdInput } from '@/domain/seller/form';
import { Button } from '@/ui/Button';
import { Disclosure } from '@/ui/Disclosure';
import { officialChain } from '@/ui/dutyText';
import { Field, Input, Select, Textarea } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { StatusBadge } from '@/ui/StatusBadge';
import { ClassificationProgress } from '@/ui/patterns/ClassificationProgress';
import { reasonText } from '@/ui/reasonText';
import s from './seller.module.css';

interface View {
  id: string;
  status: string;
  progress: ProgressView;
  error: string | null;
  reasons: string[];
  threshold: number;
  top: { hts10: string; confidence: number; rationale: string; evidence: string[]; chain: string[]; componentReporting: boolean } | null;
  others: { hts10: string; confidence: number; chain: string[] }[];
  separatingAttributes: { name: string; value_from_listing: string | null }[];
}

type Form = { title: string; description: string; origin: string; price: string; shipping: string };
type Errors = Partial<Record<keyof Form, string>>;

const EMPTY: Form = { title: '', description: '', origin: 'JP', price: '', shipping: '25.00' };

// Demo samples (generic, no brands). The Japanese watch should classify to 9102.21.70 (a verified JP rate row exists);
// the denim leaves out the fibre content, which separates the 6203.42 lines.
const SAMPLES: { label: string; form: Form }[] = [
  {
    label: 'Japanese watch listing',
    form: {
      title: '自動巻き ダイバーズウォッチ 21石 ステンレスケース ステンレスブレス 1990年代',
      description: '自動巻きムーブメント（21石）。ケースとブレスレットはステンレススチール製。日本製。動作確認済み。',
      origin: 'JP',
      price: '300.00',
      shipping: '25.00',
    },
  },
  {
    label: 'denim jeans',
    form: { title: "Men's selvedge blue denim jeans", description: 'Straight leg, button fly, 32 x 32. Made in Japan.', origin: 'JP', price: '200.00', shipping: '25.00' },
  },
];

function validate(f: Form): Errors {
  const e: Errors = {};
  if (f.title.trim().length < 3) e.title = 'Enter a title of at least 3 characters.';
  if (parseUsdInput(f.price) === null) e.price = 'Enter a price like 300.00.';
  if (parseUsdInput(f.shipping, { allowZero: true }) === null) e.shipping = 'Enter shipping like 25.00 (0 for free shipping).';
  return e;
}

export function ClassifyPanel() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const shippingRef = useRef<HTMLInputElement>(null);

  const running = id !== null && (view === null || view.progress.state === 'classifying');

  useEffect(() => {
    if (!id) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/seller/classifications/${id}`, { cache: 'no-store' });
        const j = (await res.json()) as View & { error?: string };
        if (stop) return;
        if (!res.ok) {
          setRequestError(res.status === 401 ? 'Your seller session ended. Reload the page and sign in again.' : (j.error ?? `The server answered ${res.status}.`));
          return;
        }
        setView(j);
        if (j.progress.state === 'classifying') timer = setTimeout(poll, 1000);
      } catch {
        if (!stop) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    const first = (['title', 'price', 'shipping'] as const).find((k) => errs[k]);
    if (first) {
      ({ title: titleRef, price: priceRef, shipping: shippingRef })[first].current?.focus();
      return;
    }
    setSubmitting(true);
    setRequestError(null);
    setView(null);
    setId(null);
    try {
      const res = await fetch('/api/seller/classifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          origin: form.origin || null,
          priceMinor: parseUsdInput(form.price),
          shippingMinor: parseUsdInput(form.shipping, { allowZero: true }),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !j.id) {
        setRequestError(
          res.status === 429 ? `Classification limit reached: ${j.error ?? 'try again later'}.` : res.status === 401 ? 'Your seller session ended. Reload the page and sign in again.' : `The listing wasn't classified: ${j.error ?? `the server answered ${res.status}`}.`,
        );
        return;
      }
      setId(j.id);
    } catch {
      setRequestError("The server couldn't be reached. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const missing = view?.separatingAttributes.filter((a) => a.value_from_listing === null).map((a) => a.name) ?? [];
  const done = view && view.progress.state !== 'classifying';

  return (
    <div className={s.classify}>
      <form className={s.form} onSubmit={submit} noValidate aria-label="Listing to classify">
        <p className={s.samples}>
          Use a sample:{' '}
          {SAMPLES.map((x, i) => (
            <span key={x.label}>
              {i ? ' · ' : ''}
              <button
                type="button"
                className={s.linkButton}
                disabled={running || submitting}
                onClick={() => {
                  setForm(x.form);
                  setErrors({});
                }}
              >
                {x.label}
              </button>
            </span>
          ))}
        </p>
        <Field id="title" label="Title" error={errors.title}>
          <Input ref={titleRef} value={form.title} onChange={set('title')} disabled={running || submitting} data-testid="seller-title" />
        </Field>
        <Field id="description" label="Description (optional)" hint="Any language, including Japanese.">
          <Textarea value={form.description} onChange={set('description')} disabled={running || submitting} rows={3} data-testid="seller-description" />
        </Field>
        <div className={s.row3}>
          <Field id="origin" label="Country of origin">
            <Select value={form.origin} onChange={set('origin')} disabled={running || submitting} data-testid="seller-origin">
              <option value="JP">Japan</option>
              <option value="CN">China</option>
              <option value="DE">Germany</option>
              <option value="">Unknown</option>
            </Select>
          </Field>
          <Field id="price" label="Price (USD)" prefix="$" error={errors.price}>
            <Input ref={priceRef} inputMode="decimal" value={form.price} onChange={set('price')} disabled={running || submitting} data-testid="seller-price" />
          </Field>
          <Field id="shipping" label="Shipping (USD)" prefix="$" error={errors.shipping}>
            <Input ref={shippingRef} inputMode="decimal" value={form.shipping} onChange={set('shipping')} disabled={running || submitting} data-testid="seller-shipping" />
          </Field>
        </div>
        <div>
          <Button type="submit" variant="primary" loading={submitting || running} data-testid="seller-classify">
            Classify listing
          </Button>
        </div>
      </form>

      {requestError ? (
        <div role="alert" className={s.error}>
          <Icon name="x-circle" />
          <span>{requestError}</span>
        </div>
      ) : null}

      {id ? (
        <section className={s.run} aria-labelledby="run-h">
          <h3 id="run-h" className={s.h3}>
            Classification
          </h3>
          {view ? <ClassificationProgress steps={view.progress.steps} /> : <ClassificationProgress steps={[{ state: 'active', label: 'Proposing headings…' }, { state: 'pending', label: 'Matching official Rev 20 lines' }, { state: 'pending', label: 'Choosing a line' }]} />}

          {view?.progress.state === 'interrupted' || view?.progress.state === 'failed' ? (
            <p role="alert" className={s.error}>
              <Icon name="x-circle" />
              <span>{view.progress.state === 'interrupted' ? 'Classification was interrupted. Run it again.' : `Classification failed: ${view.error ?? 'unknown error'}. Run it again.`}</span>
            </p>
          ) : null}

          {done && view && view.progress.state === 'done' ? (
            <div className={s.result} data-testid="classification-result">
              <div className={s.resultHead}>
                {view.status === 'AUTO_ACCEPTED' ? <StatusBadge tone="success">Auto-accepted</StatusBadge> : <StatusBadge tone="warning">Needs review</StatusBadge>}
              </div>
              {view.top ? (
                <>
                  <p className={s.proposed}>
                    Proposed <span className={s.mono}>{view.top.hts10}</span>
                    {view.top.componentReporting ? <span className={s.muted}> (component reporting)</span> : null}
                    <span className={s.confidence}>
                      <span className={s.muted}>confidence</span> {view.top.confidence.toFixed(2)}
                      <span className={s.bar} aria-hidden="true">
                        <span style={{ width: `${Math.round(view.top.confidence * 100)}%` }} />
                      </span>
                    </span>
                  </p>
                  <p className={s.chain}>{officialChain(view.top.chain)}</p>
                </>
              ) : null}
              {view.reasons.length ? (
                <ul className={s.reasons} aria-label="Why it needs review">
                  {view.reasons.map((r) => (
                    <li key={r}>{reasonText(r, { confidence: view.top?.confidence ?? null, threshold: view.threshold, missing })}</li>
                  ))}
                </ul>
              ) : null}
              {view.top?.evidence.length ? (
                <div className={s.evidence}>
                  <span className={s.muted}>Evidence from the listing (checked by code):</span>
                  <ul>
                    {view.top.evidence.map((q, i) => (
                      <li key={i}>“{q}”</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {view.others.length ? (
                <Disclosure summary={`Other candidates (${view.others.length})`}>
                  <ul className={s.others}>
                    {view.others.map((o) => (
                      <li key={o.hts10}>
                        <span className={s.mono}>{o.hts10}</span> · confidence {o.confidence.toFixed(2)}
                        <span className={s.chainSmall}>{officialChain(o.chain)}</span>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
