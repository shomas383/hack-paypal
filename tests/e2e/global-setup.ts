// Fail fast with a clear message if Postgres isn't up or the demo listings aren't seeded.
import postgres from 'postgres';

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set in .env (see .env.example)');
  const sql = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    const [row] = await sql<{ n: string }[]>`select count(*)::text as n from listings`;
    if (Number(row?.n ?? 0) < 5) throw new Error('demo listings missing — run pnpm db:seed');
  } catch (e) {
    throw new Error(`e2e needs Postgres with seeded listings (docker compose up -d && pnpm db:migrate && pnpm db:seed): ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await sql.end();
  }
}
