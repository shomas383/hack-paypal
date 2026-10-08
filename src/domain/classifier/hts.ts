// Grounding against the official Rev 20 HTS index (pure). A code is valid only if it is a real Rev 20 line: a 10-digit
// statistical line, or an 8-digit Chapter 91 component-reporting line (Statistical Note 1). Nothing else, and no
// "…00" is ever assumed.
import { chainsOf, type HtsIndex } from '../hts/buildIndex';

export interface HtsLookup {
  /** Codes in HTS order. */
  ordered: { code: string; digits: string; componentReporting: boolean }[];
  byCode: Map<string, { componentReporting: boolean }>;
  chains: Map<string, string[]>;
}

export interface HtsLine {
  code: string;
  componentReporting: boolean;
  chain: string[];
}

export function lookupOf(index: HtsIndex): HtsLookup {
  const ordered = index.codes.map((c) => ({ code: c.c, digits: c.c.replace(/\D/g, ''), componentReporting: c.componentReporting === true }));
  return { ordered, byCode: new Map(ordered.map((o) => [o.code, { componentReporting: o.componentReporting }])), chains: chainsOf(index) };
}

export type Validation = ({ ok: true } & HtsLine) | { ok: false; reason: 'INVALID_CODE' };

export function validateHts10(code: string, idx: HtsLookup): Validation {
  const hit = /^\d{4}\.\d{2}\.\d{2}(\d{2})?$/.test(code) ? idx.byCode.get(code) : undefined;
  if (!hit) return { ok: false, reason: 'INVALID_CODE' };
  // An 8-digit code is only valid when it is a component-reporting line (enforced by the index, re-checked here).
  if (code.length === 10 && !hit.componentReporting) return { ok: false, reason: 'INVALID_CODE' };
  return { ok: true, code, componentReporting: hit.componentReporting, chain: idx.chains.get(code) ?? [] };
}

/** A 6- or 8-digit heading (dotted or not) → its real Rev 20 lines with description chains, in HTS order. */
export function expandHeading(heading: string, idx: HtsLookup): HtsLine[] {
  const h = heading.trim();
  if (!/^(\d{4}\.?\d{2}|\d{4}\.?\d{2}\.?\d{2})$/.test(h)) return [];
  const prefix = h.replace(/\D/g, '');
  return idx.ordered
    .filter((o) => o.digits.startsWith(prefix))
    .map((o) => ({ code: o.code, componentReporting: o.componentReporting, chain: idx.chains.get(o.code) ?? [] }));
}
