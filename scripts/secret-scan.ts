// pnpm secrets:scan <range> — run before every push (e.g. `pnpm secrets:scan origin/main..main`). Scans every file
// touched and every line added by each commit in the range (src/guards/secretScan.ts: four rules) and prints
// file:line (commit, rule) only — never the matched text. Exit 1 on any finding.
// Rule 3's known values are collected here at runtime and never written anywhere: the secret-bearing keys of .env
// (and the process env), `git config user.email`, and SECRET_SCAN_EXTRA (comma-separated, e.g. a scratch passcode).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { formatFinding, scanPatch } from '../src/guards/secretScan';

const KNOWN_KEYS = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'PAYPAL_SANDBOX_BUYER_EMAIL',
  'PAYPAL_SANDBOX_BUYER_PASSWORD',
  'NEXT_PUBLIC_PAYPAL_CLIENT_ID',
  'ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'SELLER_CONSOLE_PASSCODE',
];

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function knownValues(): string[] {
  if (existsSync('.env')) process.loadEnvFile('.env');
  let email = '';
  try {
    email = git('config', 'user.email').trim();
  } catch {
    // no user.email configured
  }
  const extra = (process.env.SECRET_SCAN_EXTRA ?? '').split(',').map((s) => s.trim());
  return [...KNOWN_KEYS.map((k) => process.env[k] ?? ''), email, ...extra].filter(Boolean);
}

function main() {
  const range = process.argv[2];
  if (!range || range.startsWith('-')) {
    console.error('usage: pnpm secrets:scan <range>   e.g. pnpm secrets:scan origin/main..main');
    process.exitCode = 2;
    return;
  }
  const commits = git('rev-list', '--count', range).trim();
  const patch = git('log', '-p', '--unified=0', '--no-color', '--no-renames', '--no-ext-diff', '--format=commit %H', range);
  const findings = scanPatch(patch, knownValues());
  const touched = new Set(git('diff', '--name-only', range).split('\n').filter(Boolean)).size;
  if (findings.length) {
    for (const f of findings) console.log(formatFinding(f));
    console.log(`secrets:scan ${range}: ${commits} commits, ${touched} files — ${findings.length} finding(s). Do not push.`);
    process.exitCode = 1;
    return;
  }
  console.log(`secrets:scan ${range}: ${commits} commits, ${touched} files — clean (rules 1–4).`);
}

main();
