// Design-system guard (docs/design/brief.md): components use tokens only. No raw hex colours, px lengths, ms durations
// or rgb()/hsl() in CSS modules or inline styles; tokens.css is the only place they are defined. Breakpoints in
// @media/@container lines are exempt (CSS variables can't be used there). Files from before the design system are listed
// in LEGACY and must be migrated; the list may only shrink, and it is empty once the buyer pages are refreshed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src');
const LEGACY = new Set<string>([
  'src/app/agent/agent.module.css',
  'src/app/agent/AgentClient.tsx',
  'src/app/checkout/[quoteId]/page.tsx',
  'src/app/checkout/[quoteId]/CheckoutClient.tsx',
  'src/app/listings/page.tsx',
  'src/app/page.tsx',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const RAW = [
  { name: 'hex colour', re: /#[0-9a-fA-F]{3,8}\b/ },
  { name: 'px length', re: /(?<![\w-])\d*\.?\d+px\b/ },
  { name: 'ms duration', re: /(?<![\w-])\d*\.?\d+m?s\b(?=\s*[,;)'"]|\s*(?:var|cubic|ease|linear)|$)/ },
  { name: 'rgb/hsl colour', re: /\b(?:rgba?|hsla?)\(/ },
];

export function violations(path: string, text: string): string[] {
  const out: string[] = [];
  const isTsx = path.endsWith('.tsx');
  text.split('\n').forEach((line, i) => {
    if (/^\s*@(media|container)\b/.test(line)) return;
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return; // comments
    // In TSX only inline style objects count (class names, copy and URLs are not styles).
    const scope = isTsx ? (/style=\{\{/.test(line) ? line : '') : line;
    if (!scope) return;
    for (const r of RAW) if (r.re.test(scope)) out.push(`${path}:${i + 1} ${r.name}: ${line.trim()}`);
  });
  return out;
}

describe('design tokens guard', () => {
  const files = walk(ROOT)
    .filter((p) => p.endsWith('.module.css') || (p.endsWith('.tsx') && !p.endsWith('.test.tsx')))
    .map((p) => relative(process.cwd(), p).split(sep).join('/'))
    .filter((p) => p !== 'src/app/styles/tokens.css');

  it('catches raw values (self-test)', () => {
    expect(violations('x.module.css', 'a { color: #fff; }')).toHaveLength(1);
    expect(violations('x.module.css', 'a { padding: 12px; }')).toHaveLength(1);
    expect(violations('x.module.css', 'a { transition: opacity 120ms var(--ease); }')).toHaveLength(1);
    expect(violations('x.module.css', 'a { color: rgb(0 0 0 / 0.5); }')).toHaveLength(1);
    expect(violations('x.module.css', '@media (min-width: 768px) {')).toHaveLength(0);
    expect(violations('x.module.css', 'a { padding: var(--space-3); transition: opacity var(--dur-1) var(--ease); }')).toHaveLength(0);
    expect(violations('x.tsx', '<div style={{ padding: 12 }} className="p-12px" />')).toHaveLength(0);
    expect(violations('x.tsx', "<div style={{ color: '#555' }} />")).toHaveLength(1);
  });

  it('every legacy file still exists (remove it from LEGACY once migrated)', () => {
    for (const p of LEGACY) expect(files).toContain(p);
  });

  it('no raw hex / px / ms / rgb() outside tokens.css (except LEGACY files)', () => {
    const found = files.filter((p) => !LEGACY.has(p)).flatMap((p) => violations(p, readFileSync(p, 'utf8')));
    expect(found).toEqual([]);
  });
});
