'use client';
// Approve (recorded) → PayPal v6 button → onApprove → server completes (authorize → policy → capture | void).
// The browser never sends an amount: the order is built on the server from the stored quote.
import { useEffect, useRef, useState } from 'react';
import { loadCoreSdkScript } from '@paypal/paypal-js/sdk-v6';

interface Outcome {
  status: string;
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

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export function CheckoutClient(props: Props) {
  const [approved, setApproved] = useState(props.initiallyApproved);
  const [outcome, setOutcome] = useState<Outcome | null>(props.initialOrder);
  const [status, setStatus] = useState('');
  const [invoice, setInvoice] = useState<Record<string, string | null> | null>(null);
  const [invoicing, setInvoicing] = useState(false);
  const buttonHost = useRef<HTMLDivElement>(null);

  async function approve() {
    setStatus('Recording approval…');
    try {
      await post(`/api/quotes/${props.quoteId}/approve`);
      setApproved(true);
      setStatus('Approved. Pay with PayPal to authorize the payment.');
    } catch (e) {
      setStatus(`Approval refused: ${e instanceof Error ? e.message : String(e)}`);
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
        setStatus('PayPal is not eligible in this browser.');
        return;
      }
      const session = sdk.createPayPalOneTimePaymentSession({
        onApprove: async ({ orderId }) => {
          setStatus('Buyer approved in PayPal — authorizing and running the policy gate…');
          try {
            const r = await post<{ status: string; captureId: string | null; policy: { reasons: string[] } | null }>(`/api/orders/${orderId}/complete`);
            setOutcome({ status: r.status, captureId: r.captureId, reasons: r.policy?.reasons ?? [] });
            setStatus('');
          } catch (e) {
            setStatus(`Completion failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
        onCancel: () => setStatus('PayPal window closed — nothing was charged.'),
        onError: (err) => setStatus(`PayPal error: ${err instanceof Error ? err.message : String(err)}`),
      });
      const button = document.createElement('paypal-button');
      button.setAttribute('data-testid', 'paypal-button');
      button.addEventListener('click', () => {
        // Don't await before start(): the popup needs the click's transient activation (PayPal v6 docs).
        const orderPromise = post<{ orderId: string }>(`/api/quotes/${props.quoteId}/paypal-order`);
        session.start({ presentationMode: 'auto' }, orderPromise).catch((e: unknown) => setStatus(`PayPal start failed: ${String(e)}`));
      });
      host.replaceChildren(button);
    })().catch((e: unknown) => setStatus(`PayPal SDK failed to load: ${String(e)}`));
    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [approved, outcome?.status, props.clientId, props.quoteId]);

  async function sendInvoice() {
    if (invoicing) return;
    setInvoicing(true);
    setStatus('Creating DDP invoice…');
    try {
      setInvoice(await post<Record<string, string | null>>(`/api/quotes/${props.quoteId}/invoice`, {}));
      setStatus('');
    } catch (e) {
      setStatus(`Invoice failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInvoicing(false);
    }
  }

  return (
    <section>
      {!approved && (
        <p>
          <button type="button" data-testid="approve" onClick={approve}>
            Approve purchase — {props.totalDisplay}
          </button>{' '}
          <span data-testid="spend-cap">Spend cap per order: {props.orderCapDisplay}</span>
        </p>
      )}
      {approved && !outcome && <div data-testid="paypal-button-container" ref={buttonHost} style={{ maxWidth: 360 }} />}
      {outcome && (
        <div data-testid="outcome" style={{ border: '1px solid #999', padding: '0.75rem' }}>
          Payment <strong data-testid="outcome-status">{outcome.status}</strong>
          {outcome.captureId ? <> · capture <code data-testid="capture-id">{outcome.captureId}</code></> : null}
          <div>Policy: {outcome.reasons.length ? <span data-testid="policy-reasons">{outcome.reasons.join(', ')}</span> : 'all checks passed'}</div>
        </div>
      )}
      <p data-testid="status" aria-live="polite">{status}</p>
      <hr />
      <p>
        <button type="button" data-testid="send-invoice" onClick={sendInvoice} disabled={invoicing}>Send DDP invoice instead</button>
      </p>
      {invoice && (
        <div data-testid="invoice-result">
          Invoice <code>{invoice.invoiceId}</code> · status <strong data-testid="invoice-status">{invoice.status}</strong> · total ${invoice.total}
          {invoice.dutyLabel ? <div data-testid="invoice-duty">{invoice.dutyLabel}: ${invoice.dutyAmount}</div> : null}
          {invoice.recipientViewUrl ? <div><a href={invoice.recipientViewUrl} target="_blank" rel="noreferrer">Buyer view</a></div> : null}
        </div>
      )}
    </section>
  );
}
