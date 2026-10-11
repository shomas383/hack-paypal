// Reserve an LLM call BEFORE calling the model: count this KIND's calls by the session and IP in the last hour and all of
// this kind's calls today (UTC), refuse with 429 over budget, otherwise insert a RESERVED row. One transaction under an
// advisory lock, so concurrent requests cannot both slip under a limit. Kinds: 'classifier' (SPEC §4.1), 'agent'
// (SPEC §4.4, one row per agent run) and 'estimate' (one row per public estimate); each kind has its own limits (env).
import { and, count, eq, gte, sql as dsql, type SQL } from 'drizzle-orm';
import { CheckoutError } from '../checkout';
import { db } from '../db/client';
import { classifierCalls } from '../db/schema';
import { serverEnv } from '../env';
import { checkClassifierBudget } from './classifierBudget';

export type CallKind = 'classifier' | 'agent' | 'estimate';

const notRefused = () => dsql`${classifierCalls.outcome} not like 'REFUSED%'`;

export async function reserveCall(kind: CallKind, sessionId: string, ip: string, now = new Date()): Promise<bigint> {
  const env = serverEnv();
  const limits = kind === 'agent' ? env.agentLimits : kind === 'estimate' ? env.estimateLimits : env.classifierLimits;
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const result = await db.transaction(async (tx) => {
    await tx.execute(dsql`select pg_advisory_xact_lock(hashtext('classifier_calls'))`);
    const n = async (...conds: SQL[]) =>
      (await tx.select({ n: count() }).from(classifierCalls).where(and(notRefused(), eq(classifierCalls.kind, kind), ...conds)))[0]?.n ?? 0;
    const decision = checkClassifierBudget(
      {
        sessionLastHour: await n(eq(classifierCalls.sessionId, sessionId), gte(classifierCalls.at, hourAgo)),
        ipLastHour: await n(eq(classifierCalls.ip, ip), gte(classifierCalls.at, hourAgo)),
        today: await n(gte(classifierCalls.at, dayStart)),
      },
      limits,
    );
    if (!decision.ok) return { refused: decision.refused };
    const [row] = await tx.insert(classifierCalls).values({ kind, sessionId, ip, outcome: 'RESERVED', at: now }).returning({ id: classifierCalls.id });
    return { id: row!.id };
  });

  if ('refused' in result) {
    // Recorded after the transaction (a throw inside it would roll the row back); refusals are not counted.
    await db.insert(classifierCalls).values({ kind, sessionId, ip, outcome: `REFUSED_${result.refused}`, at: now });
    const what = kind === 'agent' ? 'agent' : kind === 'estimate' ? 'estimate' : 'classifier';
    throw new CheckoutError(429, result.refused === 'DAILY' ? `${what} daily limit reached — try again tomorrow` : `too many ${what} requests — try again later`);
  }
  return result.id;
}

export const reserveClassifierCall = (sessionId: string, ip: string, now = new Date()) => reserveCall('classifier', sessionId, ip, now);

export async function finishClassifierCall(id: bigint, outcome: 'OK' | 'ERROR'): Promise<void> {
  await db.update(classifierCalls).set({ outcome }).where(eq(classifierCalls.id, id));
}
