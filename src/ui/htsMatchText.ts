// Display text for an HTS-description search match (/agent). Official Rev 20 text only: levels are shown verbatim (the
// trailing ":" removed, long levels cut at a word with "…"); the full chain is one disclosure away. Never a translation.
import { singular } from '@/domain/agent/search';

/** One official level, verbatim, cut at the last whole word within `max` characters. */
export function shortLevel(level: string, max = 60): string {
  const t = level.trim().replace(/:$/, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const i = cut.lastIndexOf(' ');
  return `${(i > 0 ? cut.slice(0, i) : t.slice(0, max)).replace(/[\s,;:]+$/, '')}…`;
}

/** Text split into segments, with the words whose search token is a matched term marked (watches → watch). */
export function markTerms(text: string, terms: readonly string[]): { text: string; mark: boolean }[] {
  const set = new Set(terms);
  const out: { text: string; mark: boolean }[] = [];
  const push = (s: string, mark: boolean) => {
    if (!s) return;
    const last = out.at(-1);
    if (last && last.mark === mark && !mark) last.text += s;
    else out.push({ text: s, mark });
  };
  let at = 0;
  for (const m of text.matchAll(/[A-Za-z0-9]+/g)) {
    const hit = set.has(singular(m[0].toLowerCase()));
    if (!hit) continue;
    push(text.slice(at, m.index), false);
    push(m[0], true);
    at = m.index + m[0].length;
  }
  push(text.slice(at), false);
  return out;
}
