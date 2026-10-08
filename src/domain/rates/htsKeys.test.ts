import { describe, expect, it } from 'vitest';
import { checkRateKeysAgainstHts } from './htsKeys';

const hts = {
  hts_revision: '2026 Rev. 20',
  codes: new Map<string, { componentReporting?: true }>([
    ['6203.42.4511', {}],
    ['9102.21.70', { componentReporting: true }],
  ]),
};
const row = (id: string, hts10: string, component_reporting?: true) => ({ id, hts10, ...(component_reporting ? { component_reporting } : {}) });

describe('checkRateKeysAgainstHts — every rate key must be a real Rev 20 line', () => {
  it('passes real 10-digit lines and component-reporting 8-digit lines', () => {
    expect(checkRateKeysAgainstHts([row('JP-6203.42.4511', '6203.42.4511'), row('JP-9102.21.70', '9102.21.70', true)], hts, '2026 Rev. 20')).toEqual([]);
  });

  it('fails a key that is not in the index (e.g. the pre-renumbering 6203.42.4011, or an invented 9102.21.7000)', () => {
    const errors = checkRateKeysAgainstHts([row('JP-6203.42.4011', '6203.42.4011'), row('JP-9102.21.7000', '9102.21.7000')], hts, '2026 Rev. 20');
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toMatch(/6203\.42\.4011.*not in the HTS index/);
  });

  it('fails when the row flag and the index disagree about component reporting', () => {
    expect(checkRateKeysAgainstHts([row('JP-9102.21.70', '9102.21.70')], hts, '2026 Rev. 20').join('\n')).toMatch(/component/);
    expect(checkRateKeysAgainstHts([row('JP-6203.42.4511', '6203.42.4511', true)], hts, '2026 Rev. 20').join('\n')).toMatch(/component/);
  });

  it('fails when the HTS index revision is not the rate data revision', () => {
    expect(checkRateKeysAgainstHts([], { ...hts, hts_revision: '2026 Rev. 19' }, '2026 Rev. 20').join('\n')).toMatch(/revision/);
  });
});
