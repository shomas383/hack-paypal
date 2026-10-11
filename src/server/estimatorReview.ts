// The reviewed IEEPA list (data/reviews/ieepa-ended-2026-rev21.json): headings EO 14389 §1 / CBP CSMS # 67834313 end although
// the HTS still prints them, approved by group (docs/IEEPA_HEADINGS_REVIEW.md). Loaded and validated once per process.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VerifiedOverride } from '@/domain/estimator/headings';
import { overrideFromList, ReviewedListSchema } from '@/domain/estimator/reviewedList';

export const IEEPA_REVIEW_FILE = 'data/reviews/ieepa-ended-2026-rev21.json';

let cached: VerifiedOverride | undefined;

export function ieepaOverride(): VerifiedOverride {
  cached ??= overrideFromList(ReviewedListSchema.parse(JSON.parse(readFileSync(join(process.cwd(), IEEPA_REVIEW_FILE), 'utf8'))), IEEPA_REVIEW_FILE);
  return cached;
}
