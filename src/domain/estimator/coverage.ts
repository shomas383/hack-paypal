// Coverage (gate G7): every Chapter 99 regime that names a line is handled for the origin, or the line can't be estimated.
// Pure. A mention ref ("note III 16(c)(vii)", "heading 9903.41.05") gets one verdict per origin:
// - special_program: the note is in a trade-agreement subchapter (VIII, XV–XXII) or temporary reductions (II): those only
//   lower duty for qualifying goods; the estimate uses the General rate and says so (one disclosure);
// - modeled: a rule handles it (its list, or a quoted source);
// - out_of_force / not_for_origin: every heading that governs it is out of force (headings.ts) or names other countries;
// - unmodeled: some governing heading is in force, can apply to this origin and has no rule → the line is refused.
// Governing headings of a note subdivision: its own (or nearest ancestor's) "As provided in heading(s) …"; otherwise every
// Ch. 99 heading named anywhere in the note plus every heading whose text cites the note ("U.S. note 16 …").
// Origin-level gaps: an in-force heading that can apply to the origin, has no rule and governs no line-specific mention
// can't be placed on any line — it blocks the whole origin.
import { codeTokens, type Ch99Notes, type Subdivision } from './ch99Notes';
import { headingsInRange, type HeadingTable, type OutOfForce } from './headings';
import { mentionsOf, type MentionsIndex } from './mentions';
import { headingAppliesTo, type Origin, type OriginGroup } from './origin';
import type { Rule } from './rules';

export type Verdict = 'special_program' | 'modeled' | 'out_of_force' | 'not_for_origin' | 'unmodeled';

export interface RefVerdict {
  ref: string;
  verdict: Verdict;
  /** Governing headings that are in force, can apply and have no rule (unmodeled only). */
  open: string[];
}

export interface CoverageContext {
  headings: HeadingTable;
  outOfForce: Record<string, OutOfForce>;
  notes: Ch99Notes;
  mentions: MentionsIndex;
  /** Rules accepted by the gate. */
  rules: Rule[];
}

const SPECIAL_PROGRAM_TITLE = (title: string) => /\bAGREEMENT\b/.test(title) && !/\bSAFEGUARD\b/.test(title);
const REDUCTION_TITLE = /\bTEMPORARY REDUCTIONS\b/;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII'];
/** 9903.xx.xx → "III": Chapter 99 headings are numbered by subchapter. */
export const subchapterOf = (heading: string) => ROMAN[Number(heading.slice(2, 4))] ?? '?';
const ADDS_NOTHING = /^(No change|The duty provided in the applicable subheading|Free)$/;
const CITES_NOTE =/(?<!general )\bU\.S\. notes? (\d+)/g;

export function isSpecialProgramSection(notes: Ch99Notes, section: string): boolean {
  const title = notes.subchapterTitles[section.replace(/-stat$/, '')] ?? '';
  return SPECIAL_PROGRAM_TITLE(title) || REDUCTION_TITLE.test(title);
}

/** Lookups built once per context. */
export function coverageIndex(ctx: CoverageContext) {
  const bySectionPath = new Map<string, Subdivision>();
  const byNote = new Map<string, Subdivision[]>();
  for (const s of ctx.notes.subdivisions) {
    bySectionPath.set(`${s.section} ${s.path}`, s);
    const k = `${s.section} ${s.note}`;
    byNote.set(k, [...(byNote.get(k) ?? []), s]);
  }
  const citing = new Map<string, Set<string>>();
  for (const [h, info] of Object.entries(ctx.headings)) {
    for (const m of info.chain.matchAll(CITES_NOTE)) {
      const k = `${subchapterOf(h)} ${m[1]}`;
      if (!citing.has(k)) citing.set(k, new Set());
      citing.get(k)!.add(h);
    }
  }
  const expand = (t: { ch99: string[]; ch99Ranges: [string, string][] }) => [...t.ch99, ...t.ch99Ranges.flatMap(([a, b]) => headingsInRange(ctx.headings, a, b))];
  const governing = new Map<string, string[]>();
  /** Headings the text names that aren't in this revision's schedule at all (deleted). */
  const missing = new Map<string, string[]>();
  const governingOf = (ref: string): string[] => {
    const hit = governing.get(ref);
    if (hit) return hit;
    let out: string[];
    if (ref.startsWith('heading ')) out = [ref.slice(8)];
    else if (ref.startsWith('footnote ')) {
      const [a, b] = ref.slice(9).split('–');
      out = b ? headingsInRange(ctx.headings, a!, b) : [a!];
    } else {
      const [, section, path] = /^note (\S+) (.+)$/.exec(ref)!;
      const note = /^\d+/.exec(path!)![0];
      const levels: Subdivision[] = [];
      for (let p = path!; ; p = p.replace(/\([^()]*\)$/, '')) {
        const s = bySectionPath.get(`${section} ${p}`);
        if (s) levels.push(s);
        if (!p.includes('(')) break;
      }
      // nearest "As provided in heading(s) …", else the nearest level that names headings itself, else the whole note
      const provided = levels.find((s) => s.asProvidedIn.headings.length || s.asProvidedIn.ranges.length);
      const named = levels.find((s) => s.ch99.length || s.ch99Ranges.length);
      out = provided
        ? expand({ ch99: provided.asProvidedIn.headings, ch99Ranges: provided.asProvidedIn.ranges })
        : named
          ? expand(named)
          : [...new Set([...(byNote.get(`${section} ${note}`) ?? []).flatMap((s) => expand(s)), ...(citing.get(`${section} ${note}`) ?? [])])];
    }
    const all = [...new Set(out)].sort();
    out = all.filter((h) => ctx.headings[h]);
    governing.set(ref, out);
    missing.set(ref, all.filter((h) => !ctx.headings[h]));
    return out;
  };
  const missingOf = (ref: string) => (governingOf(ref), missing.get(ref)!);
  return { governingOf, missingOf, bySectionPath };
}

export type CoverageIndex = ReturnType<typeof coverageIndex>;

function modeledFor(rules: Rule[], group: OriginGroup) {
  const refs = new Set<string>();
  const headings = new Set<string>();
  for (const r of rules.filter((x) => x.origins.includes(group))) {
    headings.add(r.heading);
    if (r.cap_heading_at_or_above) headings.add(r.cap_heading_at_or_above);
    if ('list' in r.scope) refs.add(r.scope.list);
    for (const q of r.quotes) if (q.source.startsWith('note ')) refs.add(q.source);
  }
  return { refs, headings };
}

const within = (ref: string, outer: string) => ref === outer || ref.startsWith(`${outer}(`);

export function refVerdict(ref: string, origin: Origin, ctx: CoverageContext, idx: CoverageIndex): RefVerdict {
  if (ref.startsWith('note ')) {
    const section = ref.split(' ')[1]!;
    if (isSpecialProgramSection(ctx.notes, section)) return { ref, verdict: 'special_program', open: [] };
  }
  const m = modeledFor(ctx.rules, origin.group);
  if ([...m.refs].some((r) => within(ref, r))) return { ref, verdict: 'modeled', open: [] };
  const hs = idx.governingOf(ref);
  // every heading it names has left the schedule (note 19(k) → 9903.85.08, terminated as of April 6, 2026)
  if (hs.length === 0) return { ref, verdict: idx.missingOf(ref).length ? 'out_of_force' : 'unmodeled', open: [] };
  const open: string[] = [];
  let modeled = false;
  let out = false;
  let special = false;
  let other = false;
  for (const h of hs) {
    if (m.headings.has(h)) modeled = true;
    else if (ctx.outOfForce[h]) out = true;
    else if (isSpecialProgramSection(ctx.notes, subchapterOf(h))) special = true;
    else if (headingAppliesTo(ctx.headings[h]!, origin)) open.push(h);
    else other = true;
  }
  if (open.length) return { ref, verdict: 'unmodeled', open };
  void special; // what remains when nothing else holds
  const verdict: Verdict = modeled ? 'modeled' : other ? 'not_for_origin' : out ? 'out_of_force' : 'special_program';
  return { ref, verdict, open: [] };
}

/** Verdicts for every line-specific mention of a code (broad "chapters 1 to 97" ranges left out). */
export function lineVerdicts(code: string, origin: Origin, ctx: CoverageContext, idx: CoverageIndex): RefVerdict[] {
  return mentionsOf(code, ctx.mentions, { lineOnly: true }).map((ref) => refVerdict(ref, origin, ctx, idx));
}

/** In-force headings that can apply to the origin, have no rule, and govern no line-specific mention. */
export function originGaps(origin: Origin, ctx: CoverageContext, idx: CoverageIndex): string[] {
  const m = modeledFor(ctx.rules, origin.group);
  const lineScoped = new Set<string>();
  const refs = new Set<string>([...Object.values(ctx.mentions.byDigits).flat(), ...ctx.mentions.ranges.filter((r) => !r.broad).map((r) => r.ref)]);
  for (const ref of refs) for (const h of idx.governingOf(ref)) lineScoped.add(h);
  const gaps: string[] = [];
  for (const [h, info] of Object.entries(ctx.headings)) {
    if (isSpecialProgramSection(ctx.notes, subchapterOf(h))) continue;
    if (m.headings.has(h) || ctx.outOfForce[h] || lineScoped.has(h) || !headingAppliesTo(info, origin)) continue;
    // adds nothing to the General rate ("No change", "The duty provided in the applicable subheading", "Free"): it can only
    // lower duty, so it can't make an estimate too low
    if (ADDS_NOTHING.test(info.general)) continue;
    // a heading whose text names lines is line-scoped through its "heading …" mention
    const t = codeTokens(info.chain);
    if (t.codes8.length || t.codes10.length || t.codes6.length || t.headings4.length || t.chapters.length) continue;
    gaps.push(h);
  }
  return gaps.sort();
}
