import { describe, expect, it } from 'vitest';
import { DISCLOSURE_TEXT, type CantReason } from './estimate';
import { cantText, exclusionText, lineDifferences, NOT_INCLUDED, rangeReasonText, plainBasis, reasonText, refText, sameDutyText, separatingLevels, trimOfficial } from './explain';

describe('refText', () => {
  it('names notes, headings and footnotes the way the schedule does', () => {
    expect(refText('note III 16(c)(vii)')).toBe('U.S. note 16(c)(vii) to subchapter III');
    expect(refText('note chapter 1')).toBe('U.S. note 1 to chapter 99');
    expect(refText('heading 9903.41.10')).toBe('heading 9903.41.10');
    expect(refText('footnote 9903.41.10')).toBe("the line's own footnote to heading 9903.41.10");
  });
});

// Real Rev 21 heading texts.
const H03 = { heading: '9903.82.03', text: 'Except for articles classifiable in chapters 72, 73, 74 or 76, articles where the weight of the applicable metal is less than 15 percent of the weight of the imported article, as provided for in subdivision (c) of U.S. note 16 to this subchapter' };
const H06 = { heading: '9903.82.06', text: 'Except as provided for in headings 9903.82.15 and 9903.85.68, articles of copper and derivative aluminum and steel articles, as provided for in subdivisions (c)(ii), (iv), (vi)–(viii), (xi) and (e) of U.S. note 16 to this subchapter' };
const H09 = { heading: '9903.82.09', text: 'Except as provided for in headings 9903.82.16, 9903.82.20–9903.82.26 and 9903.85.68, articles of copper and derivative aluminum and steel articles, as provided for in subdivisions (c)(vi)–(viii) and (xi) of U.S. note 16 to this subchapter' };
const H4110 = { heading: '9903.41.10', text: 'Footwear with outer soles of leather and uppers wholly or in part of leather, and footwear with outer soles of rubber or plastics and uppers having an exterior surface area predominantly of leather, the foregoing provided for in chapter 64, except (a) slip-on footwear of a type not suitable for outdoor use' };

describe('trimOfficial', () => {
  it('drops the leading Except clause and the trailing note citation; stops a long text at a clause boundary', () => {
    expect(trimOfficial(H09.text)).toBe('…articles of copper and derivative aluminum and steel articles');
    expect(trimOfficial(H4110.text)).toBe('Footwear with outer soles of leather and uppers wholly or in part of leather…');
    expect(trimOfficial('Short text')).toBe('Short text');
  });
});

describe('cantText', () => {
  it('every reason has a plain sentence; refs and measures are spelled out', () => {
    // A note: cited with the headings it ties the line to (numbers only).
    expect(cantText('UNMODELED_REGIME', '', ['note III 16(c)(vii)'], [H03, H06, H09])).toBe(
      'U.S. note 16(c)(vii) to subchapter III names this line and ties it to headings 9903.82.03, 9903.82.06 and 9903.82.09, and the estimator doesn’t model them yet.',
    );
    // The line's own footnote / heading: named once, with the heading's own description, trimmed.
    expect(cantText('UNMODELED_REGIME', '', ['footnote 9903.41.10', 'heading 9903.41.10'], [H4110])).toBe(
      'The line’s own footnote cites heading 9903.41.10 (“Footwear with outer soles of leather and uppers wholly or in part of leather…”), and the estimator doesn’t model it yet.',
    );
    // A heading and a note: two sentences.
    expect(cantText('UNMODELED_REGIME', '', ['heading 9903.82.03', 'note III 16(c)(vii)'], [H03, H06, H09])).toBe(
      'Heading 9903.82.03 (“…articles where the weight of the applicable metal is less than 15 percent of the weight of the imported article”) names this line. U.S. note 16(c)(vii) to subchapter III also names this line and ties it to headings 9903.82.03, 9903.82.06 and 9903.82.09. The estimator doesn’t model them yet.',
    );
    expect(cantText('NEEDS_FACTS', '', [])).toBe('A verified rate row covers this line, but its duty depends on the answers below.');
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

// Which differences the "Not certain" / "either way" notes name: only where the shown lines' official descriptions part,
// computed by code (decision 2026-10-12). A model attribute name is used only when it clearly matches a difference (each
// of its content words is in that difference's official text); otherwise the official text, shortened. The model never adds
// or removes a difference.
const chain = (...levels: string[]) => ['Head:', ...levels];
describe('lineDifferences', () => {
  it('(ii) a difference that changes the duty comes first, then the others by depth', () => {
    // synthetic chains: the shallow split (Boxed / Loose) doesn't change the duty; the deep one (Of steel / Of plastics) does
    const lines = [
      { chain: chain('Boxed:', 'Of steel'), dutyMinor: 500 },
      { chain: chain('Boxed:', 'Of plastics'), dutyMinor: 300 },
      { chain: chain('Loose:', 'Of steel'), dutyMinor: 500 },
    ];
    const d = lineDifferences(lines, []);
    expect(d.map((x) => [x.options, x.changesDuty])).toEqual([
      [['Of steel', 'Of plastics'], true],
      [['Boxed', 'Loose'], false],
    ]);
    expect(rangeReasonText(d, true)).toBe('Not certain which line applies — it depends on “Of steel” vs “Of plastics” and “Boxed” vs “Loose”.');
  });

  it('(iii) shown lines with no differing level: only "the estimate is $X either way."', () => {
    const d = lineDifferences([{ chain: chain('Other'), dutyMinor: 100 }, { chain: chain('Other'), dutyMinor: 100 }], [{ name: 'gender', value_from_listing: null }]);
    expect(d).toEqual([]);
    expect(sameDutyText(d, '$1.00', true)).toBe('The estimate is $1.00 either way.');
    expect(sameDutyText(d, '$1.00', false)).toBe('The estimate is $1.00 either way.');
  });

  it('official text: ":" and a trailing category number dropped, long text shortened as on the refusal pages; "Other" last', () => {
    const long = 'Containing compact yarns described in statistical reporting numbers 5205.42.0021, 5205.43.0021 5205.44.0021, 5205.46.0021 or 5205.47.0021 (347)';
    const d = lineDifferences([{ chain: chain('Other:'), dutyMinor: 1 }, { chain: chain(long), dutyMinor: 1 }], []);
    expect(d[0]!.options[0]).toBe(trimOfficial(long.replace(/ (d+)$/, '')));
    expect(d[0]!.options[1]).toBe('Other');
  });

  it('a model name is used only when each of its content words is in the official text of the difference; never a paraphrase', () => {
    const lines = [{ chain: chain('Of cotton'), dutyMinor: 1 }, { chain: chain('Of synthetic fibers'), dutyMinor: 2 }];
    expect(lineDifferences(lines, [{ name: 'Fiber content', value_from_listing: null }])[0]!.name).toBe('Fiber content');
    expect(lineDifferences(lines, [{ name: 'recreational performance outerwear', value_from_listing: null }])[0]!.name).toBeNull();
    // a value from the listing doesn't remove a difference the shown lines still have
    expect(lineDifferences(lines, [{ name: 'Fiber content', value_from_listing: 'cotton' }])).toHaveLength(1);
  });

  it('same duty: one short sentence naming the differences', () => {
    const lines = [{ chain: chain('Blue denim (347)'), dutyMinor: 3320 }, { chain: chain('Other (347)'), dutyMinor: 3320 }];
    const d = lineDifferences(lines, [{ name: 'denim color (blue denim vs other)', value_from_listing: null }]);
    expect(sameDutyText(d, '$33.20', true)).toBe('Not certain which line applies — it depends on denim color (“Blue denim” vs “Other”) — but the estimate is $33.20 either way.');
    expect(sameDutyText(d, '$33.20', false)).toBe('The exact line depends on denim color (“Blue denim” vs “Other”), but the estimate is $33.20 either way.');
  });
});

describe('house style: estimate text cites note and heading numbers only', () => {
  it('no generated estimate text names a program (Section 232, 301, IEEPA)', () => {
    const texts: string[] = [NOT_INCLUDED, ...Object.values(DISCLOSURE_TEXT)];
    const reasons: CantReason[] = ['SPECIAL_PROVISION', 'ORIGIN_UNSUPPORTED', 'BLOCKED_BY_GATE', 'UNKNOWN_CODE', 'NO_RATE', 'UNPARSEABLE', 'NEEDS_MEASURES', 'NEEDS_SPLIT', 'UNMODELED_REGIME', 'PARTIAL_LIST', 'NEEDS_FACTS'];
    const refSets = [[], ['note III 16(c)(vii)'], ['heading 9903.82.03', 'note III 16(c)(vii)'], ['footnote 9903.41.10', 'heading 9903.41.10']];
    for (const r of reasons) for (const refs of refSets) texts.push(cantText(r, 'x needs kg', refs, [H03, H06, H09, H4110]));
    for (const b of ['8.7% of customs value', 'Free', 'combined cap 12.5% (base or AVE below cap)', 'base ≥ 12.5% cap — no add-on', '+25% of full customs value', 'exempt — no add-on'])
      for (const o of ['JP', 'DE']) texts.push(plainBasis({ label: 'x', chapter99: '9903.82.09', basis: b }, o), plainBasis({ label: 'General rate', basis: b }, o));
    texts.push(reasonText(['LOW_CONFIDENCE'], [])!, sameDutyText([], '$1.00', true), rangeReasonText(lineDifferences([{ chain: chain('Of steel'), dutyMinor: 1 }, { chain: chain('Of plastics'), dutyMinor: 2 }], []), true)!);
    for (const s of texts) expect(s, s).not.toMatch(/Section 232|\b301\b|IEEPA/i);
  });
});

describe('exclusionText', () => {
  it('names the subdivisions and headings, says it is not applied and can only lower the duty; no program names', () => {
    expect(exclusionText([])).toBeNull();
    expect(exclusionText([{ ref: 'note III 20(vvv)(iii)(1)', heading: '9903.88.69' }])).toBe(
      'An exclusion in effect under U.S. note 20(vvv)(iii)(1) to subchapter III (heading 9903.88.69) covers particular products under this line; it isn’t applied here and can only lower the duty.',
    );
    const two = exclusionText([{ ref: 'note III 20(vvv)(ii)(1)', heading: '9903.88.69' }, { ref: 'note III 20(www)(3)', heading: '9903.88.70' }])!;
    expect(two).toMatch(/^Exclusions in effect under U\.S\. note 20\(vvv\)\(ii\)\(1\) to subchapter III and U\.S\. note 20\(www\)\(3\) to subchapter III \(headings 9903\.88\.69 and 9903\.88\.70\) cover .* they aren’t applied/);
    expect(`${two} ${DISCLOSURE_TEXT.EXCLUSION_MAY_APPLY}`).not.toMatch(/Section 301|\b301\b|List \d|USTR/i);
  });
});

describe('exclusionText — an exclusion states its own end date', () => {
  it('"… (heading 9903.88.69, through November 9, 2026) …"', () => {
    expect(exclusionText([{ ref: 'note III 20(vvv)(iii)(1)', heading: '9903.88.69', until: 'through November 9, 2026' }])).toBe(
      'An exclusion in effect under U.S. note 20(vvv)(iii)(1) to subchapter III (heading 9903.88.69, through November 9, 2026) covers particular products under this line; it isn’t applied here and can only lower the duty.',
    );
  });
});
