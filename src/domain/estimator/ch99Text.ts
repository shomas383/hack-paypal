// Chapter 99 PDF text (`pdftotext -enc UTF-8 -layout`, xpdf 4.06) → body lines without page furniture. Estimator only. Pure.
// Each page (pdftotext ends every page with a form feed) carries, as whole lines: the title "Harmonized Tariff Schedule of
// the United States Revision N (YYYY)" (sometimes with the section "XXII" on the same line) as its first non-blank line,
// "Annotated for Statistical Reporting Purposes", the section "XXII", on most pages the page number ("99 - III - 395";
// "99-III-1" on a subchapter's opening page, after its title; none on tariff-table pages), and on continuation pages of
// notes "U.S. Notes (con.)", which body text can follow on the same line (kept). Only those whole lines are removed.
// Fail closed (Ch99LayoutError): a page not opening with the title, without "Annotated …", with two page numbers, or a
// second revision in the file. Nothing else is altered.

export interface PdfLine {
  /** Page number as printed ("99 - III - 395"), or "pdf page N" for a page without one. */
  page: string;
  text: string;
}

export interface StrippedText {
  /** "Revision 21 (2026)", from the page titles (all pages agree). */
  revision: string;
  /** Page labels, in order. */
  pages: string[];
  lines: PdfLine[];
}

export class Ch99LayoutError extends Error {}

const TITLE = /^Harmonized Tariff Schedule of the United States (Revision \d+ \(\d{4}\))(?:\s+[IVXL]+)?$/;
const ANNOTATED = /^Annotated for Statistical Reporting Purposes$/;
const SECTION = /^[IVXL]+$/;
const PAGE_NO = /^\d{2} ?- ?[IVXL]+ ?- ?\d+$/;
const CONTINUED = /^U\.S\. Notes \(con\.\)(?:\s+|$)/;

export function stripPageFurniture(raw: string): StrippedText {
  const chunks = raw.replace(/\r\n?/g, '\n').split('\f');
  let revision: string | undefined;
  const pages: string[] = [];
  const lines: PdfLine[] = [];
  let ordinal = 0;
  for (const chunk of chunks) {
    if (chunk.trim() === '') continue;
    ordinal++;
    const rows = chunk.split('\n');
    const first = rows.findIndex((r) => r.trim() !== '');
    const title = TITLE.exec(rows[first]!.trim());
    if (!title) throw new Ch99LayoutError(`pdf page ${ordinal}: does not open with the HTS title ("${rows[first]!.trim().slice(0, 80)}")`);
    if (revision === undefined) revision = title[1]!;
    else if (title[1] !== revision) throw new Ch99LayoutError(`pdf page ${ordinal}: ${title[1]} in a ${revision} file`);
    let annotated = 0;
    let pageNo: string | undefined;
    const body: string[] = [];
    for (const [i, row] of rows.entries()) {
      const t = row.trim();
      if (i === first) continue;
      if (TITLE.test(t)) throw new Ch99LayoutError(`pdf page ${ordinal}: a second title line (merged pages?)`);
      if (ANNOTATED.test(t)) annotated++;
      else if (PAGE_NO.test(t)) {
        if (pageNo !== undefined) throw new Ch99LayoutError(`pdf page ${ordinal}: two page numbers (${pageNo}, ${t})`);
        pageNo = t;
      } else if (SECTION.test(t)) continue;
      else if (CONTINUED.test(t)) {
        const rest = row.replace(/^\s*U\.S\. Notes \(con\.\)/, '');
        if (rest.trim() !== '') body.push(rest);
      } else body.push(row);
    }
    if (annotated !== 1) throw new Ch99LayoutError(`pdf page ${ordinal}: expected one "Annotated for Statistical Reporting Purposes" line, found ${annotated}`);
    const label = pageNo ?? `pdf page ${ordinal}`;
    pages.push(label);
    for (const text of body) lines.push({ page: label, text });
  }
  if (revision === undefined) throw new Ch99LayoutError('no pages');
  return { revision, pages, lines };
}

/** Whitespace runs (incl. line breaks) → one space, trimmed. Nothing else changes (quotes, dashes, hyphens stay). */
export function normaliseText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
