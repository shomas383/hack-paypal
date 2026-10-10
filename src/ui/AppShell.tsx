// Shared frame: a 48 px top bar (wordmark, "Sandbox" label, nav) and a left-aligned main column.
import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './AppShell.module.css';

// `seller`: show the Seller link (the seller pages pass it while a seller session is active).
export function AppShell({ children, width = 'app', current, seller = false }: { children: ReactNode; width?: 'app' | 'checkout'; current?: 'listings' | 'agent' | 'seller'; seller?: boolean }) {
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
            {seller ? (
              <Link href="/seller" aria-current={current === 'seller' ? 'page' : undefined}>
                Seller
              </Link>
            ) : null}
          </nav>
        </div>
      </header>
      {/* One container for every route: the wordmark and the content share the left edge. Checkout is a narrower
          column inside it, left-aligned (not centred). */}
      <main id="main" className={s.main}>
        {width === 'checkout' ? <div className={s.narrow}>{children}</div> : children}
      </main>
    </>
  );
}
