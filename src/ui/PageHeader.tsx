import type { ReactNode } from 'react';
import s from './PageHeader.module.css';

export function PageHeader({ title, lead, back, children }: { title: ReactNode; lead?: ReactNode; back?: ReactNode; children?: ReactNode }) {
  return (
    <header className={s.header}>
      {back ? <div className={s.back}>{back}</div> : null}
      <h1 className={s.title}>{title}</h1>
      {lead ? <p className={s.lead}>{lead}</p> : null}
      {children}
    </header>
  );
}
