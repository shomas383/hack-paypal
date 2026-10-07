// Runs once when a Next.js server instance starts, before it handles requests (Next 16 docs:
// 01-app/02-guides/instrumentation.md). Sandbox lock at boot, not on first request (invariant 9).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { bootCheck } = await import('./server/boot');
  const r = bootCheck(process.env);
  if (!r.ok) {
    console.error(`BOOT REFUSED: ${r.message}`);
    process.exit(1);
  }
}
