// pnpm db:seed — upserts the demo listings from data/seed/listings.json.
// Aborts unless every listing (1) matches the verified golden price for its sheet row and (2) quotes OK in the engine.
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
}

async function main(): Promise<void> {
  const seed = JSON.parse(readFileSync('data/seed/listings.json', 'utf8')) as { listings: SeedListing[] };
  const golden = JSON.parse(readFileSync(`data/eval/${goldenFileName()}`, 'utf8')) as {
    cases: { id: string; origin: string; hts10: string; price_minor?: number; expected: string }[];
  };
  const table = currentRateTable();

  for (const l of seed.listings) {
    const g = golden.cases.find((c) => c.id === l.sheet_ref && c.expected === 'OK');
    if (!g) throw new Error(`${l.id}: no verified golden case for ${l.sheet_ref}`);
    if (g.price_minor !== l.price_minor || g.origin !== l.origin || g.hts10 !== l.hts10) {
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
    console.log(`  ${l.id.padEnd(6)} goods ${fmt(q.quote.goodsMinor).padStart(8)} + ship ${fmt(q.quote.shippingMinor)} + duty ${fmt(q.quote.dutyMinor).padStart(7)} = ${fmt(q.quote.totalMinor)}`);
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
