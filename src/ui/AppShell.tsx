// Shared frame: a 48 px top bar (wordmark, "Sandbox" label, nav) and a left-aligned main column.
import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './AppShell.module.css';

export function AppShell({ children, width = 'app', current }: { children: ReactNode; width?: 'app' | 'checkout'; current?: 'listings' | 'agent' }) {
  return (
    <>
      <a href="#main" className={s.skip}>
        Skip to content
      </a>
      <header className={s.topbar}>
        <div className={s.bar}>
          <Link href="/" className={s.wordmark}>
            Landed
          </Link>
          <span className={s.sandbox}>Sandbox</span>
          <nav aria-label="Main" className={s.nav}>
            <Link href="/listings" aria-current={current === 'listings' ? 'page' : undefined}>
              Listings
            </Link>
            <Link href="/agent" aria-current={current === 'agent' ? 'page' : undefined}>
              Agent
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className={`${s.main} ${width === 'checkout' ? s.narrow : ''}`}>
        {children}
      </main>
    </>
  );
}
