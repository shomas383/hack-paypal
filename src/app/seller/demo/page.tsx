import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CURRENT_HTS_REVISION } from '@/domain/rates/current';
import { sellerPublicViewEnabled } from '@/server/seller/publicView';
import { AppShell } from '@/ui/AppShell';
import { Icon } from '@/ui/Icon';
import { PageHeader } from '@/ui/PageHeader';
import { LedgerGrid } from '../LedgerGrid';
import { ReviewQueue } from '../ReviewQueue';
import s from '../seller.module.css';

// The public read-only seller console (SPEC §4.5, SELLER_PUBLIC_VIEW=1): the review queue and the orders and duty ledger
// for anyone, through GET-only allowlisted routes. No classify, answer, accept, override, undo or publish exists here.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Seller console (read-only demo) — Landed', robots: { index: false } };

const TABS = [
  { id: 'review', label: 'Review queue' },
  { id: 'orders', label: 'Orders and duty' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default async function SellerDemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!sellerPublicViewEnabled()) notFound();
  const raw = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : 'review';
  return (
    <AppShell>
      <PageHeader
        title="Seller console (read-only demo)"
        lead={`The seller's review queue and orders and duty ledger. Codes come only from the official HTS ${CURRENT_HTS_REVISION} schedule; duty comes only from verified rate rows.`}
      >
        <p className={s.readOnlyNote} data-testid="read-only-note">
          <Icon name="info" />
          <span>
            Read-only. Accept, override, undo, publish and seller answers are disabled here; try the classifier on <Link href="/estimate">Estimate</Link>.
          </span>
        </p>
      </PageHeader>
      <nav aria-label="Seller console" className={s.tabs}>
        {TABS.map((t) => (
          <Link key={t.id} href={`/seller/demo?tab=${t.id}`} aria-current={t.id === tab ? 'page' : undefined} className={s.tab} data-testid={`tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'review' ? (
        <section aria-label="Review queue">
          <Suspense fallback={<p className={s.muted}>Loading the queue…</p>}>
            <ReviewQueue mode="public" />
          </Suspense>
        </section>
      ) : (
        <section aria-label="Orders and duty">
          <LedgerGrid mode="public" />
        </section>
      )}
    </AppShell>
  );
}
