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

/** Spans inside straight or curly double quotes. */
function quotedSpans(text: string): string[] {
  return [...text.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1]!.trim()).filter(Boolean);
}
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[:.,;]+$/, '').trim();

/**
 * Hard failures. `officialLevels`: the official HTS levels a search matched (hts_match.official_levels) — quoting any of
 * them (2+ words) fails like the fixed official phrases do; the search card shows them.
 */
export function agentTextFailures(text: string, officialLevels: readonly string[] = []): string[] {
  const out: string[] = [];
  if (/\/checkout\//.test(text)) out.push('contains a checkout path');
  if (/https?:\/\//.test(text)) out.push('contains a URL');
  // Official HTS / Chapter 99 wording quoted back ("articles the product of …", "Wrist watches, pocket watches …").
  const fixed = /["“][^"”]{0,40}(articles the product of|as provided for in U\.S\. note|Wrist watches, pocket watches|Having over \d+ jewels)/i.test(text);
  const levels = officialLevels.map(norm);
  const matchedLevel = quotedSpans(text).some((span) => words(span) >= 2 && levels.some((l) => l.includes(norm(span)) || norm(span).includes(l)));
  if (fixed || matchedLevel) out.push('quotes official text');
  return out;
}

/**
 * Warnings only (never failures): a quoted span of 3+ words that no tool result contains (e.g. an invented translation
 * presented as a quote), and a chain-only (HTS-description) listing named without saying it was matched that way.
 */
export function agentTextWarnings(text: string, ctx: { toolStrings: readonly string[]; chainOnlyIds: readonly string[] }): string[] {
  const out: string[] = [];
  for (const span of quotedSpans(text)) {
    if (words(span) >= 3 && !ctx.toolStrings.some((s) => s.includes(span))) out.push(`quoted text not in any tool result: "${span}"`);
  }
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const id of ctx.chainOnlyIds) {
    const naming = sentences.filter((s) => s.includes(id));
    if (naming.length && !naming.some((s) => /\bHTS description\b/i.test(s))) out.push(`names ${id} (an HTS-description match) without saying so: "${naming[0]}"`);
  }
  return out;
}

export function finalMessageWarnings(final: string): string[] {
  const n = sentenceCount(final);
  if (n === 0) return ['no final message'];
  return n > 4 ? [`${n} sentences (more than 4)`] : [];
}
