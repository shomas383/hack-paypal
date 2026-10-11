// Chapter 99 PDF text (`pdftotext -enc UTF-8 -layout`, xpdf 4.06) → body lines without page furniture. Estimator only. Pure.
// Every page opens with a head block, in any order: the title "Harmonized Tariff Schedule of the United States Revision N
// (YYYY)" (sometimes with the section "XXII" on the same line), "Annotated for Statistical Reporting Purposes", the section
// "XXII", the page number "99 - III - 395", and on continuation pages "U.S. Notes (con.)" — body text can follow on that
// same line and is kept. Furniture is removed only from the page head; a title or page number anywhere else, a page
// without both, or two revisions in one file is a layout change and throws (fail closed). Nothing else is altered.

export interface PdfLine {
  /** Page number as printed ("99 - III - 395"). */
  page: string;
  text: string;
}

export interface StrippedText {
  /** "Revision 21 (2026)", from the page titles (all pages agree). */
  revision: string;
  /** Printed page numbers, in order. */
  pages: string[];
  lines: PdfLine[];
}

export class Ch99LayoutError extends Error {}

export function stripPageFurniture(raw: string): StrippedText {
  void raw;
  throw new Error('not implemented');
}

/** Whitespace runs (incl. line breaks) → one space, trimmed. Nothing else changes (quotes, dashes, hyphens stay). */
export function normaliseText(s: string): string {
  void s;
  throw new Error('not implemented');
}
