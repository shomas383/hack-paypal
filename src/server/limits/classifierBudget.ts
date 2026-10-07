// Classifier call budget: per session and per IP (rolling hour) and a daily ceiling (UTC day), checked BEFORE any LLM
// call. Pure decision here; counting and recording live in classifierCalls.ts.
export interface ClassifierCounts {
  sessionLastHour: number;
  ipLastHour: number;
  today: number;
}

export interface ClassifierLimits {
  perSessionPerHour: number;
  perIpPerHour: number;
  dailyCeiling: number;
}

export type BudgetDecision = { ok: true } | { ok: false; refused: 'DAILY' | 'SESSION' | 'IP' };

export function checkClassifierBudget(c: ClassifierCounts, l: ClassifierLimits): BudgetDecision {
  if (c.today >= l.dailyCeiling) return { ok: false, refused: 'DAILY' };
  if (c.sessionLastHour >= l.perSessionPerHour) return { ok: false, refused: 'SESSION' };
  if (c.ipLastHour >= l.perIpPerHour) return { ok: false, refused: 'IP' };
  return { ok: true };
}
