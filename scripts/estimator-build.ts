// pnpm estimator:build [--draft [--max-calls 15]] --out <dir> — builds the estimator data from the official sources and runs
// the gate. Sources: the export named by data/source/hts/current-export.meta.json (pnpm hts:download), the Chapter 99 PDF of
// the same release (downloaded from hts.usitc.gov if missing; the file endpoint is pinned to the release), the committed
// HTS index, verified rates and golden cases, and docs/SPEC.md (G0). pdftotext must be xpdf 4.06 (-enc UTF-8 -layout).
// Rules: the reference rules (default), or --draft: drafted live by Claude (claude-opus-5-5) within --max-calls, retries
// included, then gated against the reference rules (GR). LIVE: --draft makes model calls.
// Output: the gate report (+ drafted rules, manifest) in --out, which must be outside data/. Writing data/estimator comes
// with its hook protection (plan commit 6) and is not done here.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { anthropic } from '@ai-sdk/anthropic';
import { buildEstimatorData } from '../src/domain/estimator/data';
import { DRAFT_MODEL, draftRules } from '../src/domain/estimator/draft';
import { runGate, type GoldenCase } from '../src/domain/estimator/gate';
import { compareToReference, factNameDiff, RulesFileSchema, type Rule } from '../src/domain/estimator/rules';
import { verifyExportMeta } from '../src/domain/hts/release';
import { goldenFileName } from '../src/domain/rates/current';
import { currentHtsIndex } from '../src/server/hts';
import { currentRateTable } from '../src/server/rates';

const PDFTOTEXT = { vendor: 'xpdf', version: '4.06', args: ['-enc', 'UTF-8', '-layout'] } as const;
const SOURCE_DIR = join('data', 'source', 'hts');
const REFERENCE = join('src', 'domain', 'estimator', '__fixtures__', 'rules-reference-jp-eu.json');
const ORIGINS = ['JP', 'DE'];

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function pdftotextVersion(): string {
  const r = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const m = /pdftotext version (\S+)/.exec(out);
  assert(m, 'pdftotext not found (xpdf 4.06 is required)');
  assert(m[1] === PDFTOTEXT.version && out.includes('xpdfreader'), `pdftotext ${m[1]} (${out.includes('xpdfreader') ? 'xpdf' : 'not xpdf'}) — the estimator is pinned to xpdf ${PDFTOTEXT.version}`);
  return `${PDFTOTEXT.vendor} ${m[1]}`;
}

async function main() {
  const out = arg('--out');
  assert(out, 'usage: pnpm estimator:build [--draft [--max-calls N]] --out <dir>');
  const inData = relative(resolve('data'), resolve(out));
  assert(inData.startsWith('..') || isAbsolute(inData), '--out must be outside data/ (data/estimator is written only once its hook protection is in place)');
  const draft = process.argv.includes('--draft');
  const budget = Number(arg('--max-calls') ?? 15);
  assert(Number.isInteger(budget) && budget > 0 && budget <= 15, '--max-calls must be 1–15');

  const pdftotext = pdftotextVersion();
  const rawMeta: unknown = JSON.parse(readFileSync(join(SOURCE_DIR, 'current-export.meta.json'), 'utf8'));
  const exportFile = join(SOURCE_DIR, String((rawMeta as { file?: unknown }).file));
  const exportBuf = readFileSync(exportFile);
  const { release, meta } = verifyExportMeta(rawMeta, sha(exportBuf));
  const index = currentHtsIndex().index;
  assert(index.hts_revision === release.label, `the committed HTS index is ${index.hts_revision}, the export is ${release.label} — run pnpm hts:import first`);

  const pdfUrl = `https://hts.usitc.gov/reststop/file?release=${release.name}&filename=Chapter%2099`;
  const pdfFile = join(SOURCE_DIR, `ch99-${release.slug}.pdf`);
  if (!existsSync(pdfFile)) {
    const res = await fetch(pdfUrl);
    assert(res.ok, `Chapter 99 PDF: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    assert(buf.subarray(0, 5).toString() === '%PDF-', 'Chapter 99 download is not a PDF');
    writeFileSync(pdfFile, buf);
    console.log(`downloaded ${pdfFile} from ${pdfUrl}`);
  }
  const pdfSha = sha(readFileSync(pdfFile));
  const ch99Text = execFileSync('pdftotext', [...PDFTOTEXT.args, pdfFile, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });

  const asOf = new Date().toISOString().slice(0, 10);
  const data = buildEstimatorData({ version: `${release.slug}-e1`, asOf, exportRows: JSON.parse(exportBuf.toString('utf8')), ch99Text, index, rules: [] });
  const reference = RulesFileSchema.parse(JSON.parse(readFileSync(REFERENCE, 'utf8')));

  let rules: Rule[] = reference.rules;
  let drafting: { calls: number; usage: { input: number; output: number }; failed: { heading: string; error: string }[] } | undefined;
  if (draft) {
    if (!process.env.ANTHROPIC_API_KEY && existsSync('.env')) process.loadEnvFile('.env');
    const tasks = reference.rules.map((r) => ({ id: r.id, heading: r.heading }));
    console.log(`LIVE: drafting ${tasks.length} rules with ${DRAFT_MODEL}, at most ${budget} calls (retries included)…`);
    const d = await draftRules(tasks, data, anthropic(DRAFT_MODEL), { budget, draftedBy: `${DRAFT_MODEL} (${asOf})` });
    rules = d.rules;
    drafting = { calls: d.calls, usage: d.usage, failed: d.failed };
  }

  const golden = (JSON.parse(readFileSync(join('data', 'eval', goldenFileName()), 'utf8')) as { cases: GoldenCase[] }).cases;
  const { report } = runGate({
    data,
    rules,
    rulesRevision: reference.hts_revision,
    knownCodes: index.codes.map((c) => c.c),
    golden,
    verified: currentRateTable(),
    docs: { 'docs/SPEC.md': readFileSync(join('docs', 'SPEC.md'), 'utf8') },
    origins: ORIGINS,
    ...(draft ? { reference: reference.rules } : {}),
  });

  const manifest = {
    version: data.version,
    hts_revision: data.hts_revision,
    as_of: asOf,
    sources: {
      export: { url: meta.url, file: exportFile.replace(/\\/g, '/'), sha256: sha(exportBuf), release: release.name },
      ch99_pdf: { url: pdfUrl, file: pdfFile.replace(/\\/g, '/'), sha256: pdfSha, pdftotext: { version: pdftotext, args: PDFTOTEXT.args } },
    },
    rules: draft ? `drafted by ${DRAFT_MODEL}` : 'reference (hand-written)',
    drafting,
    gate: { checks: report.checks.length, failed: report.checks.filter((c) => !c.pass).length, blockedRules: report.blockedRules.map((b) => b.id), blockedOrigins: report.blockedOrigins },
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  writeFileSync(join(out, 'rules.json'), JSON.stringify({ hts_revision: reference.hts_revision, rules }, null, 2) + '\n');

  console.log(`release ${release.label} · ${pdftotext} · as of ${asOf} · ${Object.keys(data.base.codes).length} lines · ${data.notes.subdivisions.length} note subdivisions`);
  console.log(`rules: ${rules.length} (${manifest.rules})`);
  if (drafting) {
    console.log(`drafting: ${drafting.calls} calls, ${drafting.usage.input} input + ${drafting.usage.output} output tokens; failed: ${drafting.failed.map((f) => `${f.heading} (${f.error})`).join('; ') || 'none'}`);
    for (const r of rules) {
      const ref = reference.rules.find((x) => x.heading === r.heading);
      const diffs = compareToReference(r, ref);
      const fact = factNameDiff(r, ref);
      console.log(`  ${r.heading} ${r.kind}: ${diffs.length ? `DIFFERS — ${diffs.join('; ')}` : 'matches the reference'}${fact ? ` · ${fact}` : ''}`);
    }
  }
  for (const c of report.checks.filter((x) => x.id === 'G8')) console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} G8 ${c.subject}: ${c.detail}`);
  for (const [o, c] of Object.entries(report.coverage)) console.log(`  coverage ${o}: ${c.refused} of ${c.lines} lines refused`);
  const failed = report.checks.filter((c) => !c.pass);
  console.log(`gate: ${report.checks.length} checks, ${failed.length} failed; blocked rules: ${report.blockedRules.map((b) => b.id).join(', ') || 'none'}; blocked origins: ${Object.keys(report.blockedOrigins).join(', ') || 'none'}`);
  for (const a of report.alerts) console.log(`ALERT ${a}`);
  console.log(`wrote ${out}/manifest.json, report.json, rules.json`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`ESTIMATOR BUILD ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
