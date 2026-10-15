// Which recorded calls count against the per-session / per-IP / daily limits. Refusals never count, and neither do provider
// outages (ERROR_UNAVAILABLE: the AI service rejected the call, e.g. no credit or a bad key — not billed, and it must not
// lock visitors out or use up the day). RESERVED, OK and ERROR count.
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

export type CallOutcome = 'OK' | 'ERROR' | 'ERROR_UNAVAILABLE';

const UNCOUNTED_PREFIX = 'REFUSED';
const UNCOUNTED = 'ERROR_UNAVAILABLE';

export const isCountedOutcome = (outcome: string) => !outcome.startsWith(UNCOUNTED_PREFIX) && outcome !== UNCOUNTED;

export const countedOutcomes = (column: AnyColumn): SQL => sql`(${column} not like ${`${UNCOUNTED_PREFIX}%`} and ${column} <> ${UNCOUNTED})`;
