import { notFound } from 'next/navigation';
import { readSellerSession, sellerConsoleEnabled } from '@/server/seller/access';
import { AppShell } from '@/ui/AppShell';
import { PageHeader } from '@/ui/PageHeader';
import { ClassifyPanel } from './ClassifyPanel';
import { SellerSignIn } from './SellerSignIn';
import { SignOutButton } from './SignOutButton';
import s from './seller.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Seller console — Landed', robots: { index: false } };

export default async function SellerPage() {
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
  return (
    <AppShell seller current="seller">
      <PageHeader
        title="Seller console"
        lead="Classify a listing against the official HTS 2026 Rev. 20 schedule. Codes come only from the schedule; duty comes only from verified rate rows."
      >
        <div className={s.headerActions}>
          <SignOutButton />
        </div>
      </PageHeader>
      <section aria-labelledby="classify-h">
        <h2 id="classify-h" className={s.h2}>
          Classify a listing
        </h2>
        <ClassifyPanel />
      </section>
    </AppShell>
  );
}
