// Countries of origin the estimator supports, and whether a Chapter 99 heading can apply to one. Pure.
// EU: only DE for now — the one member state with a verified row (P14). VERIFY: the full member list and its source are
// resolved at the disclosure step (decision 2026-10-11); until then every other member state is "origin not supported yet".
// CN: China. Hong Kong is its own origin in the HTS text ("articles the product of Hong Kong, China", 9903.05.43) and is not
// supported.
import type { HeadingInfo } from './headings';

export type OriginGroup = 'JP' | 'EU' | 'CN';

export interface Origin {
  /** ISO 3166 alpha-2. */
  iso: string;
  group: OriginGroup;
  /** How official heading text names this origin (regular-expression sources, matched on word boundaries). */
  names: string[];
}

const ORIGINS: Record<string, Origin> = {
  JP: { iso: 'JP', group: 'JP', names: ['Japan'] },
  DE: { iso: 'DE', group: 'EU', names: ['Germany', 'European Union'] },
  CN: { iso: 'CN', group: 'CN', names: ['(?<!Hong Kong, |Macau, )China'] },
};

export const SUPPORTED_ORIGINS = Object.keys(ORIGINS);

export function originOf(iso: string): Origin | null {
  return ORIGINS[iso] ?? null;
}

const PRODUCT_OF = /\bproducts? of\b/i;
const ANY_COUNTRY = /\bproducts? of any country\b/i;
/** Civil-aircraft headings name their country without "product of": "… their parts and components of Japan, excluding …". */
const CIVIL_AIRCRAFT_OF = /\bcivil aircraft\b.*?\bcomponents of (?:the )?([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)*)/;

/**
 * Whether a heading can apply to goods of this origin, from its official text (with parent rows): it names no country
 * ("product(s) of …", or a civil-aircraft heading's "components of <country>"), says "any country", or names the origin
 * anywhere. Only a heading that names countries and never this one is "not for this origin" — an exception clause naming
 * the origin still counts as naming it (fails closed).
 */
export function headingAppliesTo(h: HeadingInfo, o: Origin): boolean {
  const names = (text: string) => o.names.some((n) => new RegExp(`\\b${n}\\b`).test(text));
  if (!PRODUCT_OF.test(h.chain)) return CIVIL_AIRCRAFT_OF.test(h.chain) ? names(h.chain) : true;
  if (ANY_COUNTRY.test(h.chain)) return true;
  return names(h.chain);
}
