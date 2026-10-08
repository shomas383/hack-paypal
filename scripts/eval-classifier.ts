// pnpm eval:classifier [--runs N] — runs the classifier on data/eval/products.json and prints, in order: wrong ∧ auto
// (must be 0), the auto rate, accuracy at 6/8/10 digits vs the offline baseline, a sample-size note, the routing
// confusion matrix, P07's routing, and per-product results with review reasons. Exits non-zero when wrong ∧ auto > 0.
// Only `title` and `origin` reach the model — never the expected answer or the stored offline LLM answer.
// Output goes to stdout only (see src/domain/classifier/noWrites.test.ts).
import { existsSync, readFileSync } from 'node:fs';
import { anthropic } from '@ai-sdk/anthropic';
import { CLASSIFIER_MODEL, classifyListing } from '../src/domain/classifier/classify';
import { digitMatch, scoreRun, type EvalProduct, type Prediction } from '../src/domain/classifier/evalScore';
import { topCandidate } from '../src/domain/classifier/review';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env')) process.loadEnvFile('.env');

interface FileProduct extends EvalProduct {
  llm: { hts10: string | null };
}

function thresholdFromEnv(): number {
  const v = process.env.CLASSIFIER_REVIEW_THRESHOLD?.trim();
  if (!v) return 0.8;
  if (!/^(0(\.\d+)?|1(\.0+)?)$/.test(v)) throw new Error('CLASSIFIER_REVIEW_THRESHOLD must be a decimal between 0 and 1');
  return Number(v);
}

const mark = (b: boolean) => (b ? '✓' : '✗');
const pct = (k: number, n: number) => `${k}/${n} (${Math.round((100 * k) / n)}%)`;

async function runOnce(products: FileProduct[], threshold: number): Promise<Prediction[]> {
  const out: Prediction[] = [];
  for (const p of products) {
    const c = await classifyListing({ title: p.title, origin: p.origin }, anthropic(CLASSIFIER_MODEL), { threshold });
    const top = c.kind === 'OK' ? topCandidate(c.output) : undefined;
    out.push({ id: p.id, top: top?.hts10 ?? null, confidence: top?.confidence ?? null, review: c.review.needsReview, reasons: c.review.reasons });
    process.stderr.write('.');
  }
  process.stderr.write('\n');
  return out;
}

function printRun(products: FileProduct[], preds: Prediction[], run: number) {
  console.log(`\n── run ${run}: per product ──`);
  console.log('id   expected      predicted     6 8 10  conf  route   reasons');
  for (const p of products) {
    const pr = preds.find((x) => x.id === p.id)!;
    const m = p.expected.hts10 ? digitMatch(p.expected.hts10, pr.top) : null;
    const digitsCol = m ? `${mark(m.d6)} ${mark(m.d8)} ${mark(m.d10)} ` : 'routing';
    console.log(
      `${p.id}  ${(p.expected.hts10 ?? 'EXCLUDED').padEnd(12)}  ${(pr.top ?? 'INVALID').padEnd(12)}  ${digitsCol}  ${pr.confidence === null ? ' -  ' : pr.confidence.toFixed(2)}  ${pr.review ? 'REVIEW' : 'AUTO  '}  ${pr.reasons.join(', ') || '-'}`,
    );
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const runsArg = process.argv.indexOf('--runs');
  const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error('--runs must be an integer from 1 to 5');
  const threshold = thresholdFromEnv();
  const products = JSON.parse(readFileSync('data/eval/products.json', 'utf8')) as FileProduct[];

  // Offline baseline: the stored LLM answers in the same file (no routing — accuracy only).
  const baseline = scoreRun(products, products.map((p) => ({ id: p.id, top: p.llm.hts10, confidence: null, review: true, reasons: [] })));

  console.log(`Classifier eval · model ${CLASSIFIER_MODEL} · threshold ${threshold} · ${products.length} products · ${runs} run(s) · ${new Date().toISOString()}`);
  const all: { preds: Prediction[]; s: ReturnType<typeof scoreRun> }[] = [];
  for (let r = 1; r <= runs; r++) {
    const preds = await runOnce(products, threshold);
    all.push({ preds, s: scoreRun(products, preds) });
    printRun(products, preds, r);
  }

  const n = all[0]!.s.n;
  console.log('\n══ summary ══');
  for (const [i, { s }] of all.entries()) {
    const tag = runs > 1 ? `run ${i + 1}: ` : '';
    console.log(`${tag}1. wrong ∧ auto: ${s.wrongAuto.length}${s.wrongAuto.length ? ` (${s.wrongAuto.join(', ')})` : ''} ${s.wrongAuto.length === 0 ? '— OK' : '— FAIL'}`);
    console.log(`${tag}2. auto rate (auto-accepted ∧ correct): ${pct(s.autoCorrect, n)}`);
    console.log(`${tag}3. accuracy  6-digit ${pct(s.acc.d6, n)} · 8-digit ${pct(s.acc.d8, n)} · 10-digit ${pct(s.acc.d10, n)}`);
    console.log(`${tag}   baseline (offline LLM, same file): 6-digit ${pct(baseline.acc.d6, n)} · 8-digit ${pct(baseline.acc.d8, n)} · 10-digit ${pct(baseline.acc.d10, n)}`);
  }
  console.log(`4. sample size: n = ${n} verified products — one product ≈ ${Math.round(100 / n)} points; differences of 1–2 products are noise.`);
  for (const [i, { s }] of all.entries()) {
    const m = s.matrix;
    console.log(`${runs > 1 ? `run ${i + 1}: ` : ''}5. confusion (10-digit × routing): correct∧auto ${m.correctAuto} · correct∧review ${m.correctReview} · wrong∧auto ${m.wrongAuto} · wrong∧review ${m.wrongReview}`);
    console.log(`${runs > 1 ? `run ${i + 1}: ` : ''}6. excluded (routing only): ${s.excludedRouting.map((e) => `${e.id} ${e.pass ? 'REVIEW — pass' : 'AUTO — FAIL'}`).join(', ')}`);
  }

  if (runs > 1) {
    const d10 = all.map((a) => a.s.acc.d10);
    const changed = products
      .filter((p) => new Set(all.map((a) => { const x = a.preds.find((q) => q.id === p.id)!; return `${x.top}|${x.review}`; })).size > 1)
      .map((p) => p.id);
    console.log(
      `variance: 10-digit per run ${d10.join(' / ')} (min–max ${Math.min(...d10)}–${Math.max(...d10)} of ${n}) · wrong ∧ auto per run ${all.map((a) => a.s.wrongAuto.length).join(' / ')} · auto rate per run ${all.map((a) => a.s.autoCorrect).join(' / ')} · answer or routing changed: ${changed.join(', ') || 'none'}`,
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
