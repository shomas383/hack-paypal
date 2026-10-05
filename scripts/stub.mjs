// Placeholder for package.json scripts whose feature doesn't exist yet.
// Exits non-zero on purpose so a stub can never pass silently in CI.
const [name = 'script', what = ''] = process.argv.slice(2);
console.error(`[${name}] not implemented yet${what ? ` — ${what}` : ''}`);
process.exit(1);
