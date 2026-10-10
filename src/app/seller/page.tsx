import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { readSellerSession, sellerConsoleEnabled } from '@/server/seller/access';
import { AppShell } from '@/ui/AppShell';
import { PageHeader } from '@/ui/PageHeader';
import { ClassifyPanel } from './ClassifyPanel';
import { LedgerGrid } from './LedgerGrid';
import { ReviewQueue } from './ReviewQueue';
import { SellerSignIn } from './SellerSignIn';
import { SignOutButton } from './SignOutButton';
import s from './seller.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Seller console — Landed', robots: { index: false } };

const TABS = [
  { id: 'classify', label: 'Classify' },
  { id: 'review', label: 'Review queue' },
  { id: 'orders', label: 'Orders and duty' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default async function SellerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!sellerConsoleEnabled()) notFound();
  const session = await readSellerSession();
  if (!session) {
    return (
      <AppShell>
        <div className={s.signIn}>
          <PageHeader title="Seller console" lead="Classify listings against the official HTS 2026 Rev. 20 schedule and publish them for landed-cost quotes." />
          <SellerSignIn />
        </div>
      </AppShell>
    );
  }
  const raw = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : 'classify';
  return (
    <AppShell seller current="seller">
      <PageHeader
        title="Seller console"
        lead="Classify listings against the official HTS 2026 Rev. 20 schedule, review them and publish. Codes come only from the schedule; duty comes only from verified rate rows."
      >
        <div className={s.headerActions}>
          <SignOutButton />
        </div>
      </PageHeader>
      <nav aria-label="Seller console" className={s.tabs}>
        {TABS.map((t) => (
          <Link key={t.id} href={`/seller?tab=${t.id}`} aria-current={t.id === tab ? 'page' : undefined} className={s.tab} data-testid={`tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'classify' ? (
        <section aria-label="Classify a listing">
          <ClassifyPanel />
        </section>
      ) : tab === 'review' ? (
        <section aria-label="Review queue">
          <Suspense fallback={<p className={s.muted}>Loading the queue…</p>}>
            <ReviewQueue />
          </Suspense>
        </section>
      ) : (
        <section aria-label="Orders and duty">
          <LedgerGrid />
        </section>
      )}
    </AppShell>
  );
}
