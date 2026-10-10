import Link from 'next/link';
import { AppShell } from '@/ui/AppShell';
import { PageHeader } from '@/ui/PageHeader';

export default function QuoteNotFound() {
  return (
    <AppShell width="checkout">
      <PageHeader title="Quote not found" lead="Quotes belong to the browser session that created them. Get a new quote from the listing." />
      <Link href="/listings">Back to listings</Link>
    </AppShell>
  );
}
