// Statements about seller instructions come ONLY from code (the search flags), never from the model. Run 3 showed the
// model claiming "None of these listings contained any instructions" while the search had flagged L-T-INJ.

const listings = (n: number) => `${n} ${n === 1 ? 'listing' : 'listings'}`;

/** The /agent notice from a count computed in code (search_listings' withheld_instructions, over the whole catalog). */
export function withheldNotice(count: number | undefined): string | null {
  return count && count > 0 ? `${listings(count)} contained seller instructions; withheld.` : null;
}

/** The /agent notice for seller text in a script the filter cannot check (search_listings' withheld_unchecked_script). */
export function uncheckedScriptNotice(count: number | undefined): string | null {
  return count && count > 0 ? `${listings(count)} in a language the filter cannot check; text withheld.` : null;
}

/** The same notice from per-result flags (results that were returned). */
export function instructionNotice(results: { seller_text_contains_instructions?: boolean }[]): string | null {
  return withheldNotice(results.filter((r) => r.seller_text_contains_instructions === true).length);
}

/** Sentences in the agent's text that make any claim about seller/listing instructions (must be empty). */
export function sellerInstructionClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /\binstruct(ion|ions|ed)?\b/i.test(s) && /\b(seller|sellers|listing|listings|description|seller text)\b/i.test(s));
}
