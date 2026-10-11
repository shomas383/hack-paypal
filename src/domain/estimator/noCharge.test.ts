import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// An estimate can never be charged: nothing on the money path imports the estimator, and the estimator never writes files
// or touches quotes/listings (its result types are its own, not QuoteResult).
const root = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(root, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
const exists = (dir: string) => {
  try {
    return statSync(join(root, dir)).isDirectory();
  } catch {
    return false;
  }
};

const MONEY_PATH = ['src/server/paypal', 'src/domain/policy', 'src/agent', 'src/app/checkout', 'src/app/api/quotes', 'src/app/api/orders', 'src/app/api/webhooks', 'src/domain/quote'];
/** Code only: comments may name things ("the verified rate path (data/rates, …) never reads this"). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const IMPORTS_ESTIMATOR = /from\s+['"][^'"]*domain\/estimator[^'"]*['"]|from\s+['"]\.{1,2}\/(?:\.\.\/)*estimator/;

describe('no money-moving or quoting code imports the estimator', () => {
  const files = MONEY_PATH.filter(exists).flatMap(walk);
  it('covers the money path', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.includes(join('src', 'server', 'paypal')))).toBe(true);
    expect(files.some((f) => f.includes(join('src', 'domain', 'policy')))).toBe(true);
  });
  it.each(files.map((f) => [relative(root, join(root, f))]))('%s', (rel) => {
    expect(readFileSync(join(root, rel), 'utf8')).not.toMatch(IMPORTS_ESTIMATOR);
  });
});

describe('the estimator writes nothing and never touches quotes, listings or the rate data', () => {
  const files = walk('src/domain/estimator').filter((f) => !/\.test\.ts$|__fixtures__/.test(f));
  it.each(files.map((f) => [f]))('%s', (rel) => {
    const src = code(readFileSync(join(root, rel), 'utf8'));
    expect(src).not.toMatch(/\b(writeFile|writeFileSync|appendFile|createWriteStream|unlink|mkdir)\s*\(/);
    expect(src).not.toMatch(/data[\\/'"\s,]+rates/);
    expect(src).not.toMatch(/\b(quotes|listings)\b.*\b(insert|update)\b/i);
    expect(src).not.toMatch(/from\s+['"]@\/server\/(db|paypal)/);
  });
});
