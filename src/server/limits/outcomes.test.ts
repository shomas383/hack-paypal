// Which recorded calls count against the per-session / per-IP / daily limits: everything except refusals and provider
// outages (a call the AI service rejected, e.g. no credit, isn't billed and must not lock judges out or use up the day).
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { classifierCalls } from '../db/schema';
import { countedOutcomes, isCountedOutcome } from './outcomes';

describe('counted outcomes', () => {
  it('RESERVED, OK and ERROR count; REFUSED_* and ERROR_UNAVAILABLE do not', () => {
    for (const o of ['RESERVED', 'OK', 'ERROR']) expect(isCountedOutcome(o), o).toBe(true);
    for (const o of ['REFUSED_DAILY', 'REFUSED_SESSION', 'REFUSED_IP', 'ERROR_UNAVAILABLE']) expect(isCountedOutcome(o), o).toBe(false);
  });

  it('the SQL filter used by reserveCall excludes the same outcomes', () => {
    const q = new PgDialect().sqlToQuery(countedOutcomes(classifierCalls.outcome));
    expect(q.sql).toBe('("classifier_calls"."outcome" not like $1 and "classifier_calls"."outcome" <> $2)');
    expect(q.params).toEqual(['REFUSED%', 'ERROR_UNAVAILABLE']);
  });
});
