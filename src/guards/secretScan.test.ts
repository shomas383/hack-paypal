// Fake secrets are built by concatenation so this file never contains a string the scanner would flag
// (the last test scans this file and the module themselves).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatFinding, lineRules, parsePatch, scanPatch, sensitivePath } from './secretScan';

const j = (...p: string[]) => p.join('');
const mixed = (n: number) => Array.from({ length: n }, (_, i) => 'aZ9'[i % 3]).join(''); // lower + upper + digit

describe('parsePatch — added lines with file and new-file line number, per commit', () => {
  it('follows commit, file and hunk headers; ignores removed lines and deletions', () => {
    const patch = [
      'commit 1111111111111111111111111111111111111111',
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,0 +4,2 @@',
      '+first',
      '+second',
      '@@ -10 +12 @@',
      '-old',
      '+third',
      'commit 2222222222222222222222222222222222222222',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-x',
    ].join('\n');
    const p = parsePatch(patch);
    expect(p.lines).toEqual([
      { commit: '1111111', file: 'src/a.ts', line: 4, text: 'first' },
      { commit: '1111111', file: 'src/a.ts', line: 5, text: 'second' },
      { commit: '1111111', file: 'src/a.ts', line: 12, text: 'third' },
    ]);
    expect(p.files).toEqual([{ commit: '1111111', file: 'src/a.ts' }]); // deleted files are not "touched"
  });
});

describe('rule 1 — sensitive paths', () => {
  it('flags env files, the gitignored source sheet, keys and QA screenshots; .env.example is the contract', () => {
    for (const f of ['.env', '.env.local', 'apps/x/.env.production', 'data/source/sheet.xlsx', 'certs/server.pem', 'a/b.key', 'x.p12', 'home/id_rsa', 'qa/screenshots/a.png', 'aws/credentials', 'db.sqlite']) {
      expect(sensitivePath(f), f).toBe(true);
    }
    for (const f of ['.env.example', 'src/server/env.ts', 'docs/SPEC.md', 'src/keyboard.ts']) expect(sensitivePath(f), f).toBe(false);
  });
});

describe('rule 2 — secret patterns', () => {
  it.each([
    ['Anthropic key', j('sk-', 'ant-', 'api03-', 'abcdefghijKLMNOP')],
    ['PayPal access token', j('A21', 'AA', 'abcdefghijklmnopqrstuvwxyz')],
    ['private key block', j('-----BEGIN ', 'RSA PRIVATE KEY-----')],
    ['AWS key id', j('AK', 'IA', 'ABCDEFGHIJKLMNOP')],
    ['GitHub token', j('gh', 'p_', 'a'.repeat(36))],
    ['GitHub fine-grained token', j('github', '_pat_', 'a'.repeat(22))],
    ['Slack token', j('xo', 'xb-', '123')],
    ['JWT', j('ey', 'J', 'a'.repeat(16), '.', 'b'.repeat(16), '.sig')],
    ['Postgres URL with a password', j('postgres', '://user:', 'hunter2', '@db:5432/x')],
    ['secret assignment', j('PAYPAL_CLIENT_', 'SECRET=', 'abcdefgh123')],
    ['passcode assignment', j('SELLER_CONSOLE_', 'PASSCODE: "', 'abcdefghijkl"')],
  ])('%s', (_, line) => {
    expect(lineRules(line, [])).toContain(2);
  });

  it('ordinary code is not flagged', () => {
    for (const line of ["const sellerConsolePasscode = serverEnv().sellerConsolePasscode;", 'SELLER_CONSOLE_PASSCODE=', "if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');", 'postgres://localhost:5432/landed']) {
      expect(lineRules(line, []), line).not.toContain(2);
    }
  });
});

describe('rule 3 — known local values (from .env / git config / SECRET_SCAN_EXTRA at runtime, never committed)', () => {
  it('flags a line containing a known value of 8+ characters; shorter values are ignored', () => {
    const known = [j('local-', 'qa-', 'value-1'), 'short'];
    expect(lineRules(j('pass: "local-', 'qa-value-1"'), known)).toContain(3);
    expect(lineRules('this line is short', known)).not.toContain(3);
  });
});

describe('rule 4 — long high-entropy tokens', () => {
  it('32+ chars with lower, upper and digit', () => {
    expect(lineRules(`token ${mixed(32)}`, [])).toContain(4);
    expect(lineRules(`token ${mixed(31)}`, [])).not.toContain(4);
  });

  it('a base64url-style token with a few separators is still flagged', () => {
    expect(lineRules(`k ${mixed(20)}-${mixed(20)}_${mixed(20)}`, [])).toContain(4);
  });

  it('paths, URLs, slug-style test ids and lockfile integrity hashes are not flagged (separators > 1/8, or SRI)', () => {
    expect(lineRules("page.getByTestId('agent-search-hts-match-L-C-469846d7')", [])).toEqual([]);
    expect(lineRules("hook(write('C:/Users/me/repo/data/hts/2026-rev20.json'))", [])).toEqual([]);
    expect(lineRules("'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1'", [])).toEqual([]);
    expect(lineRules(`resolution: {integrity: ${j('sha', '512-', mixed(40), '+', mixed(40), '==')}}`, [])).toEqual([]);
  });

  it('lowercase hex (sha256, uuids) and plain words are not flagged', () => {
    expect(lineRules('"sha256": "4b0abd3061ddcdc703a0b0221eccb37c49c4354a60e8f0f1036d15b6c7d3d6ff"', [])).toEqual([]);
    expect(lineRules('quoteId 478a491b-01c5-48e7-bf5b-7602f3789c67', [])).toEqual([]);
  });
});

describe('rule 4 exemption — the generated official HTS index (chemical names look like mixed tokens)', () => {
  const patchFor = (file: string, text: string) => ['commit 4444444444444444444444444444444444444444', `diff --git a/${file} b/${file}`, '--- /dev/null', `+++ b/${file}`, '@@ -0,0 +1 @@', `+${text}`].join('\n');
  it('data/hts/ is exempt from rule 4 only; elsewhere the same token is flagged', () => {
    const chem = `"${j('Methyl-4-amino', 'benzenesulfonylcarbamate')} ${mixed(32)}"`;
    expect(scanPatch(patchFor('data/hts/2026-rev20.json', chem), [])).toEqual([]);
    expect(scanPatch(patchFor('src/x.ts', chem), []).map((f) => f.rule)).toEqual([4]);
    expect(scanPatch(patchFor('data/hts/2026-rev20.json', j('sk-', 'ant-', 'abcdefghijKLMN')), []).map((f) => f.rule)).toContain(2);
  });
  it('the estimator data versions have the same rule-4-only exemption; rules 2 and 3 still catch a key there', () => {
    const notes = j('data/', 'estimator/2026-rev21-e1/notes.json');
    const chem = `"${j('Methyl-4-amino', 'benzenesulfonylcarbamate')} ${mixed(32)}"`;
    expect(scanPatch(patchFor(notes, chem), [])).toEqual([]);
    expect(scanPatch(patchFor(notes, j('sk-', 'ant-', 'abcdefghijKLMN')), []).map((f) => f.rule)).toEqual([2]);
    expect(scanPatch(patchFor(notes, j('{"x":"local-', 'qa-value-9"}')), [j('local-', 'qa-value-9')]).map((f) => f.rule)).toEqual([3]);
    // only that folder: a look-alike path elsewhere is still scanned by rule 4
    expect(scanPatch(patchFor(j('src/data/', 'estimator/x.json'), chem), []).map((f) => f.rule)).toEqual([4]);
  });
});

describe('rule 4 exemption — public government source URLs (hosts approved 2026-10-11)', () => {
  const tok = mixed(32);
  it('a token inside a URL on an approved host (exact, or www.) is not flagged', () => {
    for (const host of ['content.govdelivery.com', 'federalregister.gov', 'www.federalregister.gov', 'govinfo.gov', 'hts.usitc.gov', 'usitc.gov', 'www.cbp.gov', 'whitehouse.gov'])
      expect(lineRules(j('Source: https://', host, '/accounts/', tok, '/bulletins/x (read 2026-10-11)'), []), host).toEqual([]);
    // the CSMS bulletin path that tripped rule 4 (docs/SPEC.md)
    expect(lineRules(j('https://content.govdelivery.com/accounts/USD', 'HSCBP/bulletins/40b11c9'), [])).toEqual([]);
  });
  it('the same token outside such a URL, on another host, or on a look-alike host is still flagged', () => {
    expect(lineRules(`token ${tok}`, [])).toEqual([4]);
    expect(lineRules(j('https://example.com/', tok), [])).toEqual([4]);
    expect(lineRules(j('https://cbp.gov.example.com/', tok), [])).toEqual([4]);
    expect(lineRules(j('https://evilcbp.gov/', tok), [])).toEqual([4]);
    expect(lineRules(j('https://sub.federalregister.gov/', tok), [])).toEqual([4]);
    expect(lineRules(j('https://federalregister.gov/x ', tok), [])).toEqual([4]); // after the URL ends
  });
  it('only rule 4: a secret pattern inside an approved URL is still rule 2', () => {
    expect(lineRules(j('https://cbp.gov/?API_', 'KEY=', 'abcdefghij12'), [])).toContain(2);
  });
});

describe('scanPatch + formatFinding — report file:line only, never the matched text', () => {
  const secret = j('sk-', 'ant-', 'api03-', 'abcdefghijKLMNOP');
  const patch = ['commit 3333333333333333333333333333333333333333', 'diff --git a/.env b/.env', 'new file mode 100644', '--- /dev/null', '+++ b/.env', '@@ -0,0 +1 @@', `+ANTHROPIC_API_KEY=${secret}`].join('\n');

  it('finds the path and the line', () => {
    const f = scanPatch(patch, []);
    expect(f.map((x) => [x.rule, x.file, x.line])).toEqual([
      [1, '.env', null],
      [2, '.env', 1],
      [4, '.env', 1], // the whole KEY=value run is also a 32+ char mixed token
    ]);
  });

  it('the printed report contains no part of the line', () => {
    const out = scanPatch(patch, []).map(formatFinding).join('\n');
    expect(out).toContain('.env:1');
    expect(out).not.toContain(secret);
    expect(out).not.toContain('ANTHROPIC_API_KEY');
  });
});

describe('self-check — the scanner and its tests never flag themselves', () => {
  it.each(['src/guards/secretScan.ts', 'src/guards/secretScan.test.ts', 'scripts/secret-scan.ts'])('%s', (file) => {
    const flagged = readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((text, i) => (lineRules(text, []).length ? [i + 1] : []));
    expect(flagged).toEqual([]);
  });
});
