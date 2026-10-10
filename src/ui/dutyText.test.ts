import { describe, expect, it } from 'vitest';
import { dutyLineLabel, officialChain, officialChainFromText, policyReasonText, splitSources } from './dutyText';

describe('duty line display text (display only; amounts never pass through here)', () => {
  it('MFN line: "MFN · <hts> · <rate text>"', () => {
    expect(dutyLineLabel({ chapter99: null, basis: '$1.53 each + 4.2% case + 9.8% band' }, '9102.21.70')).toBe('MFN · 9102.21.70 · $1.53 each + 4.2% case + 9.8% band');
  });

  it('Chapter 99 lines: heading + short basis', () => {
    expect(dutyLineLabel({ chapter99: '9903.05.39', basis: 'combined cap 10% (base or AVE below cap)' }, '9102.21.70')).toBe('9903.05.39 · combined cap 10%');
    expect(dutyLineLabel({ chapter99: '9903.05.31', basis: '+12.5% of full customs value' }, '9102.21.70')).toBe('9903.05.31 · +12.5%');
    expect(dutyLineLabel({ chapter99: '9903.05.48', basis: 'base ≥ 12.5% cap — no add-on' }, '6203.42.4511')).toBe('9903.05.48 · base ≥ 12.5% cap, no add-on');
  });

  it('sources: the refs after the heading, split on ";"', () => {
    expect(splitSources('9903.05.39 — U.S. note 52(k); CSMS #69326983')).toEqual(['U.S. note 52(k)', 'CSMS #69326983']);
    expect(splitSources('9102.21.70 General (HTS 2026 Rev. 20)')).toEqual(['9102.21.70 General (HTS 2026 Rev. 20)']);
  });

  it('description chain: official levels verbatim, trailing colons removed, joined with " › "', () => {
    const chain = [
      'Wrist watches, pocket watches and other watches, including stop watches, other than those of heading 9101:',
      'Other wrist watches, whether or not incorporating a stop watch facility:',
      'With automatic winding:',
      'Having over 17 jewels in the movement:',
      'With strap, band or bracelet of textile material or of base metal, whether or not gold- or silver-plated',
    ];
    const expected =
      'Wrist watches, pocket watches and other watches, including stop watches, other than those of heading 9101 › Other wrist watches, whether or not incorporating a stop watch facility › With automatic winding › Having over 17 jewels in the movement › With strap, band or bracelet of textile material or of base metal, whether or not gold- or silver-plated';
    expect(officialChain(chain)).toBe(expected);
    // The agent tool sends the same chain joined with " > " (what the model quotes); the UI shows the same text.
    expect(officialChainFromText(chain.join(' > '))).toBe(expected);
    expect(officialChain([])).toBeNull();
  });

  it('policy reasons in plain words; unknown codes pass through', () => {
    expect(policyReasonText('QUOTE_EXPIRED')).toBe('the quote expired before capture');
    expect(policyReasonText('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
