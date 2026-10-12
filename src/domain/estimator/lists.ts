// Membership of an HTS line in a Chapter 99 note subdivision's code list (the subdivision and its children). Pure.
import type { Ch99Notes } from './ch99Notes';

const digits = (c: string) => c.replace(/\./g, '');

/**
 * all: the line is under a listed code ("0712.90.8550" under "0712.90.85"); partial: only some statistical numbers under
 * the line are listed (an 8-digit line, 10-digit items); none.
 */
export function listMembership(code: string, listRef: string, data: { notes: Pick<Ch99Notes, 'subdivisions'> }): { kind: 'all' | 'partial' | 'none'; item?: string } {
  const [, section, path] = /^note (\S+) (.+)$/.exec(listRef)!;
  const d = digits(code);
  let partial: string | undefined;
  for (const s of data.notes.subdivisions) {
    if (s.section !== section || !(s.path === path || s.path.startsWith(`${path}(`))) continue;
    for (const t of [...s.codes10, ...s.codes8, ...s.codes6, ...s.headings4].map(digits)) {
      if (t.startsWith('99')) continue;
      if (d.startsWith(t)) return { kind: 'all', item: `note ${s.section} ${s.path}` };
      if (t.startsWith(d)) partial ??= `note ${s.section} ${s.path}`;
    }
  }
  return partial ? { kind: 'partial', item: partial } : { kind: 'none' };
}
