// Checks on the buyer agent's text for `pnpm agent:live`. Hard failures (anywhere in the agent text): a checkout path or
// URL (the proposal card has the button), quoted official HTS / Chapter 99 wording (the breakdown shows it). The final
// message's length (the text after the last tool call; the prompt asks for 2–4 sentences) is only a warning.

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

export function agentTextFailures(text: string): string[] {
  const out: string[] = [];
  if (/\/checkout\//.test(text)) out.push('contains a checkout path');
  if (/https?:\/\//.test(text)) out.push('contains a URL');
  // Official HTS / Chapter 99 wording quoted back ("articles the product of …", "Wrist watches, pocket watches …").
  if (/["“][^"”]{0,40}(articles the product of|as provided for in U\.S\. note|Wrist watches, pocket watches|Having over \d+ jewels)/i.test(text)) out.push('quotes official text');
  return out;
}

export function finalMessageWarnings(final: string): string[] {
  const n = sentenceCount(final);
  if (n === 0) return ['no final message'];
  return n > 4 ? [`${n} sentences (more than 4)`] : [];
}
