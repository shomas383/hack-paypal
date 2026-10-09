// Statements about seller instructions come ONLY from code (the search flags), never from the model. Run 3 showed the
// model claiming "None of these listings contained any instructions" while the search had flagged L-T-INJ.

/** The /agent notice, generated from search_listings' seller_text_contains_instructions flags (null when none). */
export function instructionNotice(results: { seller_text_contains_instructions?: boolean }[]): string | null {
  const n = results.filter((r) => r.seller_text_contains_instructions === true).length;
  return n > 0 ? `${n} listing(s) contained seller instructions; withheld.` : null;
}

/** Sentences in the agent's text that make any claim about seller/listing instructions (must be empty). */
export function sellerInstructionClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /\binstruct(ion|ions|ed)?\b/i.test(s) && /\b(seller|sellers|listing|listings|description|seller text)\b/i.test(s));
}
