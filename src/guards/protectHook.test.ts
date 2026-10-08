import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Runs the real PreToolUse hook (.claude/hooks/protect-rates.mjs) with a tool-call payload on stdin.
const HOOK = join(process.cwd(), '.claude', 'hooks', 'protect-rates.mjs');
function hook(payload: unknown): 'deny' | 'none' {
  const r = spawnSync(process.execPath, [HOOK], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8' });
  expect(r.status).toBe(0);
  if (!r.stdout.trim()) return 'none';
  return (JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision === 'deny' ? 'deny' : 'none';
}
const write = (file_path: string) => ({ tool_name: 'Write', tool_input: { file_path, content: 'x' } });
const edit = (file_path: string) => ({ tool_name: 'Edit', tool_input: { file_path, old_string: 'a', new_string: 'b' } });
const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
const ps = (command: string) => ({ tool_name: 'PowerShell', tool_input: { command } });

describe('protect-rates hook — data/rates/ (unchanged)', () => {
  it('denies Write/Edit under data/rates/, relative or absolute, either slash', () => {
    expect(hook(write('data/rates/x.json'))).toBe('deny');
    expect(hook(edit('C:\\repo\\data\\rates\\2026-rev20-v1.json'))).toBe('deny');
  });
  it('allows exactly pnpm rates:import / rates:validate; denies other commands that mention it', () => {
    expect(hook(bash('pnpm rates:import'))).toBe('none');
    expect(hook(bash('pnpm rates:validate'))).toBe('none');
    expect(hook(bash('cat data/rates/x.json'))).toBe('deny');
  });
});

describe('protect-rates hook — data/hts/ (written only by pnpm hts:import)', () => {
  it('denies Write/Edit under data/hts/, relative or absolute, either slash', () => {
    expect(hook(write('data/hts/x'))).toBe('deny');
    expect(hook(write('C:/Users/me/repo/data/hts/2026-rev20.json'))).toBe('deny');
    expect(hook(edit('C:\\repo\\data\\hts\\2026-rev20.json'))).toBe('deny');
  });
  it('allows exactly pnpm hts:import', () => {
    expect(hook(bash('pnpm hts:import'))).toBe('none');
    expect(hook(ps('pnpm hts:import'))).toBe('none');
  });
  it('denies any other Bash/PowerShell command that mentions data/hts', () => {
    expect(hook(bash('git add data/hts/2026-rev20.json'))).toBe('deny');
    expect(hook(bash('ls data\\hts'))).toBe('deny');
    expect(hook(ps('Get-Content data/hts/2026-rev20.json'))).toBe('deny');
    expect(hook(bash('pnpm hts:import && echo data/hts'))).toBe('deny');
  });
  it('an allowed command for one folder does not open the other', () => {
    expect(hook(bash('pnpm rates:import data/hts'))).toBe('deny');
    expect(hook(bash('pnpm hts:import data/rates'))).toBe('deny');
  });
});

describe('protect-rates hook — everything else', () => {
  it('leaves other paths and commands alone; data/source/hts (the raw export) is not guarded', () => {
    expect(hook(write('src/server/hts.ts'))).toBe('none');
    expect(hook(write('data/source/hts/notes.txt'))).toBe('none');
    expect(hook(bash('pnpm test'))).toBe('none');
  });
  it('fails closed on unparseable stdin or a missing file path', () => {
    expect(hook('not json')).toBe('deny');
    expect(hook({ tool_name: 'Write', tool_input: {} })).toBe('deny');
  });
});
