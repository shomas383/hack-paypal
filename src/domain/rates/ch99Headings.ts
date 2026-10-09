// Chapter 99 headings on a verified sheet row (pure; used by scripts/import-verify-sheet.ts).
// Column O may list several headings joined by " + " (e.g. CN 9102.21.70: "9903.05.31 + 9903.88.15", cumulative per
// note 52(a)). Every heading must exist in the official HTS Ch. 99 lookup and must not be marked suspended there.
const HEADING = /^99\d{2}\.\d{2}\.\d{2}$/;
const SUSPENDED = /\[Compiler['’]s note: provision suspended\.?\]/i;

export function parseCh99Headings(o: string): string[] {
  const parts = o.split('+').map((s) => s.trim());
  if (parts.length === 0 || parts.some((p) => !HEADING.test(p))) throw new Error(`column O must be Chapter 99 headings joined by " + ", got "${o}"`);
  if (new Set(parts).size !== parts.length) throw new Error(`column O repeats a heading: "${o}"`);
  return parts;
}

export function checkCh99Headings(headings: string[], lookup: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const h of headings) {
    const text = lookup[h];
    if (text === undefined) errors.push(`${h} is not in the HTS Ch. 99 lookup`);
    else if (SUSPENDED.test(text)) errors.push(`${h} is marked suspended in the HTS ("[Compiler's note: provision suspended.]")`);
  }
  return errors;
}
