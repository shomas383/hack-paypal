// pnpm seller:seed [--force]
// LIVE: classifies the two seller demo samples (src/domain/seller/samples.ts) with the grounded classifier (2 model calls
// each, under the classifier rate limit), so the seller console's review queue isn't empty on a fresh database. Nothing is
// accepted or published: the demo does that by hand. Skips a sample that already has a grounded classification with the
// same title (use --force to classify it again). Not part of CI; never run implicitly by a deploy.
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SELLER_SAMPLES } from '../src/domain/seller/samples';

// Load .env BEFORE importing anything that reads the server env (ESM evaluates static imports first).
if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');

async function main() {
  const force = process.argv.includes('--force');
  const { eq } = await import('drizzle-orm');
  const { db, sql } = await import('../src/server/db/client');
  const { classifications } = await import('../src/server/db/schema');
  const { runGroundedClassification, startGroundedClassification, getClassificationView } = await import('../src/server/seller/classify');
  const seedSession = randomUUID(); // "who" in the audit for these rows

  for (const x of SELLER_SAMPLES) {
    const same = (await db.select().from(classifications).where(eq(classifications.kind, 'grounded'))).filter((r) => r.input.title === x.title);
    if (same.length && !force) {
      console.log(`skip  ${x.key}: already classified (${same.map((r) => `${r.id.slice(0, 8)} ${r.status}`).join(', ')}); use --force to classify again`);
      continue;
    }
    const t0 = Date.now();
    const { id } = await startGroundedClassification(
      { title: x.title, ...(x.description ? { description: x.description } : {}), origin: x.origin, priceMinor: x.priceMinor, shippingMinor: x.shippingMinor },
      seedSession,
      'seller-seed',
    );
    await runGroundedClassification(id);
    const v = await getClassificationView(id);
    console.log(
      `done  ${x.key}: ${id.slice(0, 8)} ${v.status} · top ${v.top ? `${v.top.hts10} (${v.top.confidence.toFixed(2)})` : 'none'} · reasons ${v.reasons.join(', ') || 'none'} · ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
  }
  await sql.end();
}

main().catch((e: unknown) => {
  console.error(`SELLER SEED ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
