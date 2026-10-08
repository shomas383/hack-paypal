import { notFound } from 'next/navigation';
import { formatDisplay } from '@/domain/money/format';
import { usd } from '@/domain/money/money';
import { CheckoutError, getCheckoutView } from '@/server/checkout';
import { serverEnv } from '@/server/env';
import { readSessionId } from '@/server/session';
import { CheckoutClient } from './CheckoutClient';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;
  let view;
  try {
    view = await getCheckoutView(quoteId, await readSessionId());
  } catch (e) {
    if (e instanceof CheckoutError && e.status === 404) notFound();
    throw e;
  }
  const { quote: q, rateRow } = view;
  const headings = q.lines.filter((l) => l.chapter99).map((l) => l.chapter99!);
  const fmt = (m: bigint) => formatDisplay(usd(m));

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 760, margin: '2rem auto', padding: '0 1rem' }}>
      <p><a href="/listings">← Listings</a></p>
      <h1>Landed cost</h1>
      <h2 data-testid="title">{q.title}</h2>

      <table data-testid="breakdown" style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          <tr><td>Goods (customs value)</td><td data-testid="goods" style={{ textAlign: 'right' }}>{fmt(q.goodsMinor)}</td></tr>
          <tr><td>Shipping (demo rate, not a carrier quote)</td><td data-testid="shipping" style={{ textAlign: 'right' }}>{fmt(q.shippingMinor)}</td></tr>
          <tr data-testid="duty-line">
            <td>
              <strong>US import duty (est.)</strong>
              <div style={{ fontSize: '0.85em' }}>
                Origin {q.origin} · HTS <span data-testid="hts">{q.hts10}</span>
                {rateRow?.component_reporting ? <span data-testid="component-reporting"> (component reporting, HTS Ch. 91 Stat. Note 1)</span> : null}
                {' '}· Ch.99 <span data-testid="ch99">{headings.join(', ')}</span>
              </div>
              <ul data-testid="duty-detail" style={{ fontSize: '0.85em', margin: '0.25rem 0' }}>
                {q.lines.map((l, i) => (
                  <li key={i}>
                    {l.kind}{l.chapter99 ? ` (${l.chapter99})` : ''}: {fmt(BigInt(l.amountMinor))} — {l.basis} · source: {l.sourceRef}
                  </li>
                ))}
              </ul>
            </td>
            <td data-testid="duty" style={{ textAlign: 'right', verticalAlign: 'top' }}><strong>{fmt(q.dutyMinor)}</strong></td>
          </tr>
          <tr><td><strong>Total</strong></td><td data-testid="total" style={{ textAlign: 'right' }}><strong>{fmt(q.totalMinor)}</strong></td></tr>
        </tbody>
      </table>

      <p data-testid="disclaimer" style={{ fontSize: '0.85em' }}>
        Estimated duties based on rate version <span data-testid="rate-version">{q.rateVersion}</span>
        {rateRow ? ` (HTS ${rateRow.hts_revision}, verified ${rateRow.verified_on})` : ''}, sources:{' '}
        {rateRow?.source_refs.map((s) => s.ref).join('; ') ?? q.rateRowId}. Not a customs ruling. Quote expires{' '}
        {q.expiresAt.toISOString().slice(11, 16)} UTC.
      </p>

      <CheckoutClient
        quoteId={q.id}
        clientId={serverEnv().publicPaypalClientId}
        totalDisplay={fmt(q.totalMinor)}
        orderCapDisplay={fmt(view.caps.perOrderMinor)}
        initiallyApproved={view.approved}
        initialOrder={view.order ? { status: view.order.status, captureId: view.order.captureId, reasons: view.order.policy?.reasons ?? [] } : null}
      />
    </main>
  );
}
