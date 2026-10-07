import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { serverEnv } from '../env';
import * as schema from './schema';

// One pool per process — Next dev hot-reloads modules, so keep it on globalThis.
const g = globalThis as unknown as { __landedSql?: ReturnType<typeof postgres> };
export const sql = (g.__landedSql ??= postgres(serverEnv().databaseUrl, { max: 5 }));
export const db = drizzle(sql, { schema });
export type Db = typeof db;
