import { usd } from '@/domain/money/money';
import { formatUsd, formatUsdNumber } from '@/lib/money';
import { quoteDuty } from '@/domain/rates/engine';
import { listListings } from '@/server/checkout';
import { currentRateTable } from '@/server/rates';
import { AppShell } from '@/ui/AppShell';
import { Button } from '@/ui/Button';
import { PageHeader } from '@/ui/PageHeader';
import s from './listings.module.css';

export const dynamic = 'force-dynamic';

export default async function ListingsPage() {
  const rows = (await listListings()).filter((l) => !l.testFixture); // red-team fixtures are only for the agent tests
  // A listing published from the seller console quotes only if a verified rate row covers it (never a guess).
  const today = new Date().toISOString().slice(0, 10);
  const quotable = (l: (typeof rows)[number]) =>
    quoteDuty(currentRateTable(), {
      origin: l.origin,
      hts10: l.hts10,
      entryDate: today,
      customsValue: usd(l.priceMinor),
      quantity: 1,
      ...(l.valueSplit ? { valueSplit: { case: usd(BigInt(l.valueSplit.case_minor)), band: usd(BigInt(l.valueSplit.band_minor)) } } : {}),
      ...(Object.keys(l.facts).length ? { facts: l.facts } : {}),
    }).kind === 'OK';
  return (
    <AppShell current="listings">
      <PageHeader title="Listings" lead="Get a landed-cost quote: goods, shipping and estimated US import duty, before any payment. Shipping is a flat $25.00 demo rate, not a carrier quote." />
      {rows.length === 0 ? (
        <p className={s.empty}>No listings yet.</p>
      ) : (
        <div className={s.table}>
          <div className={s.head} aria-hidden="true">
            <span>Listing</span>
            <span>Origin</span>
            <span>HTS</span>
            <span className={s.num}>Goods (USD)</span>
            <span className={s.num}>Shipping (USD)</span>
            <span />
          </div>
          <ul data-testid="listings" className={s.list}>
            {rows.map((l) => (
              <li key={l.id} data-testid={`listing-${l.id}`} className={s.row}>
                <span className={s.title}>{l.title}</span>
                <span className={s.cell}>
                  <span className={s.cellLabel}>Origin </span>
                  {l.origin}
                </span>
                <span className={`${s.cell} ${s.mono}`}>
                  <span className={s.cellLabel}>HTS </span>
                  {l.hts10}
                </span>
                <span className={`${s.num} ${s.wide}`}>{formatUsdNumber(usd(l.priceMinor))}</span>
                <span className={`${s.num} ${s.wide}`}>{formatUsdNumber(usd(l.shippingMinor))}</span>
                <span className={s.narrowPrice}>
                  {formatUsd(usd(l.priceMinor))} + {formatUsd(usd(l.shippingMinor))} shipping
                </span>
                {!quotable(l) ? (
                  <span className={s.action} data-testid={`no-rate-${l.id}`}>
                    No verified rate yet
                  </span>
                ) : (
                <form method="post" action="/api/quotes" className={s.action}>
                  <input type="hidden" name="listingId" value={l.id} />
                  <Button type="submit" size="sm" data-testid={`quote-${l.id}`} aria-label={`Get landed cost: ${l.title}`}>
                    Get landed cost
                  </Button>
                </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </AppShell>
  );
}
