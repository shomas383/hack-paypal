// DEV ONLY: replays an agent run (src/agent/__fixtures__/replay-de-compare.ndjson) as the same NDJSON stream /api/agent
// sends, so design QA, /dev/states and the replay e2e need no model calls. The fixture is the 2026-10-10 live run
// (`pnpm agent:live`, same quotes and text) adapted to the current tool shapes: search_listings returns only matches plus
// the whole-catalog withheld count, and the four single quotes are one compare_landed_costs call.
// Production → 404 (devToolsEnabled). Query: ?delay=<ms between events, default 30> &hold=<emit N events, then keep the
// stream open: a frozen "streaming" state> &fail=<emit N events, then an error event and close>.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { devToolsEnabled } from '@/server/devOnly';

export const dynamic = 'force-dynamic';

const FIXTURE = join(process.cwd(), 'src', 'agent', '__fixtures__', 'replay-de-compare.ndjson');

const int = (v: string | null, d: number) => (v !== null && /^\d+$/.test(v) ? Number(v) : d);

export async function POST(req: Request): Promise<Response> {
  if (!devToolsEnabled()) return new Response('Not found', { status: 404 });
  const url = new URL(req.url);
  const delay = Math.min(int(url.searchParams.get('delay'), 30), 2000);
  const hold = url.searchParams.has('hold') ? int(url.searchParams.get('hold'), 0) : null;
  const fail = url.searchParams.has('fail') ? int(url.searchParams.get('fail'), 0) : null;
  const lines = readFileSync(FIXTURE, 'utf8').split('\n').filter((l) => l.trim());
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < lines.length; i++) {
        if (hold !== null && i >= hold) return; // keep open until the client goes away
        if (fail !== null && i >= fail) {
          controller.enqueue(enc.encode(`${JSON.stringify({ type: 'error', message: 'the model call failed (replayed error)' })}\n`));
          controller.close();
          return;
        }
        controller.enqueue(enc.encode(`${lines[i]}\n`));
        if (delay) await new Promise((r) => setTimeout(r, delay));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}
