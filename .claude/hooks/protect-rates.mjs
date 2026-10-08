// PreToolUse guard (Edit|Write|Bash|PowerShell) for generated, protected data folders:
//  - data/rates/: human-verified duty rates, written only by scripts/import-verify-sheet.ts (pnpm rates:import)
//  - data/hts/:   the Rev 20 HTS index (codes + description chains), written only by scripts/import-hts.ts (pnpm hts:import)
// Any other direct change there is denied. ("ask" was auto-resolved by the permission mode, so it didn't stop anything.)
//  - Edit/Write: deny if tool_input.file_path is under a protected folder. FAIL CLOSED (deny) if the path is missing or stdin
//    isn't JSON.
//  - Bash/PowerShell: deny if the command mentions a protected folder and isn't exactly one of THAT folder's allowed pnpm
//    scripts (a command mentioning both folders is always denied). Parse errors → no decision.
// Every run appends one line to protect-rates.log (gitignored). stdout carries ONLY the decision JSON (deny) or nothing.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = join(dirname(fileURLToPath(import.meta.url)), 'protect-rates.log');
const PROTECTED = [
  {
    dir: 'data/rates',
    allowed: new Set(['pnpm rates:import', 'pnpm rates:validate']),
    reason:
      'data/rates/ holds human-verified duty rates; it is written only by scripts/import-verify-sheet.ts ' +
      '(pnpm rates:import). Use pnpm rates:import to regenerate rate data.',
  },
  {
    dir: 'data/hts',
    allowed: new Set(['pnpm hts:import']),
    reason:
      'data/hts/ holds the official Rev 20 HTS index; it is written only by scripts/import-hts.ts (pnpm hts:import). ' +
      'Use pnpm hts:import to regenerate it; read it with the Read tool.',
  },
];

const norm = (s) => s.replace(/\\/g, '/');

function decide(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Can't tell which tool this is; the matcher only sends Edit|Write|Bash|PowerShell, so fail closed (deny).
    return { tool: '?', target: '(unparseable stdin)', decision: 'deny', reason: PROTECTED.map((p) => p.reason).join(' ') };
  }
  const tool = String(input?.tool_name ?? '?');
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = input?.tool_input?.command;
    if (typeof cmd !== 'string') return { tool, target: '(no command)', decision: 'none' };
    const touched = PROTECTED.filter((p) => norm(cmd).includes(p.dir));
    const denied = touched.find((p) => !p.allowed.has(cmd.trim()));
    return denied ? { tool, target: cmd, decision: 'deny', reason: denied.reason } : { tool, target: cmd, decision: 'none' };
  }
  // Edit / Write (and anything else the matcher lets through): fail closed (deny) without a path.
  const path = input?.tool_input?.file_path;
  if (typeof path !== 'string' || path.trim() === '') {
    return { tool, target: '(missing file_path)', decision: 'deny', reason: PROTECTED.map((p) => p.reason).join(' ') };
  }
  const p = norm(path);
  const hit = PROTECTED.find((d) => p.includes(`/${d.dir}/`) || p.startsWith(`${d.dir}/`));
  return hit ? { tool, target: path, decision: 'deny', reason: hit.reason } : { tool, target: path, decision: 'none' };
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  const { tool, target, decision, reason } = decide(raw);
  try {
    const oneLine = target.replace(/\s+/g, ' ').slice(0, 300);
    appendFileSync(LOG, `${new Date().toISOString()}\t${tool}\t${oneLine}\t${decision}\n`);
  } catch {
    // Logging must never change the decision.
  }
  if (decision === 'deny') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
      }) + '\n',
    );
  }
  process.exit(0);
});
