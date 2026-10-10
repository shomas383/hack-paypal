// The agent's final message (the text after its last tool call) and the live-run checks on it: 2–4 sentences, no URLs or
// checkout paths (the proposal card has the button), no repeated official text (the breakdown shows it).

export function finalMessage(events: readonly { type: string; text?: string | undefined }[]): string {
  const last = events.map((e) => e.type).findLastIndex((t) => t === 'tool-call' || t === 'tool-result' || t === 'tool-error');
  return events
    .slice(last + 1)
    .filter((e) => e.type === 'text')
    .map((e) => e.text ?? '')
    .join('')
    .trim();
}

/** Sentences, ignoring the dots in amounts ($344.00), "U.S." and similar abbreviations. */
export function sentenceCount(text: string): number {
  const t = text.replace(/\bU\.S\./g, 'US').replace(/\b(?:e\.g|i\.e|No|Rev|Reg|Fed)\./g, (m) => m.slice(0, -1)).trim();
  if (!t) return 0;
  return t.split(/(?<=[.!?])["”)]?\s+(?=[A-Z"“(*])/).filter((s) => s.trim()).length;
}

export function finalMessageIssues(text: string): string[] {
  const issues: string[] = [];
  if (/\/checkout\//.test(text)) issues.push('contains a checkout path');
  if (/https?:\/\//.test(text)) issues.push('contains a URL');
  // Official HTS / Chapter 99 wording quoted back ("articles the product of …", "Wrist watches, pocket watches …").
  if (/["“][^"”]{0,40}(articles the product of|as provided for in U\.S\. note|Wrist watches, pocket watches|Having over \d+ jewels)/i.test(text)) issues.push('quotes official text');
  const n = sentenceCount(text);
  if (n < 2 || n > 4) issues.push(`${n} sentence(s), expected 2–4`);
  return issues;
}
