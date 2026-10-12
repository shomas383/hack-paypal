// The facts a verified rate row's conditions turn on (P11: steel_weight_share_ge_15pct, steel_us_melted_poured_ge_85pct),
// asked from the official note text. Each fact is found in its sentence of U.S. note 16 to subchapter III (Rev 21); the
// threshold is parsed from that sentence and must equal the one in the verified sheet's fact name, and the sentence must
// cover the line (its list title names the metal; its list of subdivisions includes the line's) — otherwise the fact
// isn't asked (null) and the line falls back to the refusal. Text only: no amount is computed here.
import type { Ch99Notes } from './ch99Notes';
import { subdivisionListCovers } from './coverage';

export interface FactSource {
  fact: string;
  /** Percent, read from the official sentence (= the fact name's). */
  threshold: number;
  /** The question, worded from the official sentence. */
  question: string;
  /** The official text the question rests on, trimmed ("…" marks the cut), with where it is. */
  quotes: { ref: string; text: string }[];
}

const NAME = /^(steel|aluminum|copper)_(weight_share|us_melted_poured)_ge_(\d+)pct$/;
// 16(c): "… only apply where the weight of the applicable metal is at least 15 percent of the weight of the imported article."
const WEIGHT = /For articles classified in the listed provisions that are not in chapters ([\d, or]+?) of the HTSUS, .*?(only apply where the weight of the applicable metal is at least (\d+) percent of the weight of the imported article\.)/;
// 16(e): "For derivative articles provided for in subdivisions (c)(iv), (vii), (x) and (xi), at least 85 percent of the steel
// content of the article must be composed of steel that was melted and poured in the United States."
const MELTED = /For derivative articles provided for in subdivisions ([^.]*?), (at least (\d+) percent of the steel content of the article must be composed of steel that was melted and poured in the United States\.)/;

const sub = (notes: Ch99Notes, path: string) => notes.subdivisions.find((s) => s.section === 'III' && s.path === path);

/** `line.lineRefs`: the note refs that name the line ("note III 16(c)(vii)"), from the estimator's coverage. */
export function factSource(fact: string, notes: Ch99Notes, line: { code: string; lineRefs: string[] }): FactSource | null {
  const name = NAME.exec(fact);
  if (!name) return null;
  const [, metal, kind, pct] = name;
  const list = line.lineRefs.map((r) => /^note III 16(\(c\)\([ivxl]+\))$/.exec(r)?.[1]).find(Boolean);
  if (!list) return null;

  if (kind === 'weight_share') {
    const m = WEIGHT.exec(sub(notes, '16(c)')?.text ?? '');
    if (!m || m[3] !== pct) return null;
    // Chapters 72, 73, 74 and 76 are outside the weight condition.
    const chapters = m[1]!.split(/,\s*|\s+or\s+/).map((c) => c.trim());
    if (chapters.includes(line.code.slice(0, 2))) return null;
    // "The applicable metal is identified in the title of each of the lists": the line's list title must name it.
    const title = sub(notes, `16${list}`)?.text.split(':')[0]?.trim() ?? '';
    if (!new RegExp(`\\b${metal}\\b`, 'i').test(title)) return null;
    return {
      fact,
      threshold: Number(pct),
      question: `Does the ${metal} in it weigh at least ${pct} percent of the whole article’s weight?`,
      quotes: [
        { ref: 'note III 16(c)', text: `…${m[2]}` },
        { ref: `note III 16${list}`, text: title },
      ],
    };
  }
  // melted and poured: steel only (aluminum and copper have their own "smelted and cast" sentences, not asked).
  if (metal !== 'steel') return null;
  const m = MELTED.exec(sub(notes, '16(e)')?.text ?? '');
  if (!m || m[3] !== pct || !subdivisionListCovers(m[1]!, list)) return null;
  return {
    fact,
    threshold: Number(pct),
    question: `Was at least ${pct} percent of the steel in it melted and poured in the United States?`,
    quotes: [{ ref: 'note III 16(e)', text: `…${m[2]}` }],
  };
}
