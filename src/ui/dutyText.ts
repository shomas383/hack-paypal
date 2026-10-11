// Display text for stored duty lines and policy reasons (checkout and /agent). Text only: amounts never pass through here.

/** "MFN · 9102.21.70 · $1.53 each + …" or "9903.05.39 · combined cap 10%". */
export function dutyLineLabel(line: { chapter99?: string | null | undefined; basis: string }, hts10: string): string {
  if (!line.chapter99) return `MFN · ${hts10} · ${line.basis}`;
  const short = line.basis
    .replace(/\s*\((?:base or AVE below cap)\)\s*$/, '')
    .replace(/\s+of full customs value$/, '')
    .replace(/\s+—\s+/g, ', ');
  return `${line.chapter99} · ${short}`;
}

/** The source refs of a line ("9903.05.31 — U.S. note 52; note 20(u)" → ["U.S. note 52", "note 20(u)"]). */
export function splitSources(sourceRef: string): string[] {
  const refs = sourceRef.includes(' — ') ? sourceRef.slice(sourceRef.indexOf(' — ') + 3) : sourceRef;
  return refs.split(';').map((s) => s.trim()).filter(Boolean);
}

/**
 * The base HTS line's official description chain (HTS 2026 Rev. 20 export), every level verbatim — never abbreviated or
 * paraphrased — with the trailing ":" of each level removed, joined with " › ". Null when there is no chain.
 */
export function officialChain(levels: readonly string[] | undefined): string | null {
  const parts = (levels ?? []).map((l) => l.trim().replace(/:$/, '')).filter(Boolean);
  return parts.length ? parts.join(' › ') : null;
}

/** Same, from the agent tool's official_text (levels joined with " > "). */
export function officialChainFromText(text: string | null | undefined): string | null {
  return text ? officialChain(text.split(' > ')) : null;
}

const POLICY: Record<string, string> = {
  NO_APPROVAL: 'there was no recorded approval',
  APPROVAL_MISMATCH: 'the approved amount did not match the order',
  AUTH_NOT_CREATED: 'PayPal did not create the authorization',
  AUTH_AMOUNT_MISMATCH: 'the authorized amount did not match the quote',
  OVER_ORDER_CAP: 'the order was over the per-order spend cap',
  OVER_SESSION_CAP: 'the order would exceed the session spend cap',
  RATE_VERSION_STALE: 'the duty rates changed after the quote',
  QUOTE_EXPIRED: 'the quote expired before capture',
};

export function policyReasonText(code: string): string {
  return POLICY[code] ?? code;
}
