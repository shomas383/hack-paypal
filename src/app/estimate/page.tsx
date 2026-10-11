import { devToolsEnabled } from '@/server/devOnly';
import { ESTIMATE_FIXTURES } from '@/server/estimateFixtures';
import { AppShell } from '@/ui/AppShell';
import { EstimateClient, type FormValues } from './EstimateClient';

export const metadata = { title: 'Estimate import duty — Landed' };

const dollars = (minor: number) => `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;

// ?fixture=guitar|jeans|watch-de|unsupported (dev only): the form is prefilled and "Estimate duty" loads the fixture's view
// from /api/dev/estimate-fixture — real computations on the committed data, fixed classifier candidates, no model call.
// Ignored in production, where that endpoint is also a 404.
export default async function EstimatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).fixture;
  const fixture = devToolsEnabled() && typeof raw === 'string' && ESTIMATE_FIXTURES[raw] ? raw : null;
  const f = fixture ? ESTIMATE_FIXTURES[fixture]!.request : null;
  const initial: FormValues | undefined = f
    ? { description: [f.title, f.details].filter(Boolean).join('\n'), origin: f.origin, price: dollars(f.sellingPriceMinor), shipping: f.shippingMinor !== undefined ? dollars(f.shippingMinor) : '' }
    : undefined;
  return (
    <AppShell current="estimate">
      <EstimateClient fixture={fixture} {...(initial ? { initial } : {})} />
    </AppShell>
  );
}
