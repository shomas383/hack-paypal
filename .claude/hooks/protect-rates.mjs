// PreToolUse guard (Edit|Write|Bash|PowerShell). data/rates/ holds human-verified duty rates and is written only by
// scripts/import-verify-sheet.ts, so any other direct change there is denied. ("ask" was auto-resolved by the
// permission mode, so it didn't stop anything.)
//  - Edit/Write: deny if tool_input.file_path is under data/rates/. FAIL CLOSED (deny) if the path is missing or stdin isn't JSON.
//  - Bash/PowerShell: deny if the command mentions data/rates and isn't exactly an allowed pnpm script. Parse errors → no decision.
// Every run appends one line to protect-rates.log (gitignored). stdout carries ONLY the decision JSON (deny) or nothing.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = join(dirname(fileURLToPath(import.meta.url)), 'protect-rates.log');
const ALLOWED_BASH = new Set(['pnpm rates:import', 'pnpm rates:validate']);
const REASON =
  'data/rates/ holds human-verified duty rates; it is written only by scripts/import-verify-sheet.ts ' +
  '(pnpm rates:import). Use pnpm rates:import to regenerate rate data.';

const norm = (s) => s.replace(/\\/g, '/');

function decide(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Can't tell which tool this is; the matcher only sends Edit|Write|Bash|PowerShell, so fail closed (deny).
    return { tool: '?', target: '(unparseable stdin)', decision: 'deny' };
  }
  const tool = String(input?.tool_name ?? '?');
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = input?.tool_input?.command;
    if (typeof cmd !== 'string') return { tool, target: '(no command)', decision: 'none' };
    const touchesRates = norm(cmd).includes('data/rates');
    const allowed = ALLOWED_BASH.has(cmd.trim());
    return { tool, target: cmd, decision: touchesRates && !allowed ? 'deny' : 'none' };
  }
  // Edit / Write (and anything else the matcher lets through): fail closed (deny) without a path.
  const path = input?.tool_input?.file_path;
  if (typeof path !== 'string' || path.trim() === '') return { tool, target: '(missing file_path)', decision: 'deny' };
  const p = norm(path);
  const underRates = p.includes('/data/rates/') || p.startsWith('data/rates/');
  return { tool, target: path, decision: underRates ? 'deny' : 'none' };
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  const { tool, target, decision } = decide(raw);
  try {
    const oneLine = target.replace(/\s+/g, ' ').slice(0, 300);
    appendFileSync(LOG, `${new Date().toISOString()}\t${tool}\t${oneLine}\t${decision}\n`);
  } catch {
    // Logging must never change the decision.
  }
  if (decision === 'deny') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON },
      }) + '\n',
    );
  }
  process.exit(0);
});
