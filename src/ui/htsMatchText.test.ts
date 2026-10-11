import { describe, expect, it } from 'vitest';
import { markTerms, shortLevel } from './htsMatchText';

describe('shortLevel — one official level for the search match line: verbatim, trailing ":" removed, cut at ~60 chars', () => {
  it('short levels are shown whole', () => {
    expect(shortLevel('With automatic winding:')).toBe('With automatic winding');
  });

  it('long levels are cut at a word boundary with "…" (display only; the full chain is one disclosure away)', () => {
    const l = 'Wrist watches, pocket watches and other watches, including stop watches, other than those of heading 9101:';
    const s = shortLevel(l);
    expect(s).toBe('Wrist watches, pocket watches and other watches, including…');
    expect(s.length).toBeLessThanOrEqual(61);
    expect(l.startsWith(s.slice(0, -1))).toBe(true); // a verbatim prefix, never reworded
  });

  it('cuts at the last whole word', () => {
    expect(shortLevel('Other wrist watches, whether or not incorporating a stop watch facility:')).toBe('Other wrist watches, whether or not incorporating a stop…');
  });
});

describe('markTerms — segments with the matched terms marked (same singular rule as the search)', () => {
  it('marks every word whose token is a matched term (watches → watch)', () => {
    expect(markTerms('Other wrist watches, a stop watch', ['watch'])).toEqual([
      { text: 'Other wrist ', mark: false },
      { text: 'watches', mark: true },
      { text: ', a stop ', mark: false },
      { text: 'watch', mark: true },
    ]);
  });

  it('is case-insensitive and leaves text without terms whole', () => {
    expect(markTerms('With automatic winding', ['automatic'])).toEqual([
      { text: 'With ', mark: false },
      { text: 'automatic', mark: true },
      { text: ' winding', mark: false },
    ]);
    expect(markTerms('Having over 17 jewels', ['automatic'])).toEqual([{ text: 'Having over 17 jewels', mark: false }]);
  });
});
