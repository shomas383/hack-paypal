// `--exclude-listing` (pnpm agent:live, used to record the one-Japanese-watch replay fixture) narrows the catalog the agent
// sees. It must exist only in scripts/agent-live-run.ts: no route, page or server module may reach it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const NEEDLE = /exclude-?listing/i;

describe('--exclude-listing lives only in scripts/agent-live-run.ts', () => {
  it('no file under src/ references it (this test excepted)', () => {
    const hits = files('src').filter((f) => !f.endsWith('excludeFlag.test.ts') && NEEDLE.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the live-run script has it', () => {
    expect(readFileSync('scripts/agent-live-run.ts', 'utf8')).toMatch(NEEDLE);
  });
});
