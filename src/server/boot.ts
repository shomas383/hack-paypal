// Startup gate (invariant 9): the server must not come up unless the env parses as SANDBOX. Used by
// src/instrumentation.ts (once, before the server accepts requests) and by GET /api/health.
import { parseServerEnv } from './env';

export type BootResult = { ok: true } | { ok: false; message: string };

export function bootCheck(raw: Record<string, string | undefined>): BootResult {
  try {
    parseServerEnv(raw);
    return { ok: true };
  } catch (e) {
    // parseServerEnv messages name variables, never values (invariant 10).
    return { ok: false, message: e instanceof Error ? e.message : 'invalid server environment' };
  }
}
