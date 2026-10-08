// Spike (i): ONE live grounded classification (two calls) on the real Rev 20 HTS index, before the eval builds on it.
// Listing: eval P08 title (the ungrounded model answered the pre-renumbering 6203.42.4011 in all 3 B1 runs).
// Logs only body keys / tool fields / output_config.format.type and HTTP status — never headers or the API key.
import { createAnthropic } from '@ai-sdk/anthropic';
import { CLASSIFIER_MODEL } from '../../src/domain/classifier/classify';
import { classifyListingGrounded } from '../../src/domain/classifier/classifyGrounded';
import { currentHtsIndex } from '../../src/server/hts';
import { type Check, check, report } from './_lib';

export async function run(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const sent: { keys: string[]; tools: number; toolChoice: unknown; outputFormat: string | null; status?: number }[] = [];
  const anthropic = createAnthropic({
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const oc = body.output_config as { format?: { type?: string } } | undefined;
      const entry: (typeof sent)[number] = { keys: Object.keys(body).sort(), tools: Array.isArray(body.tools) ? body.tools.length : 0, toolChoice: body.tool_choice ?? null, outputFormat: oc?.format?.type ?? null };
      sent.push(entry);
      const res = await fetch(url, init);
      entry.status = res.status;
      return res;
    },
  });

  const { lookup } = currentHtsIndex();
  const r = await classifyListingGrounded({ title: "Men's selvedge blue denim jeans, 100% cotton", origin: 'JP' }, anthropic(CLASSIFIER_MODEL), { threshold: 0.8, idx: lookup });

  console.log(JSON.stringify({ kind: r.kind, review: r.review, meta: r.meta, ...(r.kind === 'OK' ? { choice: r.choice, offered: r.candidates.map((c) => c.code) } : {}), ...(r.kind === 'INVALID_OUTPUT' ? { stage: r.stage, error: r.error } : {}) }, null, 1));
  const top = r.kind === 'OK' ? [...r.choice.candidates].sort((a, b) => b.confidence - a.confidence)[0] : undefined;
  const checks: Check[] = [
    ...sent.map((s, i) => ({ name: `call ${i + 1} request`, status: 'INFO' as const, detail: `keys=${s.keys.join(',')} status=${s.status}` })),
    check('no forced tool_choice, no tools (both calls)', sent.every((s) => s.toolChoice === null && s.tools === 0), JSON.stringify(sent.map((s) => [s.toolChoice, s.tools]))),
    check('native structured output (both calls)', sent.length > 0 && sent.every((s) => s.outputFormat === 'json_schema'), sent.map((s) => s.outputFormat).join(',')),
    check('HTTP 200 (both calls)', sent.length === 2 && sent.every((s) => s.status === 200), sent.map((s) => s.status).join(',')),
    check('choice made from the expanded list', r.kind === 'OK', r.kind),
    { name: 'top code (verified: 6203.42.4511)', status: 'INFO', detail: top ? `${top.hts10} conf=${top.confidence}` : 'none' },
    { name: 'routing', status: 'INFO', detail: JSON.stringify(r.review) },
  ];
  report('spike (i) grounded classifier', checks);
}
