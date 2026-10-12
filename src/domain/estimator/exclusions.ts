// Exclusions in U.S. note 20 to subchapter III: subdivisions saying a note 20 heading's additional duty "shall not apply" to
// particular products (USTR product exclusions, 20(h) … 20(www); derived-rate entries, 20(z) … 20(gg)). Pure.
// An exclusion can only lower the duty, so a line it names is still estimated with the list duty; an exclusion in effect is
// disclosed on that line (naming the subdivision), an expired one is ignored, an unclear one refuses the line (coverage.ts).
// A unit is the top-most note 20 subdivision whose own text says "shall not apply" (20(h), 20(sss)(i), 20(www) …); its items
// belong to it. Its heading is the one Chapter 99 heading whose text cites it ("as provided for in U.S. note 20(vvv)").
// Status, decided only from official text:
// - unclear: an out-of-sequence label inside it (its items are in doubt); no single heading cites it; or its heading adds
//   duty (an exclusion's heading must not);
// - expired: its heading is out of force (headings.ts: e.g. its entry period "… through November 9, 2026" has ended), or its
//   own compiler's note says "expired" — unless the note-wide compiler's note names it in effect (conflict → unclear);
// - in effect: the note-wide compiler's note ("only subdivisions (vvv) and (www) … are now in effect") names it, or there is
//   no such note; a note-wide note that leaves it out → unclear.
import type { Ch99Notes, Subdivision } from './ch99Notes';
import type { HeadingTable, OutOfForce } from './headings';

export type ExclusionStatus = 'in_effect' | 'expired' | 'unclear';

export interface ExclusionUnit {
  /** "note III 20(vvv)(iii)" */
  ref: string;
  path: string;
  heading: string | null;
  status: ExclusionStatus;
  why: string;
}

export interface Exclusions {
  units: Record<string, ExclusionUnit>;
  /**
   * Subdivisions under a unit that name Chapter 99 headings the unit's own text doesn't: not part of the exclusion (nor is
   * anything under them). Note 21's 9903.89 text, printed "(21) (a)" right after 20(www)(14), reads as 20(www)(21).
   */
  foreign: string[];
  /** The note-wide compiler's note naming the exclusions in effect (null if none, or if its occurrences disagree). */
  inEffect: { ref: string; labels: string[]; quote: string } | null;
  counts: Record<ExclusionStatus, number>;
}

const SECTION = 'III';
const NOTE = 20;
const NO_ADD_ON = 'The duty provided in the applicable subheading';
const EXPIRED_NOTE = /\[Compiler['’]s note:\s*expired\.?\]/i;
const ONLY_IN_EFFECT = /only subdivisions\s+((?:\([a-z]+\)\s*(?:,\s*|and\s*)?)+?)\s*(?:of this note[^.;\]]*?\s)?(?:are\s+)?now in effect/i;
const CITES = /\bU\.S\. notes? 20((?:\([a-z0-9]+\))+)/g;

const within = (path: string, outer: string) => path === outer || path.startsWith(`${outer}(`);
const parentPath = (p: string) => p.replace(/\([^()]*\)$/, '');

function inEffectNote(subs: Subdivision[]): Exclusions['inEffect'] | 'disagree' {
  let found: Exclusions['inEffect'] = null;
  for (const s of subs) {
    const m = ONLY_IN_EFFECT.exec(s.text);
    if (!m) continue;
    const labels = [...m[1]!.matchAll(/\(([a-z]+)\)/g)].map((x) => x[1]!);
    if (!found) found = { ref: `note ${s.section} ${s.path}`, labels, quote: m[0] };
    else if (JSON.stringify(found.labels) !== JSON.stringify(labels)) return 'disagree';
  }
  return found;
}

export function classifyExclusions(notes: Ch99Notes, headings: HeadingTable, outOfForce: Record<string, OutOfForce>): Exclusions {
  const subs = notes.subdivisions.filter((s) => s.section === SECTION && s.note === NOTE);
  const byPath = new Map(subs.map((s) => [s.path, s]));
  const unitSubs = subs.filter((s) => {
    if (!s.shallNotApply) return false;
    for (let p = parentPath(s.path); p.includes('('); p = parentPath(p)) if (byPath.get(p)?.shallNotApply) return false;
    return true;
  });
  // headings citing a note 20 subdivision ("as provided for in U.S. note 20(sss)")
  const citing = new Map<string, string[]>();
  for (const [h, info] of Object.entries(headings)) {
    for (const m of info.chain.matchAll(CITES)) citing.set(`${NOTE}${m[1]}`, [...(citing.get(`${NOTE}${m[1]}`) ?? []), h]);
  }
  const note = inEffectNote(subs);
  const odd = notes.ignoredMarkers.filter((m) => m.section === SECTION && m.note === NOTE && m.why === 'out_of_sequence');

  const units: Exclusions['units'] = {};
  for (const s of unitSubs) {
    const ref = `note ${SECTION} ${s.path}`;
    const put = (heading: string | null, status: ExclusionStatus, why: string) => (units[ref] = { ref, path: s.path, heading, status, why });
    const top = /^\d+\([a-z]+\)/.exec(s.path)![0];
    // the nearest level a heading cites: the unit itself, then its parents ((sss)(i) → 20(sss))
    let hs: string[] = [];
    let cited = s.path;
    for (let p = s.path; ; p = parentPath(p)) {
      if (citing.get(p)?.length) {
        hs = [...new Set(citing.get(p))];
        cited = p;
        break;
      }
      if (!p.includes('(')) break;
    }
    const inside = odd.find((m) => within(m.path, s.path));
    if (inside) {
      put(hs.length === 1 ? hs[0]! : null, 'unclear', `an out-of-sequence label inside it (${inside.path}): its items are in doubt`);
      continue;
    }
    if (hs.length !== 1) {
      put(null, 'unclear', hs.length ? `${hs.length} headings cite U.S. note ${cited}: ${hs.join(', ')}` : `no heading cites U.S. note ${s.path}`);
      continue;
    }
    const h = hs[0]!;
    const general = headings[h]!.general;
    if (general !== NO_ADD_ON) {
      put(h, 'unclear', `heading ${h} adds duty ("${general}")`);
      continue;
    }
    const oof = outOfForce[h];
    if (oof) {
      put(h, 'expired', `heading ${h} is out of force (${oof.why}: ${oof.quote})`);
      continue;
    }
    const label = top.replace(/^\d+\(|\)$/g, '');
    const named = note && note !== 'disagree' ? note.labels.includes(label) : false;
    const own = [s, ...[...byPath.values()].filter((x) => x.path !== s.path && within(s.path, x.path))].map((x) => EXPIRED_NOTE.exec(x.text)).find(Boolean);
    if (own) {
      if (named) put(h, 'unclear', `its own compiler's note says expired, but ${(note as NonNullable<Exclusions['inEffect']>).ref} names it in effect`);
      else put(h, 'expired', `its own compiler's note: ${own[0]}`);
    } else if (note === 'disagree') put(h, 'unclear', "the note-wide compiler's notes disagree on which exclusions are in effect");
    else if (!note) put(h, 'in_effect', `no compiler's note marks it expired; heading ${h} in force`);
    else if (named) put(h, 'in_effect', `named in effect by ${note.ref}; heading ${h} in force`);
    else put(h, 'unclear', `no compiler's note marks it expired, but ${note.ref} names only ${note.labels.map((l) => `(${l})`).join(', ')} as in effect`);
  }
  const counts: Exclusions['counts'] = { in_effect: 0, expired: 0, unclear: 0 };
  for (const u of Object.values(units)) counts[u.status]++;
  const named = (s: Subdivision) => [...s.ch99, ...s.ch99Ranges.flat()];
  const foreign = unitSubs.flatMap((u) => {
    const own = new Set(named(u));
    return subs.filter((s) => s.path.startsWith(`${u.path}(`) && named(s).some((h) => !own.has(h))).map((s) => s.path);
  });
  return { units, foreign, inEffect: note === 'disagree' ? null : note, counts };
}

/**
 * The exclusion unit a mention ref belongs to ("note III 20(vvv)(iii)(12)" → 20(vvv)(iii)), or null — also when a level
 * between the unit and the ref names other Chapter 99 headings (`foreign`): the regular coverage logic decides that ref.
 */
export function exclusionOf(ref: string, ex: Exclusions): ExclusionUnit | null {
  const m = /^note (\S+) (.+)$/.exec(ref);
  if (!m || m[1] !== SECTION) return null;
  for (let p = m[2]!; ; p = parentPath(p)) {
    const u = ex.units[`note ${SECTION} ${p}`];
    if (u) return u;
    if (ex.foreign.includes(p) || !p.includes('(')) return null;
  }
}
