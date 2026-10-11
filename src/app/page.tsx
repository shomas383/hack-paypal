import Link from 'next/link';
import { AppShell } from '@/ui/AppShell';
import { PageHeader } from '@/ui/PageHeader';
import s from './home.module.css';

export default function Home() {
  return (
    <AppShell>
      <PageHeader title="Landed" lead="Duty-aware checkout for cross-border purchases on PayPal. Sandbox only." />
      <ul className={s.links}>
        <li>
          <Link href="/listings">Browse listings</Link>
        </li>
        <li>
          <Link href="/agent">Shopping agent</Link>
        </li>
        <li>
          <Link href="/estimate">Estimate import duty</Link>
        </li>
      </ul>
    </AppShell>
  );
}
