import Link from 'next/link';
import { notFound } from 'next/navigation';
import { usd } from '@/domain/money/money';
import { formatUsd } from '@/lib/money';
import { CheckoutError, getCheckoutView } from '@/server/checkout';
import { serverEnv } from '@/server/env';
import { currentCh99, currentHtsIndex } from '@/server/hts';
import { readSessionId } from '@/server/session';
import { AppShell } from '@/ui/AppShell';
import { dutyLineLabel, officialChain, splitSources } from '@/ui/dutyText';
import { LocalTime } from '@/ui/LocalTime';
import { PageHeader } from '@/ui/PageHeader';
import { LandedCostLedger } from '@/ui/patterns/LandedCostLedger';
import { CheckoutClient } from './CheckoutClient';
import s from './checkout.module.css';

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
  const total = usd(q.totalMinor);

  return (
    <AppShell width="checkout">
      <PageHeader title="Review landed cost" back={<Link href="/listings">Listings</Link>} />

      {view.proposal ? (
        <p data-testid="agent-proposal" role="note" className={s.banner}>
          <strong>Proposed by your agent.</strong> Delivered total {formatUsd(usd(view.proposal.totalMinor))}, within your confirmed budget of{' '}
          {formatUsd(usd(view.proposal.budgetMinor))}. Review the duty lines below. Approving and paying are up to you.
        </p>
      ) : null}

      <section className={s.item} aria-labelledby="item-title">
        <h2 id="item-title" data-testid="title" className={s.itemTitle}>
          {q.title}
        </h2>
        <p className={s.itemMeta}>
          Origin {q.origin} · HTS <span data-testid="hts" className={s.mono}>{q.hts10}</span>
          {rateRow?.component_reporting ? <span data-testid="component-reporting"> (component reporting, HTS Ch. 91 Stat. Note 1)</span> : null}
        </p>
      </section>

      <LandedCostLedger
        goods={usd(q.goodsMinor)}
        shipping={usd(q.shippingMinor)}
        duty={usd(q.dutyMinor)}
        total={total}
        dutyMeta={
          <>
            Chapter 99: <span data-testid="ch99" className={s.mono}>{headings.join(', ')}</span>
          </>
        }
        lines={q.lines.map((l) => ({
          label: dutyLineLabel(l, q.hts10),
          amount: usd(BigInt(l.amountMinor)),
          // Official wording, verbatim from the HTS 2026 Rev. 20 export: the Ch. 99 heading, or the classified line's full chain.
          officialText: (l.chapter99 ? currentCh99().headings[l.chapter99] : officialChain(currentHtsIndex().chains.get(q.hts10))) ?? null,
          sources: splitSources(l.sourceRef),
        }))}
        provenance={{ htsRevision: rateRow?.hts_revision, verifiedOn: rateRow?.verified_on, rateVersion: q.rateVersion }}
      />

      <p data-testid="disclaimer" className={s.disclaimer}>
        Includes US import duty, estimated from verified rates and paid here at checkout (delivered duty paid). Not a customs ruling. Rate version{' '}
        <span data-testid="rate-version">{q.rateVersion}</span>
        {rateRow ? ` · HTS ${rateRow.hts_revision} · verified ${rateRow.verified_on}` : ''}. Quote expires at <LocalTime iso={q.expiresAt.toISOString()} />.
      </p>

      <CheckoutClient
        quoteId={q.id}
        clientId={serverEnv().publicPaypalClientId}
        totalDisplay={formatUsd(total)}
        orderCapDisplay={formatUsd(usd(view.caps.perOrderMinor))}
        initiallyApproved={view.approved}
        initialOrder={view.order ? { status: view.order.status, captureId: view.order.captureId, reasons: view.order.policy?.reasons ?? [] } : null}
      />
    </AppShell>
  );
}
