import { describe, expect, it } from 'vitest';
import { cantText, refText, separatingLevels } from './explain';

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
