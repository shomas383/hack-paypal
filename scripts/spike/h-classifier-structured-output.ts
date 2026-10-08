// Spike (h): ONE live classifyListing call — does ai@7 generateText + Output.object work with @ai-sdk/anthropic 4.0.71 and
// claude-opus-5-5 WITHOUT a forced tool_choice (spike d: Opus 5.5 rejects forced tool_choice)?
// Provider source (dist/index.js, read 2026-10-07): claude-opus-5-5 → supportsStructuredOutput: true, rejectsForcedToolUse: true,
// so structuredOutputMode 'auto' should send native `output_config.format`. This spike logs what is actually sent.
// Logs only body keys / tool fields / output_config.format.type and the HTTP status — never headers or the API key.
import { createAnthropic } from '@ai-sdk/anthropic';
import { classifyListing, CLASSIFIER_MODEL } from '../../src/domain/classifier/classify';
import { type Check, check, report } from './_lib';

export async function run(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const sent: { keys: string[]; tools: number; toolChoice: unknown; outputFormat: string | null }[] = [];
  const statuses: number[] = [];
  const anthropic = createAnthropic({
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const oc = body.output_config as { format?: { type?: string } } | undefined;
      sent.push({ keys: Object.keys(body).sort(), tools: Array.isArray(body.tools) ? body.tools.length : 0, toolChoice: body.tool_choice ?? null, outputFormat: oc?.format?.type ?? null });
      const res = await fetch(url, init);
      statuses.push(res.status);
      return res;
    },
  });

  const r = await classifyListing(
    { title: '1990s Japanese automatic diver watch, 21 jewels, stainless case, steel bracelet', origin: 'JP' },
    anthropic(CLASSIFIER_MODEL),
    { threshold: 0.8 },
  );
  const req = sent[0];
  const checks: Check[] = [
    { name: 'request body keys', status: 'INFO', detail: req ? req.keys.join(', ') : 'no request' },
    check('no forced tool_choice, no tools', !!req && req.toolChoice === null && req.tools === 0, `tool_choice=${JSON.stringify(req?.toolChoice)} tools=${req?.tools}`),
    check('native structured output (output_config.format)', req?.outputFormat === 'json_schema', `format.type=${req?.outputFormat}`),
    check('HTTP 200', statuses.length === 1 && statuses[0] === 200, `statuses=${statuses.join(',')}`),
    check('schema-valid classification returned', r.kind === 'OK', r.kind === 'OK' ? `top=${r.output.candidates[0]?.hts10} conf=${r.output.candidates[0]?.confidence}` : r.error),
    { name: 'routing', status: 'INFO', detail: JSON.stringify(r.review) },
  ];
  if (r.kind === 'OK') console.log(JSON.stringify(r.output, null, 1));
  report('spike (h) classifier structured output', checks);
}
