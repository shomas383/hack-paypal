import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseRateText, toEngineMfn, type ParsedRate, type RateTerm, type SpecificUnit, type ValueBase } from './rateText';

// Every distinct shape of the General rate column in the HTS 2026 Rev. 20 export (84 shapes, 2026-10-07 export), one real
// string each, verbatim, with the line it came from. Each one either parses exactly or is refused with a reason — never
// a guess. Synthetic strings (not from the export) are in their own block below and say so.
const av = (rate_ppm: number, applies_to: ValueBase = 'full_value'): RateTerm => ({ kind: 'ad_valorem', rate_ppm, applies_to });
const sp = (amount_usd_micros: number, per: SpecificUnit): RateTerm => ({ kind: 'specific', amount_usd_micros, per });

type Ok = { type: 'free' | 'ad_valorem' | 'specific' | 'compound'; terms: RateTerm[]; measures?: string[]; splits?: string[] };
type No = { reason: string };
const PARSED: [line: string, text: string, expected: Ok][] = [
  ['0101.30.00.00', '6.8%', { type: 'ad_valorem', terms: [av(68_000)] }],
  ['0101.21.00', 'Free', { type: 'free', terms: [] }],
  ['0102.29.40', '1¢/kg', { type: 'specific', terms: [sp(10_000, 'kg')], measures: ['kg'] }],
  ['0402.99.90.00', '46.3¢/kg + 14.9%', { type: 'compound', terms: [sp(463_000, 'kg'), av(149_000)], measures: ['kg'] }],
  ['0401.10.00.00', '0.34¢/liter', { type: 'specific', terms: [sp(3_400, 'liter')], measures: ['liter'] }],
  ['0401.50.75.00', '$1.646/kg', { type: 'specific', terms: [sp(1_646_000, 'kg')], measures: ['kg'] }],
  ['8201.50.00.00', '1¢ each + 2.8%', { type: 'compound', terms: [sp(10_000, 'each'), av(28_000)], measures: ['count'] }],
  ['2709.00.10.00', '5.25¢/bbl', { type: 'specific', terms: [sp(52_500, 'bbl')], measures: ['bbl'] }],
  ['0105.11.00', '0.9¢ each', { type: 'specific', terms: [sp(9_000, 'each')], measures: ['count'] }],
  ['0402.29.50.00', '$1.104/kg + 14.9%', { type: 'compound', terms: [sp(1_104_000, 'kg'), av(149_000)], measures: ['kg'] }],
  ['6402.19.50', '76¢/pr. + 32%', { type: 'compound', terms: [sp(760_000, 'pair'), av(320_000)], measures: ['pairs'] }],
  ['9102.11.10', '44¢ each + 6% on the case + 14% on the strap, band or bracelet + 5.3% on the battery', {
    type: 'compound', terms: [sp(440_000, 'each'), av(60_000, 'case'), av(140_000, 'band'), av(53_000, 'battery')],
    measures: ['count'], splits: ['band', 'battery', 'case'] }],
  ['9101.99.40', '98¢ each + 3% on the case', { type: 'compound', terms: [sp(980_000, 'each'), av(30_000, 'case')], measures: ['count'], splits: ['case'] }],
  ['9102.21.30', '$1.75 each + 4.8% on the case + 11.2% on the strap, band or bracelet', {
    type: 'compound', terms: [sp(1_750_000, 'each'), av(48_000, 'case'), av(112_000, 'band')], measures: ['count'], splits: ['band', 'case'] }],
  ['9102.91.40', '40¢ each + 6% on the case + 5.3% on the battery', {
    type: 'compound', terms: [sp(400_000, 'each'), av(60_000, 'case'), av(53_000, 'battery')], measures: ['count'], splits: ['battery', 'case'] }],
  ['9105.99.10.00', '17¢ each + 2.5% + 1¢/jewel', {
    type: 'compound', terms: [sp(170_000, 'each'), av(25_000), sp(10_000, 'jewel')], measures: ['count', 'jewels'] }],
  ['9102.21.10', '75¢ each + 6% on the case + 14% on the strap, band or bracelet', {
    type: 'compound', terms: [sp(750_000, 'each'), av(60_000, 'case'), av(140_000, 'band')], measures: ['count'], splits: ['band', 'case'] }],
  ['9102.91.20', '3.9% on the movement and case + 5.3% on the battery', {
    type: 'compound', terms: [av(39_000, 'movement_and_case'), av(53_000, 'battery')], splits: ['battery', 'movement_and_case'] }],
  ['9108.11.40', '36¢ each + 5.3% on the battery', { type: 'compound', terms: [sp(360_000, 'each'), av(53_000, 'battery')], measures: ['count'], splits: ['battery'] }],
  ['0407.11.00.00', '2.8¢/doz.', { type: 'specific', terms: [sp(28_000, 'dozen')], measures: ['count'] }],
  ['0601.10.15.00', '89.6¢/1000', { type: 'specific', terms: [sp(896_000, 'thousand')], measures: ['count'] }],
  ['9108.90.50.00', '$2.16 each', { type: 'specific', terms: [sp(2_160_000, 'each')], measures: ['count'] }],
  ['9609.10.00.00', '14¢/gross + 4.3%', { type: 'compound', terms: [sp(140_000, 'gross'), av(43_000)], measures: ['count'] }],
  ['6501.00.60.00', '96¢/doz. + 1.4%', { type: 'compound', terms: [sp(960_000, 'dozen'), av(14_000)], measures: ['count'] }],
  ['9109.10.30', '7.5¢ each + 3.2% on the movement + 2.6% on the battery', {
    type: 'compound', terms: [sp(75_000, 'each'), av(32_000, 'movement'), av(26_000, 'battery')], measures: ['count'], splits: ['battery', 'movement'] }],
  ['1212.93.00.00', '$1.24/t', { type: 'specific', terms: [sp(1_240_000, 't')], measures: ['kg'] }],
  ['7005.29.08', '18.7¢/m2', { type: 'specific', terms: [sp(187_000, 'm2')], measures: ['m2'] }],
  ['9101.21.80', '$1.61 each + 4.4% on the case and strap, band or bracelet', {
    type: 'compound', terms: [sp(1_610_000, 'each'), av(44_000, 'case_and_band')], measures: ['count'], splits: ['case_and_band'] }],
  ['9101.29.10', '40¢ each + 5% on the case and strap, band or bracelet', {
    type: 'compound', terms: [sp(400_000, 'each'), av(50_000, 'case_and_band')], measures: ['count'], splits: ['case_and_band'] }],
  ['9108.12.00', '3.1% on the movement + 4.2% on the battery', {
    type: 'compound', terms: [av(31_000, 'movement'), av(42_000, 'battery')], splits: ['battery', 'movement'] }],
  ['0601.10.60.00', '$1.34/1000', { type: 'specific', terms: [sp(1_340_000, 'thousand')], measures: ['count'] }],
  ['0806.10.20', '$1.13/m3', { type: 'specific', terms: [sp(1_130_000, 'm3')], measures: ['m3'] }],
  ['1704.90.58.00', '40¢/kg +10.4%', { type: 'compound', terms: [sp(400_000, 'kg'), av(104_000)], measures: ['kg'] }],
  ['1901.10.56.00', '$1.035/kg +13.6%', { type: 'compound', terms: [sp(1_035_000, 'kg'), av(136_000)], measures: ['kg'] }],
  ['4421.91.80', '6.5¢/gross', { type: 'specific', terms: [sp(65_000, 'gross')], measures: ['count'] }],
  ['9101.11.40', '51¢ each + 6.25% on the case and strap, band or bracelet + 5.3% on the battery', {
    type: 'compound', terms: [sp(510_000, 'each'), av(62_500, 'case_and_band'), av(53_000, 'battery')], measures: ['count'], splits: ['battery', 'case_and_band'] }],
  // The official text drops "the" here ("on case and strap"); same base.
  ['9101.19.40', '41¢ each + 5% on case and strap, band or bracelet + 4.2% on the battery', {
    type: 'compound', terms: [sp(410_000, 'each'), av(50_000, 'case_and_band'), av(42_000, 'battery')], measures: ['count'], splits: ['battery', 'case_and_band'] }],
  ['9102.99.60', '$1.16 each + 6% on the case', { type: 'compound', terms: [sp(1_160_000, 'each'), av(60_000, 'case')], measures: ['count'], splits: ['case'] }],
  ['9104.00.10', '20¢ each + 4.3% on the movement and case + 3.5% on the battery', {
    type: 'compound', terms: [sp(200_000, 'each'), av(43_000, 'movement_and_case'), av(35_000, 'battery')], measures: ['count'], splits: ['battery', 'movement_and_case'] }],
  // No space before "+" in the official text.
  ['9105.21.40', '3.9% on the movement and case+ 5.3% on the battery', {
    type: 'compound', terms: [av(39_000, 'movement_and_case'), av(53_000, 'battery')], splits: ['battery', 'movement_and_case'] }],
  ['0104.20.00.00', '68¢/head', { type: 'specific', terms: [sp(680_000, 'head')], measures: ['count'] }],
  ['1212.91.00.00', '39.7¢/t', { type: 'specific', terms: [sp(397_000, 't')], measures: ['kg'] }],
  // A space after the slash in the official text.
  ['2009.21.20.00', '4.5¢/ liter', { type: 'specific', terms: [sp(45_000, 'liter')], measures: ['liter'] }],
  ['2202.99.28.00', '23.5¢/liter + 14.9%', { type: 'compound', terms: [sp(235_000, 'liter'), av(149_000)], measures: ['liter'] }],
  ['6505.00.08.00', '13.5¢/kg + 6.3% + 1.9¢/article', {
    type: 'compound', terms: [sp(135_000, 'kg'), av(63_000), sp(19_000, 'each')], measures: ['count', 'kg'] }],
  ['7005.21.10', '14.5¢/m2 + 0.4%', { type: 'compound', terms: [sp(145_000, 'm2'), av(4_000)], measures: ['m2'] }],
  ['9106.90.55', '3.9% on the apparatus + 5.3% on the battery', {
    type: 'compound', terms: [av(39_000, 'apparatus'), av(53_000, 'battery')], splits: ['apparatus', 'battery'] }],
  ['9608.99.30.00', '20¢/thousand + 3.5%', { type: 'compound', terms: [sp(200_000, 'thousand'), av(35_000)], measures: ['count'] }],
];

const REFUSED: [line: string, text: string, expected: No][] = [
  ['0711.20.18.00', '3.7¢/kg on drained weight', { reason: 'SPECIAL_MEASURE' }],
  ['6103.22.00', 'The rate applicable to each garment in the ensemble if separately entered', { reason: 'REFERS_TO_OTHER_RATE' }],
  ['1701.12.05.00', '3.6606¢/kg less 0.020668¢/kg for each degree under 100 degrees (and fractions of a degree in proportion) but not less than 3.143854¢/kg', { reason: 'CONDITIONAL' }],
  ['1509.20.20', '5¢/kg on contents and container', { reason: 'SPECIAL_MEASURE' }],
  ['1702.90.05.00', '3.6606¢/kg of total sugars', { reason: 'SPECIAL_MEASURE' }],
  ['5101.11.60', '18.7¢/clean kg', { reason: 'SPECIAL_MEASURE' }],
  ['1702.20.28', '16.9¢/kg of total sugars + 5.1%', { reason: 'SPECIAL_MEASURE' }],
  ['2004.90.80.00', '2.1¢/kg on entire contents of container', { reason: 'SPECIAL_MEASURE' }],
  ['2207.10.30.00', '18.9¢/pf.liter', { reason: 'SPECIAL_MEASURE' }],
  ['5810.91.00', 'See additional U.S. note 1', { reason: 'REFERS_TO_OTHER_RATE' }],
  ['8205.90.60.00', 'The rate of duty applicable to that article in the set subject to the highest rate of duty', { reason: 'REFERS_TO_OTHER_RATE' }],
  ['2106.90.52.00', 'The rate applicable to the natural juice in heading 2009', { reason: 'REFERS_TO_OTHER_RATE' }],
  ['2603.00.00', '1.7¢/kg on lead content', { reason: 'SPECIAL_MEASURE' }],
  ['7801.10.00.00', '2.5% on the value of the lead content', { reason: 'SPECIAL_MEASURE' }],
  ['0711.51.00.00', '5.7¢/kg on drained weight + 8%', { reason: 'SPECIAL_MEASURE' }],
  ['2613.10.00.00', '12.8¢/kg on molybdenum content + 1.8%', { reason: 'SPECIAL_MEASURE' }],
  ['9005.90.40.00', 'The rate applicable to the article of which it is a part or accessory', { reason: 'REFERS_TO_OTHER_RATE' }],
  ['9301.90.30', '4.7% on the value of the rifle + 20% on the value of the telescopic sight, if any', { reason: 'SPECIAL_BASE' }],
  ['9606.21.40.00', '0.3¢/line/ gross + 4.6%', { reason: 'SPECIAL_MEASURE' }],
  ['9105.19.30', '43¢ each + 2.8¢/jewel over 7 + 3.7% on the case', { reason: 'CONDITIONAL' }],
  ['9110.11.00.00', 'The rate applicable to the complete, assembled movement', { reason: 'REFERS_TO_OTHER_RATE' }],
  ['9110.90.40.00', '4.3% + 1.7¢/jewel + 0.2¢ for each other piece or part, but if consisting in part of a plate or a set of plates the total duty shall not exceed the duty for the complete movement', { reason: 'CONDITIONAL' }],
  ['9620.00.15.00', 'The rate applicable to the article of which it is an accessory', { reason: 'REFERS_TO_OTHER_RATE' }],
  ['0711.59.10.00', '5.7¢/kg on drained weight +8%', { reason: 'SPECIAL_MEASURE' }],
  ['2204.30.00.00', '4.4¢/liter + 31.4¢/pf. liter', { reason: 'SPECIAL_MEASURE' }],
  ['2206.00.30.00', '3.1¢/liter + 22.1¢/pf. liter on ethyl alcohol content', { reason: 'SPECIAL_MEASURE' }],
  ['2611.00.60.00', '37.5¢/kg on tungsten content', { reason: 'SPECIAL_MEASURE' }],
  ['2613.90.00.00', '17.8¢/kg on molybdenum content', { reason: 'SPECIAL_MEASURE' }],
  ['2620.19.60', '0.7¢/kg on copper content + 0.7¢/kg on lead content', { reason: 'SPECIAL_MEASURE' }],
  ['2620.99.20.00', '17.6¢/kg on tungsten content + 3.8%', { reason: 'SPECIAL_MEASURE' }],
  // "The entire set" is a value base we don't interpret (one line); refused rather than read as the full value.
  ['3213.10.00.00', '6.5% on the entire set', { reason: 'SPECIAL_BASE' }],
  ['6104.29.10', 'The rate applicable to each garment in the ensemble if entered separately', { reason: 'REFERS_TO_OTHER_RATE' }],
  ['6203.29.30', 'The rate applicable to each garment in the in the ensemble if separately entered', { reason: 'REFERS_TO_OTHER_RATE' }],
  ['8104.90.00.00', '14.8¢/kg on magnesium content + 3.5%', { reason: 'SPECIAL_MEASURE' }],
  ['9209.92.40.00', '10¢/1,000 pins + 3.5%', { reason: 'SPECIAL_MEASURE' }],
  ['9608.50.00.00', 'The rate applicable to each article in the absence of this subheading', { reason: 'REFERS_TO_OTHER_RATE' }],
];

const ok = (p: ParsedRate) => {
  if (!p.ok) throw new Error(`refused: ${p.reason} (${p.detail})`);
  return p;
};

describe('parseRateText — every General-column shape in HTS 2026 Rev. 20', () => {
  it('covers all 84 shapes of the export, each once', () => {
    expect(PARSED.length + REFUSED.length).toBe(84);
    expect(new Set([...PARSED, ...REFUSED].map(([, t]) => t)).size).toBe(84);
  });

  it.each(PARSED)('%s %j parses exactly', (_line, text, want) => {
    const p = ok(parseRateText(text));
    expect(p.text).toBe(text); // verbatim, never rewritten
    expect(p.type).toBe(want.type);
    expect(p.terms).toEqual(want.terms);
    expect(p.measures).toEqual(want.measures ?? []);
    expect(p.splits).toEqual(want.splits ?? []);
  });

  it.each(REFUSED)('%s %j is refused, not guessed', (_line, text, want) => {
    const p = parseRateText(text);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.reason).toBe(want.reason);
      expect(p.detail.length).toBeGreaterThan(0);
      expect(p.text).toBe(text);
    }
  });
});

describe('parseRateText — synthetic strings (NOT from the export)', () => {
  it('empty or whitespace-only text (the export has 12 rows whose General text is "\\n") → EMPTY', () => {
    for (const t of ['', '\n', '  ']) expect(parseRateText(t)).toMatchObject({ ok: false, reason: 'EMPTY' });
  });

  it('more precision than integer micros / ppm can hold → PRECISION, never rounded', () => {
    expect(parseRateText('0.12345¢/kg')).toMatchObject({ ok: false, reason: 'PRECISION' });
    expect(parseRateText('$1.2345678/kg')).toMatchObject({ ok: false, reason: 'PRECISION' });
    expect(parseRateText('1.23456%')).toMatchObject({ ok: false, reason: 'PRECISION' });
  });

  it('anything outside the grammar → UNRECOGNISED', () => {
    for (const t of ['12% or 3¢/kg, whichever is higher', '5 percent', '3¢/kg + ', '+ 5%', '5%%', 'free', '¢/kg', '$/kg']) {
      expect(parseRateText(t)).toMatchObject({ ok: false, reason: 'UNRECOGNISED' });
    }
  });

  it('uses no floating point: large and fractional values stay exact', () => {
    expect(ok(parseRateText('0.0001¢ each')).terms).toEqual([sp(1, 'each')]);
    expect(ok(parseRateText('$9999.999999/kg')).terms).toEqual([sp(9_999_999_999, 'kg')]);
    expect(ok(parseRateText('0.0001%')).terms).toEqual([av(1)]);
    expect(ok(parseRateText('100%')).terms).toEqual([av(1_000_000)]);
  });
});

describe('parseRateText — round trip (fast-check)', () => {
  const pct = fc.integer({ min: 1, max: 999_999 }); // ppm, rendered with up to 4 decimals
  const cents = fc.integer({ min: 1, max: 99_999_999 }); // micros, rendered as ¢ with up to 4 decimals
  const per = fc.constantFrom('each', 'kg', 'liter', 'pr.', 'doz.', 'gross', '1000', 'thousand', 'm2', 'm3', 't', 'head', 'bbl');
  // Integer rendering with 4 decimals (no floating point), trailing zeros dropped: 125000 → "12.5".
  const fmt = (n: number, scale: number) => `${Math.floor(n / scale)}.${String(n % scale).padStart(4, '0')}`.replace(/\.?0+$/, '');
  const render = (spec: { micros: number; per: string } | null, adval: number | null) =>
    [spec && `${fmt(spec.micros, 10_000)}¢${spec.per === 'each' ? ' each' : `/${spec.per}`}`, adval !== null && `${fmt(adval, 10_000)}%`]
      .filter(Boolean)
      .join(' + ');

  it('a rendered specific + ad valorem rate parses back to the same integers', () => {
    fc.assert(
      fc.property(fc.option(fc.record({ micros: cents, per }), { nil: null }), fc.option(pct, { nil: null }), (spec, adval) => {
        fc.pre(spec !== null || adval !== null);
        const p = ok(parseRateText(render(spec, adval)));
        const terms = p.terms;
        if (spec) expect(terms[0]).toMatchObject({ kind: 'specific', amount_usd_micros: spec.micros });
        if (adval !== null) expect(terms[terms.length - 1]).toEqual(av(adval));
      }),
    );
  });
});

describe('toEngineMfn — the subset the verified rate engine can compute', () => {
  it('maps Free, ad valorem, and each / full-value / case / band compounds to the verified schema shape', () => {
    expect(toEngineMfn(ok(parseRateText('Free')))).toEqual({ type: 'free' });
    expect(toEngineMfn(ok(parseRateText('16.6%')))).toEqual({ type: 'ad_valorem', rate_ppm: 166_000 });
    // P03 / P13 / P14 (9102.21.70) and P11 (8211.92.90), as the official General text reads.
    expect(toEngineMfn(ok(parseRateText('$1.53 each + 4.2% on the case + 9.8% on the strap, band or bracelet')))).toEqual({
      type: 'compound',
      text: '$1.53 each + 4.2% on the case + 9.8% on the strap, band or bracelet',
      components: [
        { kind: 'specific', amount_usd_micros: 1_530_000, per: 'each' },
        { kind: 'ad_valorem', rate_ppm: 42_000, applies_to: 'case' },
        { kind: 'ad_valorem', rate_ppm: 98_000, applies_to: 'band' },
      ],
    });
    expect(toEngineMfn(ok(parseRateText('0.4¢ each + 6.1%')))).toEqual({
      type: 'compound',
      text: '0.4¢ each + 6.1%',
      components: [
        { kind: 'specific', amount_usd_micros: 4_000, per: 'each' },
        { kind: 'ad_valorem', rate_ppm: 61_000, applies_to: 'full_value' },
      ],
    });
    expect(toEngineMfn(ok(parseRateText('$2.16 each')))).toEqual({
      type: 'specific',
      text: '$2.16 each',
      components: [{ kind: 'specific', amount_usd_micros: 2_160_000, per: 'each' }],
    });
  });

  it('returns null for units or value bases the verified engine has no input for', () => {
    for (const t of ['1¢/kg', '76¢/pr. + 32%', '40¢ each + 6% on the case + 5.3% on the battery', '$1.61 each + 4.4% on the case and strap, band or bracelet', '17¢ each + 2.5% + 1¢/jewel']) {
      expect(toEngineMfn(ok(parseRateText(t)))).toBeNull();
    }
    expect(toEngineMfn(parseRateText('3.7¢/kg on drained weight'))).toBeNull(); // refused text
  });
});
