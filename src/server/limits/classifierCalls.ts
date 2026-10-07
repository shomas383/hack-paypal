// Reserve a classifier call BEFORE calling the LLM: count the session's and IP's calls in the last hour and all calls
// today (UTC), refuse with 429 over budget, otherwise insert a RESERVED row. One transaction under an advisory lock,
// so concurrent requests cannot both slip under a limit. Used by the classifier route (SPEC §4.1).
import { and, count, eq, gte, sql as dsql, type SQL } from 'drizzle-orm';
import { CheckoutError } from '../checkout';
import { db } from '../db/client';
import { classifierCalls } from '../db/schema';
import { serverEnv } from '../env';
import { checkClassifierBudget } from './classifierBudget';

const notRefused = () => dsql`${classifierCalls.outcome} not like 'REFUSED%'`;

export async function reserveClassifierCall(sessionId: string, ip: string, now = new Date()): Promise<bigint> {
  const limits = serverEnv().classifierLimits;
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const result = await db.transaction(async (tx) => {
    await tx.execute(dsql`select pg_advisory_xact_lock(hashtext('classifier_calls'))`);
    const n = async (...conds: SQL[]) =>
      (await tx.select({ n: count() }).from(classifierCalls).where(and(notRefused(), ...conds)))[0]?.n ?? 0;
    const decision = checkClassifierBudget(
      {
        sessionLastHour: await n(eq(classifierCalls.sessionId, sessionId), gte(classifierCalls.at, hourAgo)),
        ipLastHour: await n(eq(classifierCalls.ip, ip), gte(classifierCalls.at, hourAgo)),
        today: await n(gte(classifierCalls.at, dayStart)),
      },
      limits,
    );
    if (!decision.ok) return { refused: decision.refused };
    const [row] = await tx.insert(classifierCalls).values({ sessionId, ip, outcome: 'RESERVED', at: now }).returning({ id: classifierCalls.id });
    return { id: row!.id };
  });

  if ('refused' in result) {
    // Recorded after the transaction (a throw inside it would roll the row back); refusals are not counted.
    await db.insert(classifierCalls).values({ sessionId, ip, outcome: `REFUSED_${result.refused}`, at: now });
    throw new CheckoutError(429, result.refused === 'DAILY' ? 'classifier daily limit reached — try again tomorrow' : 'too many classifier requests — try again later');
  }
  return result.id;
}

export async function finishClassifierCall(id: bigint, outcome: 'OK' | 'ERROR'): Promise<void> {
  await db.update(classifierCalls).set({ outcome }).where(eq(classifierCalls.id, id));
}
