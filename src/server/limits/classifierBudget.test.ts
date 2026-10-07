import { describe, expect, it } from 'vitest';
import { checkClassifierBudget } from './classifierBudget';

const limits = { perSessionPerHour: 10, perIpPerHour: 20, dailyCeiling: 200 };
const counts = (over: Partial<{ sessionLastHour: number; ipLastHour: number; today: number }> = {}) => ({ sessionLastHour: 0, ipLastHour: 0, today: 0, ...over });

describe('checkClassifierBudget (counts are calls already made; checked BEFORE any LLM call)', () => {
  it('ok when every count is under its limit', () => {
    expect(checkClassifierBudget(counts({ sessionLastHour: 9, ipLastHour: 19, today: 199 }), limits)).toEqual({ ok: true });
  });

  it('exactly at a limit is refused', () => {
    expect(checkClassifierBudget(counts({ sessionLastHour: 10 }), limits)).toEqual({ ok: false, refused: 'SESSION' });
    expect(checkClassifierBudget(counts({ ipLastHour: 20 }), limits)).toEqual({ ok: false, refused: 'IP' });
    expect(checkClassifierBudget(counts({ today: 200 }), limits)).toEqual({ ok: false, refused: 'DAILY' });
  });

  it('the daily ceiling wins when several limits are hit', () => {
    expect(checkClassifierBudget(counts({ sessionLastHour: 50, ipLastHour: 50, today: 500 }), limits)).toEqual({ ok: false, refused: 'DAILY' });
  });
});
