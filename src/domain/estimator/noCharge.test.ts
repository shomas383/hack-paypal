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

const MONEY_PATH = ['src/server/paypal', 'src/server/webhooks', 'src/domain/policy', 'src/agent', 'src/app/checkout', 'src/app/api/quotes', 'src/app/api/orders', 'src/app/api/webhooks', 'src/domain/quote'];
/** Money-path files outside those folders: the checkout service (authorize / capture / void) and the invoice flow. */
const MONEY_FILES = ['src/server/checkout.ts', 'src/server/invoiceFlow.ts'];
/** Code only: comments may name things ("the verified rate path (data/rates, …) never reads this"). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** The estimator domain, the runtime loader (server/estimator), the reviewed lists (server/estimatorReview) and estimate routes. */
const IMPORTS_ESTIMATOR = /from\s+['"][^'"]*(?:domain\/estimator|server\/estimator|api\/estimates)[^'"]*['"]|from\s+['"]\.{1,2}\/(?:\.\.\/)*(?:estimator|estimatorReview|estimates)\b/;

describe('no money-moving or quoting code imports the estimator', () => {
  const files = [...MONEY_PATH.filter(exists).flatMap(walk), ...MONEY_FILES];
  it('covers the money path', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.includes(join('src', 'server', 'paypal')))).toBe(true);
    expect(files.some((f) => f.includes(join('src', 'domain', 'policy')))).toBe(true);
    expect(files).toEqual(expect.arrayContaining(MONEY_FILES));
  });
  it('the pattern catches every way the estimator can be imported', () => {
    for (const s of ["from '@/domain/estimator/estimate'", "from '@/server/estimator'", "from '@/server/estimatorReview'", "from '../estimator'", "from './estimatorReview'", "from '@/app/api/estimates/route'"])
      expect(s).toMatch(IMPORTS_ESTIMATOR);
    expect("from '@/server/checkout'").not.toMatch(IMPORTS_ESTIMATOR);
  });
  it.each(files.map((f) => [relative(root, join(root, f))]))('%s', (rel) => {
    expect(readFileSync(join(root, rel), 'utf8')).not.toMatch(IMPORTS_ESTIMATOR);
  });
});

describe('the estimates service and routes touch only the estimates table (no quotes, listings, orders, approvals, PayPal)', () => {
  const files = ['src/server/estimates.ts', ...walk('src/app/api/estimates').filter((f) => !f.endsWith('.test.ts'))];
  it.each(files.map((f) => [f]))('%s', (rel) => {
    const src = code(readFileSync(join(root, rel), 'utf8'));
    expect(src).not.toMatch(/\b(quotes|listings|orders|approvals|invoices|purchaseProposals)\b(?=[^'"]*(?:,|}|\)))/);
    expect(src).not.toMatch(/from\s+['"](?:@\/server\/|\.\/)(?:paypal|invoiceFlow|policy)/);
    expect(src).not.toMatch(/\b(capture|authorize|createOrder)\w*\(/);
  });
  it('covers the service and the three routes', () => expect(files).toHaveLength(4));
});

describe('the estimator writes nothing and never touches quotes, listings or the rate data', () => {
  const files = [...walk('src/domain/estimator'), 'src/server/estimator.ts', 'src/server/estimatorReview.ts'].filter((f) => !/\.test\.ts$|__fixtures__/.test(f));
  it.each(files.map((f) => [f]))('%s', (rel) => {
    const src = code(readFileSync(join(root, rel), 'utf8'));
    expect(src).not.toMatch(/\b(writeFile|writeFileSync|appendFile|createWriteStream|unlink|mkdir)\s*\(/);
    expect(src).not.toMatch(/data[\\/'"\s,]+rates/);
    expect(src).not.toMatch(/\b(quotes|listings)\b.*\b(insert|update)\b/i);
    expect(src).not.toMatch(/from\s+['"]@\/server\/(db|paypal)/);
  });
});
