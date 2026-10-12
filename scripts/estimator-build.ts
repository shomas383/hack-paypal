// pnpm estimator:build [--draft [--max-calls 15] [--draft-headings 9903.05.87,…]] [--out <dir>] — builds the estimator data
// from the official sources and runs the gate. Sources: the export named by data/source/hts/current-export.meta.json
// (pnpm hts:download), the Chapter 99 PDF of the same release (downloaded from hts.usitc.gov if missing; the file endpoint
// is pinned to the release), the committed HTS index, verified rates and golden cases, the reviewed IEEPA list, and
// docs/SPEC.md (G0). pdftotext must be xpdf 4.06 (-enc UTF-8 -layout).
// Two modes:
// - write (no --out; the only command the hook lets touch the estimator data folder is exactly `pnpm estimator:build`):
//   writes the next version folder data/estimator/<release>-eN/ (manifest, report, rules, headings, notes, base-rates) and
//   stages it; data/estimator/current.json moves to it only when no origin is blocked and G0/G9 pass. Rules: the previous
//   version's (unchanged source text → reused with no model call; changed → G1 blocks them as stale), plus, for a reference
//   rule the previous version doesn't have (the first version; CN in e2), its rule from the recorded drafting runs
//   (__fixtures__/rules-drafted-*.json, as the model wrote them); always gated against the reference rules (GR).
// - report only (--out <dir>, outside data/): manifest/report/rules to <dir>; rules = the reference rules unless --draft.
// --draft: LIVE — Claude (claude-opus-5-5) drafts the rules within --max-calls, retries included.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { anthropic } from '@ai-sdk/anthropic';
import { buildEstimatorData } from '../src/domain/estimator/data';
import { DRAFT_MODEL, draftRules } from '../src/domain/estimator/draft';
import { runGate, type GoldenCase } from '../src/domain/estimator/gate';
import { validUntil } from '../src/domain/estimator/headings';
import { compareToReference, factNameDiff, RulesFileSchema, type Rule } from '../src/domain/estimator/rules';
import { verifyExportMeta } from '../src/domain/hts/release';
import { goldenFileName } from '../src/domain/rates/current';
import { ieepaOverride } from '../src/server/estimatorReview';
import { currentHtsIndex } from '../src/server/hts';
import { currentRateTable } from '../src/server/rates';

const PDFTOTEXT = { vendor: 'xpdf', version: '4.06', args: ['-enc', 'UTF-8', '-layout'] } as const;
const SOURCE_DIR = join('data', 'source', 'hts');
const FIXTURES = join('src', 'domain', 'estimator', '__fixtures__');
const REFERENCE = [join(FIXTURES, 'rules-reference-jp-eu.json'), join(FIXTURES, 'rules-reference-cn.json')];
/**
 * Live drafting runs, kept as the model wrote them: JP/EU (2026-10-11, the rules of the first data version) and CN
 * (2026-10-12). A reference rule the previous version lacks takes its rule from here, by id.
 */
const SEED_RULES = [
  join(FIXTURES, 'rules-drafted-2026-10-11.json'),
  join(FIXTURES, 'rules-drafted-cn-2026-10-12.json'),
  join(FIXTURES, 'rules-drafted-cn-exemptions-2026-10-12.json'),
];
const DATA_DIR = join('data', 'estimator');
const ORIGINS = ['JP', 'DE', 'CN'];

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
  const write = out === undefined;
  if (out !== undefined) {
    const inData = relative(resolve('data'), resolve(out));
    assert(inData.startsWith('..') || isAbsolute(inData), '--out must be outside data/ (the estimator data folder is written by write mode only)');
  }
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
  const currentFile = join(DATA_DIR, 'current.json');
  const previous = existsSync(currentFile) ? (JSON.parse(readFileSync(currentFile, 'utf8')) as { version: string }).version : undefined;
  const n = previous?.startsWith(`${release.slug}-e`) ? Number(previous.slice(release.slug.length + 2)) + 1 : 1;
  const version = `${release.slug}-e${n}`;
  const overrides = [ieepaOverride()];
  const data = buildEstimatorData({ version, asOf, exportRows: JSON.parse(exportBuf.toString('utf8')), ch99Text, index, rules: [], overrides });
  const refFiles = REFERENCE.map((f) => RulesFileSchema.parse(JSON.parse(readFileSync(f, 'utf8'))));
  assert(new Set(refFiles.map((f) => f.hts_revision)).size === 1, 'the reference rule files are for different revisions');
  const reference = { hts_revision: refFiles[0]!.hts_revision, rules: refFiles.flatMap((f) => f.rules) };

  // write mode: the previous version's rules (accepted + blocked), plus recorded drafting runs for reference rules it lacks
  let rulesSource = 'reference (hand-written)';
  let rules: Rule[] = reference.rules;
  if (write) {
    const sources: string[] = [];
    rules = [];
    if (previous) {
      const prev = JSON.parse(readFileSync(join(DATA_DIR, previous, 'rules.json'), 'utf8')) as { rules: Rule[]; blocked: { rule: Rule | null }[] };
      rules = [...prev.rules, ...prev.blocked.flatMap((b) => (b.rule ? [b.rule] : []))];
      sources.push(`previous version ${previous}`);
    }
    for (const f of SEED_RULES) {
      if (!existsSync(f)) continue;
      const seeded = RulesFileSchema.parse(JSON.parse(readFileSync(f, 'utf8'))).rules.filter((r) => reference.rules.some((x) => x.id === r.id) && !rules.some((x) => x.id === r.id));
      if (seeded.length) sources.push(`recorded drafting run ${f.replace(/\\/g, '/')} (${seeded.length})`);
      rules.push(...seeded);
    }
    const missing = reference.rules.filter((r) => !rules.some((x) => x.id === r.id)).map((r) => r.id);
    if (missing.length) console.log(`no drafted rule for reference rule(s) ${missing.join(', ')}: their headings stay unmodeled (fail closed)`);
    rulesSource = sources.join(' + ');
  }
  const previousListCounts = previous ? (JSON.parse(readFileSync(join(DATA_DIR, previous, 'report.json'), 'utf8')) as { listCounts: Record<string, { codes: number }> }).listCounts : undefined;
  let drafting: { calls: number; usage: { input: number; output: number }; failed: { heading: string; error: string }[] } | undefined;
  let drafted: Rule[] = [];
  if (draft) {
    if (!process.env.ANTHROPIC_API_KEY && existsSync('.env')) process.loadEnvFile('.env');
    // --draft-headings 9903.05.87[,…] or --draft-ids cn-exempt-9903-05-86[,…]: re-draft only these (each for its reference
    // rule's origins); the other rules stay as they are
    const byHeading = arg('--draft-headings')?.split(',');
    const byId = arg('--draft-ids')?.split(',');
    const only = byHeading ?? byId;
    const tasks = reference.rules
      .filter((r) => (byHeading ? byHeading.includes(r.heading) : byId ? byId.includes(r.id) : true))
      .map((r) => ({ id: r.id, heading: r.heading, ...(only ? { origins: r.origins } : {}) }));
    assert(tasks.length > 0, `${only?.join(',')}: no reference rule for those headings / ids`);
    console.log(`LIVE: drafting ${tasks.length} rule(s) with ${DRAFT_MODEL}, at most ${budget} calls (retries included)…`);
    const d = await draftRules(tasks, data, anthropic(DRAFT_MODEL), { budget, draftedBy: `${DRAFT_MODEL} (${asOf})` });
    const base = rules;
    rules = only ? [...base.map((r) => d.rules.find((x) => x.id === r.id) ?? r), ...d.rules.filter((x) => !base.some((r) => r.id === x.id))] : d.rules;
    drafting = { calls: d.calls, usage: d.usage, failed: d.failed };
    drafted = d.rules;
    rulesSource = `drafted by ${DRAFT_MODEL}${only ? ` (${only.join(', ')}; others: ${rulesSource})` : ''}`;
  }

  const golden = (JSON.parse(readFileSync(join('data', 'eval', goldenFileName()), 'utf8')) as { cases: GoldenCase[] }).cases;
  const { data: gated, report } = runGate({
    data,
    rules,
    rulesRevision: reference.hts_revision,
    knownCodes: index.codes.map((c) => c.c),
    golden,
    verified: currentRateTable(),
    docs: { 'docs/SPEC.md': readFileSync(join('docs', 'SPEC.md'), 'utf8') },
    origins: ORIGINS,
    overrides,
    ...(draft || write ? { reference: reference.rules } : {}),
    ...(previousListCounts ? { previousListCounts: Object.fromEntries(Object.entries(previousListCounts).map(([k, v]) => [k, v.codes])) } : {}),
  });

  const validity = validUntil(data.headings, data.notes, data.outOfForce, asOf);
  const manifest = {
    version: data.version,
    hts_revision: data.hts_revision,
    as_of: asOf,
    valid_until: validity?.date ?? null,
    valid_until_source: validity ? { ref: validity.ref, quote: validity.quote } : null,
    sources: {
      export: { url: meta.url, file: exportFile.replace(/\\/g, '/'), sha256: sha(exportBuf), release: release.name },
      ch99_pdf: { url: pdfUrl, file: pdfFile.replace(/\\/g, '/'), sha256: pdfSha, pdftotext: { version: pdftotext, args: PDFTOTEXT.args } },
    },
    previous: previous ?? null,
    rules: rulesSource,
    reviewed_lists: overrides.map((o) => ({ file: o.listFile, reviewed_on: o.reviewedOn, headings: o.headings.length })),
    drafting,
    gate: { checks: report.checks.length, failed: report.checks.filter((c) => !c.pass).length, blockedRules: report.blockedRules.map((b) => b.id), blockedOrigins: report.blockedOrigins },
  };
  const dir = out ?? join(DATA_DIR, version);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, unknown> = {
    'manifest.json': manifest,
    'report.json': report,
    'rules.json': { hts_revision: reference.hts_revision, rules: gated.rules, blocked: gated.blocked.rules },
  };
  // the drafting run as the model wrote it (gated or not), to record as __fixtures__/rules-drafted-*.json
  if (drafted.length && !write) files['drafted.json'] = { hts_revision: reference.hts_revision, rules: drafted };
  if (write) {
    // what the runtime loader needs (mentions and description chains are rebuilt from these and the committed HTS index)
    files['headings.json'] = { hts_revision: data.hts_revision, headings: data.headings, outOfForce: data.outOfForce };
    files['notes.json'] = data.notes;
    files['base-rates.json'] = data.base;
  }
  for (const [f, v] of Object.entries(files)) writeFileSync(join(dir, f), JSON.stringify(v, null, f === 'rules.json' || f === 'manifest.json' || f === 'report.json' ? 1 : 0) + '\n');
  const globalFailure = Object.keys(report.blockedOrigins).length > 0 || report.checks.some((c) => (c.id === 'G0' || c.id === 'G9') && !c.pass);
  if (write) {
    if (!globalFailure) writeFileSync(currentFile, JSON.stringify({ version }, null, 1) + '\n');
    execFileSync('git', ['add', '--', dir, ...(globalFailure ? [] : [currentFile])], { stdio: 'inherit' });
  }

  console.log(`release ${release.label} · ${pdftotext} · as of ${asOf} · ${Object.keys(data.base.codes).length} lines · ${data.notes.subdivisions.length} note subdivisions`);
  console.log(`valid until ${validity ? `${validity.date} (${validity.ref}: \"${validity.quote}\")` : 'no end date'}`);
  console.log(`version ${version}${previous ? ` (previous ${previous})` : ' (first)'} · rules: ${rules.length} (${rulesSource})`);
  if (drafting) {
    console.log(`drafting: ${drafting.calls} calls, ${drafting.usage.input} input + ${drafting.usage.output} output tokens; failed: ${drafting.failed.map((f) => `${f.heading} (${f.error})`).join('; ') || 'none'}`);
    for (const r of drafted) {
      const ref = reference.rules.find((x) => x.id === r.id);
      const diffs = compareToReference(r, ref);
      const fact = factNameDiff(r, ref);
      const blocked = report.blockedRules.find((b) => b.id === r.id);
      console.log(`  ${r.heading} ${r.kind}: ${diffs.length ? `DIFFERS — ${diffs.join('; ')}` : 'matches the reference'}${fact ? ` · ${fact}` : ''}${blocked ? ` · BLOCKED: ${blocked.reasons.join(' | ')}` : ' · accepted'}`);
    }
  }
  for (const [l, c] of Object.entries(report.listCounts)) console.log(`  list ${l}: ${c.codes} codes (${c.ch98} chapter 98), ${c.unknown.length} unknown${c.unknown.length ? `: ${c.unknown.join(' ')}` : ''}`);
  const ex = report.exclusions;
  console.log(`  note 20 exclusions: ${ex.counts.in_effect} in effect, ${ex.counts.expired} expired, ${ex.counts.unclear} unclear (in effect: ${ex.units.filter((u) => u.status === 'in_effect').map((u) => u.ref.slice(8)).join(', ')}; unclear: ${ex.units.filter((u) => u.status === 'unclear').map((u) => u.ref.slice(8)).join(', ')})`);
  console.log(`  numbering fixes: ${report.numbering.applied} applied, ${report.numbering.unmatched.length} not holding, ${report.numbering.outOfSequence.length} still out of sequence`);
  for (const c of report.checks.filter((x) => x.id === 'G8')) console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} G8 ${c.subject}: ${c.detail}`);
  for (const [o, c] of Object.entries(report.coverage)) console.log(`  coverage ${o}: ${c.refused} of ${c.lines} lines refused — ${Object.entries(c.byRef).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  const failed = report.checks.filter((c) => !c.pass);
  console.log(`gate: ${report.checks.length} checks, ${failed.length} failed; blocked rules: ${report.blockedRules.map((b) => b.id).join(', ') || 'none'}; blocked origins: ${Object.keys(report.blockedOrigins).join(', ') || 'none'}`);
  for (const a of report.alerts) console.log(`ALERT ${a}`);
  console.log(`wrote ${dir.replace(/\\/g, '/')}/ ${Object.keys(files).join(', ')}`);
  if (write) console.log(globalFailure ? 'current.json NOT advanced (an origin is blocked, or G0/G9 failed)' : `current.json → ${version}; staged (git add) — review with git diff --cached --stat, then commit.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`ESTIMATOR BUILD ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
