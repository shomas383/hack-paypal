// DEV ONLY: replays an agent run (src/agent/__fixtures__/replay-de-compare.ndjson) as the same NDJSON stream /api/agent
// sends, so design QA, /dev/states and the replay e2e need no model calls. The fixture is the 2026-10-10 live run
// (`pnpm agent:live`, same quotes and text) adapted to the current tool shapes: search_listings returns only matches plus
// the whole-catalog withheld count, and the four single quotes are one compare_landed_costs call.
// &fixture=ja replays src/agent/__fixtures__/replay-de-compare-ja.ndjson instead: an UNEDITED live run (2026-10-11 00:17 UTC,
// claude-opus-5-5) recorded with `pnpm agent:live --exclude-listing L-C-8af89a9e --out …` against the local DB, so the
// catalog (10 listings) has exactly one seller-published Japanese watch (L-C-469846d7), found through its official HTS
// description — like production after the video. The excluded listing is the second local Japanese watch.
// Production → 404 (devToolsEnabled). Query: ?delay=<ms between events, default 30> &hold=<emit N events, then keep the
// stream open: a frozen "streaming" state> &fail=<emit N events, then an error event and close> &failCode=<AI_UNAVAILABLE:
// the error is a provider outage; otherwise FAILED> &fixture=<default | ja>.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { devToolsEnabled } from '@/server/devOnly';

export const dynamic = 'force-dynamic';

/** Allowlist: the query parameter picks a name, never a path. Literal paths, so the build traces only these two files. */
const FIXTURES: Record<string, () => string> = {
  default: () => readFileSync(join(process.cwd(), 'src', 'agent', '__fixtures__', 'replay-de-compare.ndjson'), 'utf8'),
  ja: () => readFileSync(join(process.cwd(), 'src', 'agent', '__fixtures__', 'replay-de-compare-ja.ndjson'), 'utf8'),
};

const int = (v: string | null, d: number) => (v !== null && /^\d+$/.test(v) ? Number(v) : d);

export async function POST(req: Request): Promise<Response> {
  if (!devToolsEnabled()) return new Response('Not found', { status: 404 });
  const url = new URL(req.url);
  const delay = Math.min(int(url.searchParams.get('delay'), 30), 2000);
  const hold = url.searchParams.has('hold') ? int(url.searchParams.get('hold'), 0) : null;
  const fail = url.searchParams.has('fail') ? int(url.searchParams.get('fail'), 0) : null;
  const failCode = url.searchParams.get('failCode') === 'AI_UNAVAILABLE' ? 'AI_UNAVAILABLE' : 'FAILED';
  const read = FIXTURES[url.searchParams.get('fixture') ?? 'default'];
  if (!read) return new Response('Unknown fixture', { status: 400 });
  const lines = read().split('\n').filter((l) => l.trim());
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < lines.length; i++) {
        if (hold !== null && i >= hold) return; // keep open until the client goes away
        if (fail !== null && i >= fail) {
          controller.enqueue(enc.encode(`${JSON.stringify({ type: 'error', code: failCode })}\n`));
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
