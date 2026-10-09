// pnpm db:seed — upserts the demo listings from data/seed/listings.json.
// Aborts unless every listing quotes OK in the engine AND either
//  (a) matches the verified golden case for its sheet row (price, origin, HTS), or
//  (b) is an explicit demo variant ("demo_variant_of": a golden id) on the SAME origin and HTS line (same verified row) with a
//      declared "expected" engine result (duty, delivered total, Ch. 99 heading) that the engine must reproduce EXACTLY.
// A listing with neither aborts the seed — variants never loosen the check silently.
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildQuote, type ListingForQuote } from '../src/domain/quote/buildQuote';
import { goldenFileName } from '../src/domain/rates/current';
import { listings } from '../src/server/db/schema';
import { currentRateTable } from '../src/server/rates';

// Local: load .env. On Render there is no .env — the variables come from the service environment (same as drizzle.config.ts).
if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');

interface SeedListing {
  id: string;
  sheet_ref: string;
  title: string;
  origin: string;
  hts10: string;
  price_minor: number;
  shipping_minor: number;
  value_split: { case_minor: number; band_minor: number } | null;
  facts: Record<string, boolean>;
  description?: string;
  test_fixture?: boolean;
  demo_variant_of?: string;
  expected?: { duty_minor: number; total_minor: number; chapter99: string };
}

async function main(): Promise<void> {
  const seed = JSON.parse(readFileSync('data/seed/listings.json', 'utf8')) as { listings: SeedListing[] };
  const golden = JSON.parse(readFileSync(`data/eval/${goldenFileName()}`, 'utf8')) as {
    cases: { id: string; origin: string; hts10: string; price_minor?: number; expected: string }[];
  };
  const table = currentRateTable();

  for (const l of seed.listings) {
    const variant = l.demo_variant_of;
    const g = golden.cases.find((c) => c.id === (variant ?? l.sheet_ref) && c.expected === 'OK');
    if (!g) throw new Error(`${l.id}: no verified golden case for ${variant ?? l.sheet_ref}`);
    if (variant) {
      if (!l.expected) throw new Error(`${l.id}: a demo variant must declare its expected engine result`);
      if (g.origin !== l.origin || g.hts10 !== l.hts10) throw new Error(`${l.id}: a demo variant must use the same origin/HTS line as ${variant}`);
    } else if (g.price_minor !== l.price_minor || g.origin !== l.origin || g.hts10 !== l.hts10) {
      throw new Error(`${l.id}: price/origin/HTS drifted from the verified golden case ${l.sheet_ref}`);
    }
    const listing: ListingForQuote = {
      id: l.id,
      title: l.title,
      origin: l.origin,
      hts10: l.hts10,
      priceMinor: BigInt(l.price_minor),
      shippingMinor: BigInt(l.shipping_minor),
      ...(l.value_split ? { valueSplit: { caseMinor: BigInt(l.value_split.case_minor), bandMinor: BigInt(l.value_split.band_minor) } } : {}),
      facts: l.facts,
    };
    const q = buildQuote(table, listing, { id: randomUUID(), sessionId: 'seed-check', now: new Date(), ttlSeconds: 60 });
    if (q.kind !== 'OK') throw new Error(`${l.id}: engine refuses to quote — ${q.reason}`);
    const fmt = (m: bigint) => `$${(Number(m) / 100).toFixed(2)}`;
    let tag = '';
    if (variant && l.expected) {
      const e = l.expected;
      const ch99 = q.quote.lines.map((x) => x.chapter99).filter(Boolean);
      if (q.quote.dutyMinor !== BigInt(e.duty_minor) || q.quote.totalMinor !== BigInt(e.total_minor) || !ch99.includes(e.chapter99)) {
        throw new Error(`${l.id}: engine result (duty ${fmt(q.quote.dutyMinor)}, total ${fmt(q.quote.totalMinor)}, ${ch99.join('+')}) ≠ declared expectation (duty ${fmt(BigInt(e.duty_minor))}, total ${fmt(BigInt(e.total_minor))}, ${e.chapter99})`);
      }
      tag = `  (demo variant of ${variant}; expected duty ${fmt(BigInt(e.duty_minor))} checked)`;
    }
    console.log(`  ${l.id.padEnd(7)} goods ${fmt(q.quote.goodsMinor).padStart(8)} + ship ${fmt(q.quote.shippingMinor)} + duty ${fmt(q.quote.dutyMinor).padStart(7)} = ${fmt(q.quote.totalMinor)}${tag}`);
  }

  const { db, sql } = await import('../src/server/db/client');
  for (const l of seed.listings) {
    const row = {
      id: l.id,
      sheetRef: l.sheet_ref,
      title: l.title,
      origin: l.origin,
      hts10: l.hts10,
      priceMinor: BigInt(l.price_minor),
      shippingMinor: BigInt(l.shipping_minor),
      currency: 'USD',
      valueSplit: l.value_split,
      facts: l.facts,
      description: l.description ?? null,
      testFixture: l.test_fixture === true,
    };
    await db.insert(listings).values(row).onConflictDoUpdate({ target: listings.id, set: row });
  }
  console.log(`seeded ${seed.listings.length} listings`);
  await sql.end();
}

main().catch((e: unknown) => {
  console.error(`SEED ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
