// pnpm eval:classifier [--runs N] — runs the GROUNDED classifier (headings → real Rev 20 lines → choice from that list) on
// data/eval/products.json and prints, in order: wrong ∧ auto (must be 0), the auto rate, accuracy at 6/8/10 digits vs the
// offline baseline (10-digit counted both ways when a product is Ch. 91 component reporting), a sample-size note, the
// routing confusion matrix, P07's routing, grounding stats (invalid headings, expanded lines, dropped quotes), time and
// tokens, and per-product results with review reasons and the unknown separating attributes. Exits non-zero when
// wrong ∧ auto > 0. Only `title` and `origin` reach the model. Output goes to stdout only (see noWrites.test.ts).
import { existsSync, readFileSync } from 'node:fs';
import { anthropic } from '@ai-sdk/anthropic';
import { CLASSIFIER_MODEL } from '../src/domain/classifier/classify';
import { classifyListingGrounded, MAX_EXPANDED_LINES } from '../src/domain/classifier/classifyGrounded';
import { digitMatch, scoreRun, type EvalProduct, type Prediction } from '../src/domain/classifier/evalScore';
import { currentHtsIndex } from '../src/server/hts';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env')) process.loadEnvFile('.env');

interface FileProduct extends EvalProduct {
  llm: { hts10: string | null };
}

interface Detail extends Prediction {
  headings: string[];
  invalidHeadings: string[];
  expanded: number;
  droppedQuotes: number;
  unverified: number;
  unknownAttrs: string[];
  ms: number;
  usage: { input: number; output: number };
}

function thresholdFromEnv(): number {
  const v = process.env.CLASSIFIER_REVIEW_THRESHOLD?.trim();
  if (!v) return 0.8;
  if (!/^(0(\.\d+)?|1(\.0+)?)$/.test(v)) throw new Error('CLASSIFIER_REVIEW_THRESHOLD must be a decimal between 0 and 1');
  return Number(v);
}

const mark = (b: boolean) => (b ? '✓' : '✗');
const pct = (k: number, n: number) => `${k}/${n} (${n ? Math.round((100 * k) / n) : 0}%)`;
const nearestRank = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)] ?? 0;
};

async function runOnce(products: FileProduct[], threshold: number): Promise<Detail[]> {
  const { lookup } = currentHtsIndex();
  const out: Detail[] = [];
  for (const p of products) {
    const r = await classifyListingGrounded({ title: p.title, origin: p.origin }, anthropic(CLASSIFIER_MODEL), { threshold, idx: lookup });
    const top = r.kind === 'OK' ? [...r.choice.candidates].sort((a, b) => b.confidence - a.confidence)[0] : undefined;
    out.push({
      id: p.id,
      top: top?.hts10 ?? null,
      confidence: top?.confidence ?? null,
      review: r.review.needsReview,
      reasons: r.review.reasons,
      headings: r.meta.headings,
      invalidHeadings: r.meta.invalidHeadings,
      expanded: r.meta.expanded,
      droppedQuotes: r.meta.droppedQuotes,
      unverified: r.kind === 'OK' ? r.choice.candidates.filter((c) => c.evidence.length === 0).length : 0,
      unknownAttrs: r.kind === 'OK' ? r.choice.separating_attributes.filter((a) => a.value_from_listing === null).map((a) => a.name) : [],
      ms: r.meta.ms,
      usage: r.meta.usage,
    });
    process.stderr.write('.');
  }
  process.stderr.write('\n');
  return out;
}

function printRun(products: FileProduct[], preds: Detail[], run: number) {
  console.log(`\n── run ${run}: per product ──`);
  console.log('id   expected      predicted     6 8 10  conf  route   reasons');
  for (const p of products) {
    const pr = preds.find((x) => x.id === p.id)!;
    const m = p.expected.hts10 ? digitMatch(p.expected.hts10, pr.top) : null;
    const d10 = p.componentReporting ? 'CR' : mark(m?.d10 ?? false);
    const digitsCol = m ? `${mark(m.d6)} ${mark(m.d8)} ${d10.padEnd(2)}` : 'routing ';
    console.log(
      `${p.id}  ${(p.expected.hts10 ?? 'EXCLUDED').padEnd(12)}  ${(pr.top ?? '—').padEnd(12)}  ${digitsCol}  ${pr.confidence === null ? ' -  ' : pr.confidence.toFixed(2)}  ${pr.review ? 'REVIEW' : 'AUTO  '}  ${pr.reasons.join(', ') || '-'}`,
    );
    console.log(
      `     headings ${pr.headings.join(', ') || '—'}${pr.invalidHeadings.length ? ` (invalid in Rev 20: ${pr.invalidHeadings.join(', ')})` : ''} · expanded ${pr.expanded} · dropped quotes ${pr.droppedQuotes}${pr.unverified ? ` · unverified candidates ${pr.unverified}` : ''} · ${(pr.ms / 1000).toFixed(1)}s`,
    );
    console.log(`     unknown separating attributes: ${pr.unknownAttrs.join('; ') || '—'}`);
  }
  if (products.some((p) => p.componentReporting)) {
    console.log('     CR = Ch. 91 component reporting (Stat. Note 1): 10-digit n/a; scored correct when the 8-digit line is right');
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const runsArg = process.argv.indexOf('--runs');
  const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error('--runs must be an integer from 1 to 5');
  const threshold = thresholdFromEnv();
  const { codes, index } = currentHtsIndex();
  const products = (JSON.parse(readFileSync('data/eval/products.json', 'utf8')) as FileProduct[]).map((p) => ({
    ...p,
    // e.g. 9102.21.7000 in the eval file → the real Rev 20 line is the component-reporting 9102.21.70
    componentReporting: !!p.expected.hts10 && codes.get(p.expected.hts10.slice(0, 10))?.componentReporting === true,
  }));

  // Offline baseline: the stored LLM answers in the same file (no routing — accuracy only).
  const baseline = scoreRun(products, products.map((p) => ({ id: p.id, top: p.llm.hts10, confidence: null, review: true, reasons: [] })));

  console.log(
    `Classifier eval (GROUNDED, HTS ${index.hts_revision}) · model ${CLASSIFIER_MODEL} · threshold ${threshold} · cap ${MAX_EXPANDED_LINES} lines · ${products.length} products · ${runs} run(s) · ${new Date().toISOString()}`,
  );
  const all: { preds: Detail[]; s: ReturnType<typeof scoreRun> }[] = [];
  for (let r = 1; r <= runs; r++) {
    const preds = await runOnce(products, threshold);
    all.push({ preds, s: scoreRun(products, preds) });
    printRun(products, preds, r);
  }

  const { n, n10 } = all[0]!.s;
  const tag = (i: number) => (runs > 1 ? `run ${i + 1}: ` : '');
  console.log('\n══ summary ══');
  for (const [i, { s }] of all.entries()) {
    console.log(`${tag(i)}1. wrong ∧ auto: ${s.wrongAuto.length}${s.wrongAuto.length ? ` (${s.wrongAuto.join(', ')})` : ''} ${s.wrongAuto.length === 0 ? '— OK' : '— FAIL'}`);
    console.log(`${tag(i)}2. auto rate (auto-accepted ∧ correct): ${pct(s.autoCorrect, n)}`);
    console.log(
      `${tag(i)}3. accuracy  6-digit ${pct(s.acc.d6, n)} · 8-digit ${pct(s.acc.d8, n)} · 10-digit ${pct(s.acc.d10, n10)} (component reporting excluded) · 10-digit strict ${pct(s.acc.d10Strict, n)} (vs the file's literal codes)`,
    );
    console.log(
      `${tag(i)}   baseline (offline LLM, same file): 6-digit ${pct(baseline.acc.d6, n)} · 8-digit ${pct(baseline.acc.d8, n)} · 10-digit ${pct(baseline.acc.d10, n10)} (CR excluded) · 10-digit strict ${pct(baseline.acc.d10Strict, n)}`,
    );
  }
  console.log(`4. sample size: n = ${n} verified products (${n10} with a 10-digit answer) — one product ≈ ${Math.round(100 / n)} points; differences of 1–2 products are noise.`);
  for (const [i, { s }] of all.entries()) {
    const m = s.matrix;
    console.log(`${tag(i)}5. confusion (correct × routing): correct∧auto ${m.correctAuto} · correct∧review ${m.correctReview} · wrong∧auto ${m.wrongAuto} · wrong∧review ${m.wrongReview}`);
    console.log(`${tag(i)}6. excluded (routing only): ${s.excludedRouting.map((e) => `${e.id} ${e.pass ? 'REVIEW — pass' : 'AUTO — FAIL'}`).join(', ')}`);
  }
  for (const [i, { preds }] of all.entries()) {
    const heads = preds.flatMap((p) => p.headings);
    const invalid = preds.flatMap((p) => p.invalidHeadings);
    const exp = preds.map((p) => p.expanded);
    const ms = preds.map((p) => p.ms);
    const input = preds.reduce((a, p) => a + p.usage.input, 0);
    const output = preds.reduce((a, p) => a + p.usage.output, 0);
    console.log(`${tag(i)}7. call-1 headings invalid in Rev 20: ${invalid.length} of ${heads.length}${invalid.length ? ` (${invalid.join(', ')})` : ''}`);
    console.log(`${tag(i)}8. expanded lines per product: p95 ${nearestRank(exp, 0.95)} · p99 ${nearestRank(exp, 0.99)} · max ${Math.max(...exp)} · TOO_BROAD ${preds.filter((p) => p.reasons.includes('TOO_BROAD')).length}`);
    console.log(`${tag(i)}9. quote check: dropped quotes ${preds.reduce((a, p) => a + p.droppedQuotes, 0)} · candidates with no verified evidence ${preds.reduce((a, p) => a + p.unverified, 0)} · products flagged UNVERIFIED_EVIDENCE ${preds.filter((p) => p.reasons.includes('UNVERIFIED_EVIDENCE')).length}`);
    console.log(`${tag(i)}10. time per classification (both calls): median ${(nearestRank(ms, 0.5) / 1000).toFixed(1)}s · max ${(Math.max(...ms) / 1000).toFixed(1)}s`);
    console.log(`${tag(i)}11. tokens: input ${input} · output ${output} (${preds.length} classifications, up to 2 calls each)`);
  }

  if (runs > 1) {
    const d10 = all.map((a) => a.s.acc.d10);
    const changed = products
      .filter((p) => new Set(all.map((a) => { const x = a.preds.find((q) => q.id === p.id)!; return `${x.top}|${x.review}`; })).size > 1)
      .map((p) => p.id);
    console.log(
      `variance: 10-digit per run ${d10.join(' / ')} of ${n10} (min–max ${Math.min(...d10)}–${Math.max(...d10)}) · wrong ∧ auto per run ${all.map((a) => a.s.wrongAuto.length).join(' / ')} · auto rate per run ${all.map((a) => a.s.autoCorrect).join(' / ')} · answer or routing changed: ${changed.join(', ') || 'none'}`,
    );
  }

  if (!all.every((a) => a.s.safe)) {
    console.log('\nFAIL: a wrong or excluded answer would have been auto-accepted.');
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(`EVAL ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
