// Spike (d): PayPal Agent Toolkit read-only tools inside the Vercel AI SDK.
// Source: installed @paypal/agent-toolkit@1.11.0 (ai-sdk/index.d.ts + bundle, read 2026-10-05):
//   new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions, context } }).getTools()
//   → { [method]: Tool } built with AI SDK v4 `tool({ description, parameters, execute })`;
//   get_order is gated by actions.orders.get and takes { id }; pay_order is gated by actions.orders.capture.
// Known risk: the toolkit depends on ai@^4 (its own copy). AI SDK v7 tools use `inputSchema`, not `parameters`.
import { anthropic } from '@ai-sdk/anthropic';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { generateText, stepCountIs, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { type Check, check, createAuthorizeOrder, loadEnv, log, report } from './_lib';

const MODEL = 'claude-opus-5-5';
const FORBIDDEN = /create|pay|capture|authori[sz]e|refund|void|accept|send|cancel|update|delete|record/i;

type V4Execute = (args: { id: string }, opts: { toolCallId: string; messages: unknown[] }) => Promise<unknown>;

export async function run(args: string[]): Promise<void> {
  const env = loadEnv();
  const checks: Check[] = [];

  let orderId = args[0];
  if (!orderId) {
    const { res } = await createAuthorizeOrder();
    orderId = res.body.id;
    log(`created order ${orderId} to read back`);
  }

  // Read-only allowlist: only orders.get.
  const toolkit = new PayPalAgentToolkit({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    configuration: { actions: { orders: { get: true } }, context: { sandbox: true } },
  });
  const tools = toolkit.getTools();
  const names = Object.keys(tools);
  checks.push(check('getTools() is exactly [get_order], no money-moving tools',
    names.length === 1 && names[0] === 'get_order' && !names.some((n) => FORBIDDEN.test(n)), `tools=${JSON.stringify(names)}`));

  // Direct execute (no LLM).
  const execute = (tools.get_order as unknown as { execute?: V4Execute }).execute;
  let direct: unknown;
  try {
    direct = await execute?.({ id: orderId }, { toolCallId: 'spike-d', messages: [] });
  } catch (e) {
    direct = `threw: ${e instanceof Error ? e.message : String(e)}`;
  }
  const directText = typeof direct === 'string' ? direct : JSON.stringify(direct);
  // Never print the raw result: it carries payer details. Only "contains the order id" and the order's status.
  const hasId = !!directText && directText.includes(orderId);
  let status = 'unknown';
  try {
    const s = (JSON.parse(directText ?? '') as { status?: unknown }).status;
    if (typeof s === 'string' && /^[A-Z_]{1,30}$/.test(s)) status = s;
  } catch {
    // not JSON (e.g. "threw: …"): status stays unknown
  }
  checks.push(check('get_order.execute returns the order', hasId, `contains order id: ${hasId ? 'yes' : 'no'}; status: ${status}`));

  if (!env.ANTHROPIC_API_KEY) {
    checks.push({ name: 'LLM tool-calling checks', status: 'SKIP', detail: 'ANTHROPIC_API_KEY not set' });
    return report('spike (d) agent toolkit', checks);
  }

  // Opus 5.5 rejects forced tool_choice, so name the tool in the prompt and use the default (auto).
  const prompt = `Call get_order with id "${orderId}" and report its status in one word.`;
  const calledGetOrder = async (toolset: ToolSet): Promise<string> => {
    const result = await generateText({ model: anthropic(MODEL), tools: toolset, prompt, stopWhen: stepCountIs(2) });
    const results = result.steps.flatMap((s) => s.toolResults).filter((r) => r.toolName === 'get_order');
    const out = results.map((r) => JSON.stringify(r.output)).join(' ');
    return results.length > 0 && out.includes(orderId) ? `ok: ${result.text.slice(0, 60)}` : `no get_order result (text: ${result.text.slice(0, 60)})`;
  };

  // 3a. Toolkit's v4 tools passed straight into v7 (compatibility probe — informs design, not pass/fail).
  let raw: string;
  try {
    raw = await calledGetOrder(tools as unknown as ToolSet);
  } catch (e) {
    raw = `threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160);
  }
  checks.push({ name: 'probe: raw toolkit tools in ai v7 generateText', status: 'INFO', detail: raw });

  // 3b. Our v7 wrapper around the toolkit's execute — the path we'd ship if 3a fails.
  const wrapped = tool({
    description: 'Get a PayPal order by id (read-only).',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }, { toolCallId }) => execute?.({ id }, { toolCallId, messages: [] }),
  });
  let viaWrapper: string;
  try {
    viaWrapper = await calledGetOrder({ get_order: wrapped });
  } catch (e) {
    viaWrapper = `threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160);
  }
  checks.push(check(`v7 wrapper: ${MODEL} calls get_order and gets the order`, viaWrapper.startsWith('ok'), viaWrapper));

  report('spike (d) agent toolkit', checks);
}
