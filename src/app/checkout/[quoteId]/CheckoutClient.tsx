'use client';
// Approve (recorded) → PayPal v6 button → onApprove → server completes (authorize → policy → capture | void).
// The browser never sends an amount: the order is built on the server from the stored quote.
import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';
import { loadCoreSdkScript } from '@paypal/paypal-js/sdk-v6';
import { Button } from '@/ui/Button';
import { policyReasonText } from '@/ui/dutyText';
import { Icon } from '@/ui/Icon';
import { orderIds } from '@/ui/orderIds';
import { Skeleton } from '@/ui/Skeleton';
import { StatusBadge } from '@/ui/StatusBadge';
import s from './checkout-client.module.css';

interface Outcome {
  status: string;
  paypalOrderId: string | null;
  captureId: string | null;
  reasons: string[];
}

interface Props {
  quoteId: string;
  clientId: string;
  totalDisplay: string;
  orderCapDisplay: string;
  initiallyApproved: boolean;
  initialOrder: Outcome | null;
}

type Note = { kind: 'progress' | 'info' | 'error'; text: string; backLink?: boolean } | null;

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CheckoutClient(props: Props) {
  const [approved, setApproved] = useState(props.initiallyApproved);
  const [approving, setApproving] = useState(false);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(props.initialOrder);
  const [note, setNote] = useState<Note>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [invoice, setInvoice] = useState<Record<string, string | null> | null>(null);
  const [invoicing, setInvoicing] = useState(false);
  const buttonHost = useRef<HTMLDivElement>(null);

  async function approve() {
    setApproving(true);
    setNote(null);
    try {
      await post(`/api/quotes/${props.quoteId}/approve`);
      setApproved(true);
      setApprovedAt(new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date()));
    } catch (e) {
      setNote({ kind: 'error', text: `Approval refused. ${msg(e)}`, backLink: true });
    } finally {
      setApproving(false);
    }
  }

  useEffect(() => {
    if (!approved || outcome?.status === 'CAPTURED' || outcome?.status === 'VOIDED') return;
    const host = buttonHost.current;
    if (!host) return;
    let cancelled = false;
    (async () => {
      const paypal = await loadCoreSdkScript({ environment: 'sandbox' });
      if (!paypal || cancelled) return;
      const sdk = await paypal.createInstance({ clientId: props.clientId, components: ['paypal-payments'] });
      const eligible = await sdk.findEligibleMethods();
      if (!eligible.isEligible('paypal')) {
        setNote({ kind: 'error', text: "PayPal isn't available in this browser. Try another browser or send a DDP invoice instead." });
        return;
      }
      const session = sdk.createPayPalOneTimePaymentSession({
        onApprove: async ({ orderId }) => {
          setNote({ kind: 'progress', text: 'Authorizing and running the policy checks…' });
          try {
            const r = await post<{ status: string; captureId: string | null; policy: { reasons: string[] } | null }>(`/api/orders/${orderId}/complete`);
            setOutcome({ status: r.status, paypalOrderId: orderId, captureId: r.captureId, reasons: r.policy?.reasons ?? [] });
            setNote(null);
          } catch (e) {
            setNote({ kind: 'error', text: `Completing the payment failed: ${msg(e)}. Nothing was captured; reload the page to check the order.` });
          }
        },
        onCancel: () => setNote({ kind: 'info', text: 'PayPal window closed. Nothing was charged.' }),
        onError: (err) => setNote({ kind: 'error', text: `PayPal reported an error: ${msg(err)}. Nothing was charged; try again.` }),
      });
      const button = document.createElement('paypal-button');
      button.setAttribute('data-testid', 'paypal-button');
      button.addEventListener('click', () => {
        // Don't await before start(): the popup needs the click's transient activation (PayPal v6 docs).
        const orderPromise = post<{ orderId: string }>(`/api/quotes/${props.quoteId}/paypal-order`);
        session.start({ presentationMode: 'auto' }, orderPromise).catch((e: unknown) => setNote({ kind: 'error', text: `PayPal couldn't start: ${String(e)}. Nothing was charged; try again.` }));
      });
      host.replaceChildren(button);
      setSdkReady(true);
    })().catch((e: unknown) => setNote({ kind: 'error', text: `PayPal didn't load: ${String(e)}. Reload the page to try again.` }));
    return () => {
      cancelled = true;
      host.replaceChildren();
      setSdkReady(false);
    };
  }, [approved, outcome?.status, props.clientId, props.quoteId]);

  async function sendInvoice() {
    if (invoicing) return;
    setInvoicing(true);
    setNote(null);
    try {
      setInvoice(await post<Record<string, string | null>>(`/api/quotes/${props.quoteId}/invoice`, {}));
    } catch (e) {
      setNote({ kind: 'error', text: `The invoice wasn't sent: ${msg(e)}.` });
    } finally {
      setInvoicing(false);
    }
  }

  return (
    <section className={s.actions} aria-label="Approve and pay">
      {!approved && !outcome ? (
        <div className={s.approveRow}>
          <Button variant="primary" data-testid="approve" onClick={approve} loading={approving}>
            Approve {props.totalDisplay} purchase
          </Button>
          <span data-testid="spend-cap" className={s.cap}>
            Per-order cap: {props.orderCapDisplay}
          </span>
        </div>
      ) : null}

      {approved && !outcome ? (
        <div className={s.pay}>
          <StatusBadge tone="success">{approvedAt ? `Approved at ${approvedAt}.` : 'Approved.'} Pay with PayPal to authorize the payment.</StatusBadge>
          <p className={s.payAmount}>You&rsquo;ll pay {props.totalDisplay} in the PayPal window.</p>
          {!sdkReady ? <Skeleton width="100%" height="var(--touch-target)" className={s.paySkeleton} /> : null}
          <div data-testid="paypal-button-container" ref={buttonHost} className={s.payHost} />
        </div>
      ) : null}

      {outcome ? (
        <div data-testid="outcome" className={s.outcome}>
          {outcome.status === 'CAPTURED' ? (
            <StatusBadge tone="success">
              Payment <span data-testid="outcome-status">{outcome.status}</span> · {props.totalDisplay}
            </StatusBadge>
          ) : outcome.status === 'VOIDED' ? (
            <StatusBadge tone="danger">
              Payment <span data-testid="outcome-status">{outcome.status}</span>, nothing was charged.
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral">
              Payment <span data-testid="outcome-status">{outcome.status}</span>
            </StatusBadge>
          )}
          {orderIds(outcome).length ? (
            <p className={s.small}>
              {orderIds(outcome).map((l, i) => (
                <Fragment key={l.testId}>
                  {i > 0 ? ' · ' : null}
                  {l.label} <code data-testid={l.testId}>{l.id}</code>
                </Fragment>
              ))}
            </p>
          ) : null}
          <p className={s.small}>
            {outcome.reasons.length ? (
              <>
                Policy: {outcome.reasons.map(policyReasonText).join('; ')} (<code data-testid="policy-reasons">{outcome.reasons.join(', ')}</code>).
              </>
            ) : (
              'Policy: all checks passed.'
            )}
          </p>
        </div>
      ) : null}

      {note?.kind === 'error' ? (
        <div role="alert" className={s.error} data-testid="status">
          <Icon name="x-circle" />
          <span>
            {note.text}
            {note.backLink ? (
              <>
                {' '}
                <Link href="/listings">Back to listings</Link>
              </>
            ) : null}
          </span>
        </div>
      ) : (
        <p role="status" className={s.status} data-testid="status">
          {note ? note.text : ''}
        </p>
      )}

      <div className={s.invoice}>
        <Button data-testid="send-invoice" onClick={sendInvoice} loading={invoicing}>
          Send DDP invoice instead
        </Button>
        {invoice ? (
          <div data-testid="invoice-result" className={s.small}>
            Invoice <code>{invoice.invoiceId}</code> · status <strong data-testid="invoice-status">{invoice.status}</strong> · total ${invoice.total}
            {invoice.dutyLabel ? <div data-testid="invoice-duty">{invoice.dutyLabel}: ${invoice.dutyAmount}</div> : null}
            {invoice.recipientViewUrl ? (
              <div>
                <a href={invoice.recipientViewUrl} target="_blank" rel="noreferrer">
                  Open the buyer&rsquo;s view of the invoice
                </a>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
