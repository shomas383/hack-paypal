// The one place that names the current rate data version (bump here + in scripts/import-verify-sheet.ts).
export const CURRENT_RATE_VERSION = '2026-rev20-v4';
export const CURRENT_HTS_REVISION = '2026 Rev. 20';
export const rateFileName = (version: string = CURRENT_RATE_VERSION) => `${version}.json`;
export const goldenFileName = (version: string = CURRENT_RATE_VERSION) => `golden-${version}.json`;
