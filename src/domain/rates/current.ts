// The one place that names the current rate data version and HTS revision. The HTS index files follow the revision
// ("2026 Rev. 21" → 2026-rev21.json); the Verify sheet's column Y must name the same revision (pnpm rates:import).
// 2026-rev21-v1 (2026-10-11): the 13 verified rows re-verified on HTS 2026 Rev. 21 (HTS_VERIFICATION_SPEC §8); rates as v5.
// 2026-rev21-v2 (2026-10-11): v1 with the importer's refs and regime notes in house style (note/heading numbers only);
// rates and golden figures identical to v1.
export const CURRENT_RATE_VERSION = '2026-rev21-v2';
export const CURRENT_HTS_REVISION = '2026 Rev. 21';
/** "Rev 21" — the short form used in UI labels. */
export const CURRENT_HTS_REV_SHORT = CURRENT_HTS_REVISION.replace(/^d{4} Rev. /, 'Rev ');
export const rateFileName = (version: string = CURRENT_RATE_VERSION) => `${version}.json`;
export const goldenFileName = (version: string = CURRENT_RATE_VERSION) => `golden-${version}.json`;
