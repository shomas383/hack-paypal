// Native <details>/<summary>: keyboard and screen-reader support for free; works without JavaScript.
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import s from './Disclosure.module.css';

export function Disclosure({ summary, children, defaultOpen = false, className, ...rest }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string | undefined; 'data-testid'?: string }) {
  return (
    <details {...rest} className={`${s.details} ${className ?? ''}`} open={defaultOpen || undefined}>
      <summary className={s.summary}>
        <Icon name="chevron" className={s.chevron} />
        {summary}
      </summary>
      <div className={s.body}>{children}</div>
    </details>
  );
}
