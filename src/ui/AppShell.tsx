// Shared frame: a 48 px top bar (wordmark, "Sandbox" label, nav) and a left-aligned main column.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { MAIN_NAV, ariaCurrent, type NavId } from './nav';
import s from './AppShell.module.css';

export function AppShell({ children, width = 'app', current }: { children: ReactNode; width?: 'app' | 'checkout'; current?: NavId }) {
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
            {MAIN_NAV.map((item) => (
              <Link key={item.id} href={item.href} aria-current={ariaCurrent(item.id, current)}>
                {item.label}
              </Link>
            ))}
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
