// Usage: pnpm spike:paypal <a|b|c|d> [args]   (or pnpm spike:a … spike:d)
// The sandbox guard runs before any spike module is loaded, so a non-sandbox env never reaches the network.
import { loadEnv } from './_lib';

const SPIKES: Record<string, string> = {
  a: './a-orders-authorize',
  b: './b-invoicing',
  c: './c-webhooks',
  d: './d-agent-toolkit',
  e: './e-invoice-zero-custom',
  f: './f-invoice-request-id',
  g: './g-invoice-number',
  h: './h-classifier-structured-output',
};

async function main(): Promise<void> {
  const [which, ...args] = process.argv.slice(2);
  const mod = which ? SPIKES[which] : undefined;
  if (!mod) {
    console.error('Usage: pnpm spike:paypal <a|b|c|d> [args]');
    process.exit(2);
  }
  loadEnv();
  const spike = (await import(mod)) as { run: (args: string[]) => Promise<void> };
  await spike.run(args);
}

main().catch((err: unknown) => {
  console.error(`\nSPIKE ABORTED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
