// DEV ONLY: every state of every UI primitive / pattern on one page (design QA, docs/design/wireframes.md). Not linked
// from the app; 404 in production. Real data only (rates-v4 demo quotes).
import { notFound } from 'next/navigation';
import { usd } from '@/domain/money/money';
import { devToolsEnabled } from '@/server/devOnly';
import { AppShell } from '@/ui/AppShell';
import { Button, ButtonLink } from '@/ui/Button';
import { Disclosure } from '@/ui/Disclosure';
import { Field, Input, Textarea } from '@/ui/Field';
import { Money } from '@/ui/Money';
import { Skeleton } from '@/ui/Skeleton';
import { SourceCitation } from '@/ui/SourceCitation';
import { StatusBadge } from '@/ui/StatusBadge';
import { ToastDemo } from './ToastDemo';
import s from './states.module.css';

export const metadata = { title: 'States (dev) — Landed', robots: { index: false } };

export default function DevStatesPage() {
  if (!devToolsEnabled()) notFound();
  return (
    <AppShell>
      <h1 className={s.h1}>UI states</h1>
      <p className={s.lead}>Dev only. Every primitive and pattern in every state, with real demo data.</p>

      <section className={s.section} aria-labelledby="buttons">
        <h2 id="buttons">Button</h2>
        <div className={s.row}>
          <Button variant="primary">Approve $344.00 purchase</Button>
          <Button variant="primary" loading>
            Approve $344.00 purchase
          </Button>
          <Button variant="primary" disabled>
            Run comparison
          </Button>
          <Button>Confirm budget</Button>
          <Button disabled>Confirm budget</Button>
          <Button variant="ghost">Change</Button>
          <Button size="sm">Export CSV</Button>
          <ButtonLink href="#">Review and approve at checkout</ButtonLink>
        </div>
      </section>

      <section className={s.section} aria-labelledby="fields">
        <h2 id="fields">Field</h2>
        <div className={s.grid}>
          <Field id="f1" label="What are you looking for?">
            <Textarea defaultValue="automatic diver watch under $400 delivered" />
          </Field>
          <Field id="f2" label="Budget, delivered (USD)" prefix="$" hint="Delivered = goods + shipping + estimated US import duty.">
            <Input defaultValue="400.00" inputMode="decimal" />
          </Field>
          <Field id="f3" label="Budget, delivered (USD)" prefix="$" error="Enter an amount like 400.00.">
            <Input defaultValue="four hundred" inputMode="decimal" />
          </Field>
          <Field id="f4" label="Budget, delivered (USD)" prefix="$">
            <Input defaultValue="400.00" disabled />
          </Field>
        </div>
      </section>

      <section className={s.section} aria-labelledby="money">
        <h2 id="money">Money</h2>
        <p className={s.row}>
          <Money value={usd(34_400n)} /> <Money value={usd(37_709n)} strong /> <Money value={usd(123_450n)} /> <Money value={usd(0n)} /> ·
          bare: <Money value={usd(45_250n)} bare />
        </p>
      </section>

      <section className={s.section} aria-labelledby="status">
        <h2 id="status">StatusBadge</h2>
        <div className={s.row}>
          <StatusBadge tone="success">Within budget</StatusBadge>
          <StatusBadge tone="danger">Over by 52.50</StatusBadge>
          <StatusBadge tone="warning">1 listing(s) contained seller instructions; withheld.</StatusBadge>
          <StatusBadge tone="info">Proposed by your agent</StatusBadge>
          <StatusBadge tone="neutral">Pending</StatusBadge>
          <StatusBadge tone="progress">Quoting…</StatusBadge>
        </div>
      </section>

      <section className={s.section} aria-labelledby="disclosure">
        <h2 id="disclosure">Disclosure + SourceCitation</h2>
        <Disclosure summary="Official text and sources">
          <SourceCitation
            officialText="Except for products described in headings 9903.05.85–9903.05.92 and 9903.05.97, articles the product of a member state of the European Union, with an ad valorem (or ad valorem equivalent) rate of duty under column 1 less than 10 percent, as provided for in U.S. note 52 to this subchapter"
            sources={['U.S. note 52(k)', 'CSMS #69326983']}
            htsRevision="2026 Rev. 20"
            verifiedOn="2026-10-09"
            rateVersion="2026-rev20-v4"
          />
        </Disclosure>
        <Disclosure summary="Official text and sources (open)" defaultOpen>
          <SourceCitation
            officialText="Except for products described in headings 9903.05.85–9903.05.92, articles the product of Japan, with an ad valorem (or ad valorem equivalent) rate of duty under column 1 less than 12.5 percent, as provided for in U.S. note 52 to this subchapter"
            sources={['U.S. note 52', 'CSMS #69326983']}
            htsRevision="2026 Rev. 20"
            verifiedOn="2026-10-08"
            rateVersion="2026-rev20-v4"
          />
        </Disclosure>
      </section>

      <section className={s.section} aria-labelledby="skeleton">
        <h2 id="skeleton">Skeleton (appears after the show delay)</h2>
        <div className={s.stack}>
          <Skeleton width="40%" />
          <Skeleton width="70%" />
          <Skeleton width="55%" />
        </div>
      </section>

      <section className={s.section} aria-labelledby="toast">
        <h2 id="toast">Toast</h2>
        <ToastDemo />
      </section>
    </AppShell>
  );
}
