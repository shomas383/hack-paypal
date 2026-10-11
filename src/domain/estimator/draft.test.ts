import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { draftContext, draftPrompt, draftRules } from './draft';
import { compareToReference, factNameDiff, type Rule } from './rules';
import { REFERENCE_RULES, ruleById, sampleData, sampleGate } from './__fixtures__/sample';

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } };
const reply = (texts: string[]) => {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: texts[Math.min(i++, texts.length - 1)]! }], finishReason: { unified: 'stop', raw: 'end_turn' }, usage, warnings: [] }),
  });
};
const body = (r: Rule) => {
  const { id, drafted_from_sha256, drafted_by, ...rest } = r;
  void id;
  void drafted_from_sha256;
  void drafted_by;
  return JSON.stringify(rest);
};
const data = sampleData();

describe('draftContext / draftPrompt — official text only', () => {
  it('a heading, its neighbours, the note 52 subdivision that defines it, 52(a) and 52(k)', () => {
    expect(draftContext('9903.05.86', data).sources).toEqual(['heading 9903.05.85', 'heading 9903.05.86', 'heading 9903.05.87', 'note III 52(b)', 'note III 52(a)', 'note III 52(k)']);
    expect(draftContext('9903.05.49', data).sources).toEqual(['heading 9903.05.48', 'heading 9903.05.49', 'heading 9903.05.85', 'note III 52(a)', 'note III 52(k)']);
  });
  it('the prompt carries the texts and General columns, elides code lists, and never the reference rules', () => {
    const p = draftPrompt(draftContext('9903.05.86', data), data);
    expect(p).toContain('### heading 9903.05.86\n[General column: The duty provided in the applicable subheading]');
    expect(p).toMatch(/\[\d+ HTSUS provisions listed\]/);
    expect(p).not.toMatch(/0712\.90\.8550/);
    expect(p).not.toMatch(/reference|drafted_by|exempt-9903|125000/);
  });
});

describe('draftRules (model injected)', () => {
  it('code fills the id, the source sha256s and drafted_by; a faithful draft passes the gate with GR', async () => {
    const ref = ruleById('exempt-9903-05-86');
    const r = await draftRules([{ id: ref.id, heading: ref.heading }], data, reply([body(ref)]), { budget: 15, draftedBy: 'test' });
    expect(r.calls).toBe(1);
    expect(r.usage).toEqual({ input: 100, output: 20 });
    expect(r.rules[0]).toEqual({ ...ref, drafted_by: 'test' });
    const { report } = sampleGate(REFERENCE_RULES.rules.map((x) => (x.id === ref.id ? r.rules[0]! : x)), { reference: REFERENCE_RULES.rules });
    expect(report.blockedRules).toEqual([]);
    expect(report.checks.filter((c) => c.id === 'GR').every((c) => c.pass)).toBe(true);
  });

  it('a draft that differs from the reference (a 15% JP cap) is blocked by GR (and G3), and reported', async () => {
    const ref = ruleById('jp-cap-9903-05-49');
    const r = await draftRules([{ id: ref.id, heading: ref.heading }], data, reply([body({ ...ref, rate_ppm: 150000 })]), { budget: 15, draftedBy: 'test' });
    const { report } = sampleGate(REFERENCE_RULES.rules.map((x) => (x.id === ref.id ? r.rules[0]! : x)), { reference: REFERENCE_RULES.rules });
    const reasons = report.blockedRules.find((b) => b.id === ref.id)!.reasons.join(' ');
    expect(reasons).toMatch(/GR: rate_ppm: drafted 150000 ≠ reference 125000/);
    expect(reasons).toMatch(/G3/);
  });

  it('an invalid answer is retried once; the call budget includes retries', async () => {
    const r = await draftRules([{ id: 'a', heading: '9903.05.86' }, { id: 'b', heading: '9903.05.87' }], data, reply(['not json']), { budget: 3, draftedBy: 'test' });
    expect(r.calls).toBe(3);
    expect(r.rules).toEqual([]);
    expect(r.failed.map((f) => f.heading)).toEqual(['9903.05.86', '9903.05.87']);
  });
});

describe('compareToReference', () => {
  it('compares origins, kind, numbers, scope and whether there is a condition; fact names are reported apart', () => {
    const ref = ruleById('cond-9903-05-88');
    expect(compareToReference({ ...ref, condition: { fact: 'is_civil_aircraft' } }, ref)).toEqual([]);
    expect(factNameDiff({ ...ref, condition: { fact: 'is_civil_aircraft' } }, ref)).toBe('9903.05.88: fact "is_civil_aircraft" (reference "civil_aircraft")');
    expect(compareToReference({ ...ref, origins: ['JP'], scope: { list: 'note III 52(e)' } }, ref)).toEqual([
      'origins: drafted ["JP"] ≠ reference ["EU","JP"]',
      'scope: drafted {"list":"note III 52(e)"} ≠ reference {"list":"note III 52(d)"}',
    ]);
  });
});
