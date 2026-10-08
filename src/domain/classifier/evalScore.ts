// Eval scoring for `pnpm eval:classifier` (SPEC §4.1). Pure. Verified products are scored on the code (6/8/10 digits)
// and routing; EXCLUDED products (P07: origin unknown) are scored on routing only. The safety number is wrong ∧ auto:
// a wrong code that would have been auto-accepted. It must be 0.
export interface EvalProduct {
  id: string;
  title: string;
  origin: string | null;
  expected: { status: 'VERIFIED' | 'EXCLUDED'; hts10: string | null };
}

export interface Prediction {
  id: string;
  /** Top candidate's code, or null for an invalid answer. */
  top: string | null;
  confidence: number | null;
  review: boolean;
  reasons: string[];
}

const digits = (h: string) => h.replace(/\D/g, '');

export function digitMatch(expected: string, predicted: string | null) {
  if (!predicted) return { d6: false, d8: false, d10: false };
  const [e, p] = [digits(expected), digits(predicted)];
  return { d6: e.slice(0, 6) === p.slice(0, 6), d8: e.slice(0, 8) === p.slice(0, 8), d10: e === p };
}

export function scoreRun(products: EvalProduct[], predictions: Prediction[]) {
  const byId = new Map(predictions.map((p) => [p.id, p]));
  const verified = products.filter((p) => p.expected.status === 'VERIFIED' && p.expected.hts10);
  const acc = { d6: 0, d8: 0, d10: 0 };
  const matrix = { correctAuto: 0, correctReview: 0, wrongAuto: 0, wrongReview: 0 };
  const wrongAuto: string[] = [];

  for (const prod of verified) {
    const pred = byId.get(prod.id);
    const m = digitMatch(prod.expected.hts10!, pred?.top ?? null);
    acc.d6 += Number(m.d6);
    acc.d8 += Number(m.d8);
    acc.d10 += Number(m.d10);
    const review = pred ? pred.review : true; // no prediction never counts as auto
    if (m.d10) matrix[review ? 'correctReview' : 'correctAuto']++;
    else {
      matrix[review ? 'wrongReview' : 'wrongAuto']++;
      if (!review) wrongAuto.push(prod.id);
    }
  }

  const excludedRouting = products
    .filter((p) => p.expected.status === 'EXCLUDED')
    .map((p) => ({ id: p.id, pass: byId.get(p.id)?.review ?? true }));

  return {
    n: verified.length,
    acc,
    matrix,
    wrongAuto,
    autoCorrect: matrix.correctAuto,
    excludedRouting,
    safe: wrongAuto.length === 0 && excludedRouting.every((e) => e.pass),
  };
}
