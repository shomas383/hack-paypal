import { anthropic } from '@ai-sdk/anthropic';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { agentDeps } from '@/agent/deps';
import { AGENT_MODEL, runAgent, type AgentEvent } from '@/agent/run';
import { parseBudgetField } from '@/domain/agent/checks';
import { failureOutcome, logAiError } from '@/server/aiError';
import { toJsonError } from '@/server/http';
import { clientIp } from '@/server/limits/clientIp';
import { finishClassifierCall, reserveCall } from '@/server/limits/classifierCalls';
import { serverEnv } from '@/server/env';
import { ensureSessionId } from '@/server/session';

export const dynamic = 'force-dynamic';

const Body = z.object({ message: z.string().trim().min(3).max(500), budget: z.string().max(20) }).strict();

/**
 * POST /api/agent { message, budget } → NDJSON stream of AgentEvent lines.
 * `budget` is the buyer-CONFIRMED field from /agent (e.g. "400.00"); without a valid one the run is refused (400).
 * The model never sets the budget; the agent's tools can only read and prepare a PENDING proposal.
 */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'send { message, budget }' }, { status: 400 });
    const budgetMinor = parseBudgetField(parsed.data.budget);
    if (budgetMinor === null) return NextResponse.json({ error: 'confirm a budget (delivered, in USD) before running the agent' }, { status: 400 });

    const sessionId = await ensureSessionId();
    const callId = await reserveCall('agent', sessionId, clientIp((n) => req.headers.get(n), serverEnv().trustedProxyHops)); // 429 over budget

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
        try {
          const done = await runAgent({ message: parsed.data.message, budgetMinor: BigInt(budgetMinor), sessionId, model: anthropic(AGENT_MODEL), deps: agentDeps(), onEvent: send });
          // A provider outage (no credit, bad key, overload) is recorded but not counted against the limits.
          await finishClassifierCall(callId, done.failure ? failureOutcome(done.failure) : 'OK');
        } catch (e) {
          // A code only: the provider's message goes to the server log, never into the stream.
          const code = logAiError('agent', e);
          send({ type: 'error', code });
          await finishClassifierCall(callId, failureOutcome(code)).catch(() => undefined);
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}
