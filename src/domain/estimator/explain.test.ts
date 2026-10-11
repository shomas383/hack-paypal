import { describe, expect, it } from 'vitest';
import { cantText, plainBasis, reasonText, refText, sameDutyText, separatingLevels } from './explain';

describe('refText', () => {
  it('names notes, headings and footnotes the way the schedule does', () => {
    expect(refText('note III 16(c)(vii)')).toBe('U.S. note 16(c)(vii) to subchapter III');
    expect(refText('note chapter 1')).toBe('U.S. note 1 to chapter 99');
    expect(refText('heading 9903.41.10')).toBe('heading 9903.41.10');
    expect(refText('footnote 9903.41.10')).toBe("the line's own footnote to heading 9903.41.10");
  });
});

describe('cantText', () => {
  it('every reason has a plain sentence; refs and measures are spelled out', () => {
    expect(cantText('UNMODELED_REGIME', '', ['note III 16(c)(vii)'])).toMatch(/^U\.S\. note 16\(c\)\(vii\) to subchapter III names this line, and the estimator doesn’t model it yet\. Often these are Section 232/);
    // A heading the line's own footnote also cites is named once; the sentence starts with a capital.
    expect(cantText('UNMODELED_REGIME', '', ['footnote 9903.41.10', 'heading 9903.41.10'])).toMatch(/^The line's own footnote to heading 9903\.41\.10 names this line,/);
    expect(cantText('NEEDS_MEASURES', '3823.11.00 General rate "2.1¢/kg + 3.8%" needs kg', [])).toBe('The official rate depends on weight (kilograms). Estimates by weight, volume or count aren’t supported yet.');
    expect(cantText('NEEDS_SPLIT', '', [])).toMatch(/watch case and on the strap, band or bracelet/);
    for (const r of ['SPECIAL_PROVISION', 'ORIGIN_UNSUPPORTED', 'BLOCKED_BY_GATE', 'UNKNOWN_CODE', 'NO_RATE', 'UNPARSEABLE', 'PARTIAL_LIST'] as const) expect(cantText(r, 'x', []).length).toBeGreaterThan(20);
  });
});

describe('separatingLevels', () => {
  it('the first official level where the candidate chains differ, verbatim', () => {
    const cotton = ["Men's or boys' suits…", "Trousers…:", 'Of cotton:', "Men's:", 'Blue denim (347)'];
    const synthetic = ["Men's or boys' suits…", "Trousers…:", 'Of synthetic fibers:', "Men's:", 'Other (647)'];
    expect(separatingLevels([cotton, synthetic])).toEqual(['Of cotton', 'Of synthetic fibers']);
    expect(separatingLevels([cotton])).toBeNull();
    expect(separatingLevels([cotton, cotton])).toBeNull();
  });
});

describe('plainBasis', () => {
  const mfn = { label: 'General rate', basis: '8.7% of customs value' };
  it('says the engine basis in plain words, naming the origin and heading', () => {
    expect(plainBasis(mfn, 'JP')).toBe('General rate: 8.7% of the price');
    expect(plainBasis({ label: 'General rate', basis: 'Free' }, 'JP')).toBe('General rate: free');
    expect(plainBasis({ label: 'General rate', basis: '$1.53 each + 4.2% case + 9.8% band' }, 'DE')).toBe('General rate: $1.53 each + 4.2% case + 9.8% band');
    expect(plainBasis({ label: 'x', chapter99: '9903.05.49', basis: 'combined cap 12.5% (base or AVE below cap)' }, 'JP')).toBe('Japan’s 12.5% combined rate applies (heading 9903.05.49)');
    expect(plainBasis({ label: 'x', chapter99: '9903.05.39', basis: 'combined cap 10% (base or AVE below cap)' }, 'DE')).toBe('The EU’s 10% combined rate applies (heading 9903.05.39)');
    expect(plainBasis({ label: 'x', chapter99: '9903.05.48', basis: 'base ≥ 12.5% cap — no add-on' }, 'JP')).toBe('The General rate is already at least Japan’s 12.5% combined rate, so heading 9903.05.48 adds nothing');
    expect(plainBasis({ label: 'x', chapter99: '9903.88.15', basis: '+25% of full customs value' }, 'CN')).toBe('Heading 9903.88.15 adds 25% of the price');
    expect(plainBasis({ label: 'x', chapter99: '9903.05.50', basis: 'exempt — no add-on' }, 'JP')).toBe('Heading 9903.05.50 applies: no additional duty');
  });
  it('an unrecognised basis is shown as the engine wrote it', () => {
    expect(plainBasis({ label: 'x', chapter99: '9903.99.99', basis: 'something new' }, 'JP')).toBe('something new');
  });
});

describe('reasonText', () => {
  const sep = [
    { name: 'unit value excluding case (over or not over $100)', value_from_listing: null },
    { name: 'electric pickup / electrical amplification', value_from_listing: null },
    { name: 'fiber content', value_from_listing: 'cotton' },
  ];
  it('one plain sentence, never the codes; names what the description doesn’t say', () => {
    expect(reasonText(['LOW_CONFIDENCE', 'MISSING_ATTRIBUTES', 'MODEL_FLAGGED'], sep)).toBe(
      'Not certain which line applies — the description doesn’t say unit value excluding case (over or not over $100) or electric pickup / electrical amplification.',
    );
    expect(reasonText(['LOW_CONFIDENCE'], [])).toBe('Not certain which line applies — compare the official descriptions below with the product.');
    expect(reasonText([], sep)).toBeNull();
    // Stopped / no candidates are explained by the empty result itself.
    expect(reasonText(['STOPPED', 'NO_CANDIDATES'], [])).toBeNull();
    for (const r of ['LOW_CONFIDENCE', 'TOP2_DIFFER_6', 'MODEL_FLAGGED', 'INVALID_CODE', 'UNVERIFIED_EVIDENCE', 'TOO_BROAD']) expect(reasonText([r], [])).not.toMatch(/[A-Z]{2,}_/);
  });
});

describe('sameDutyText', () => {
  it('the facts that pick the line, when the duty is the same either way', () => {
    expect(sameDutyText([{ name: 'unit value excluding case', value_from_listing: null }, { name: 'electric pickup', value_from_listing: null }], null)).toBe(
      'The exact line depends on unit value excluding case and electric pickup, but the estimate is the same either way.',
    );
    expect(sameDutyText([], ['Of cotton', 'Of synthetic fibers'])).toBe('The exact line depends on whether it is “Of cotton” or “Of synthetic fibers”, but the estimate is the same either way.');
    expect(sameDutyText([{ name: 'Fiber content', value_from_listing: null }, { name: 'UV filter', value_from_listing: null }], null)).toBe('The exact line depends on fiber content and UV filter, but the estimate is the same either way.');
    expect(sameDutyText([], null)).toBeNull();
  });
});
