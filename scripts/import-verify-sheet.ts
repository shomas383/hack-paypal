// pnpm rates:import — one-off importer: human-verified sheet (Verify tab) → rate data + eval fixtures.
// Reads data/source/DDP_product_test_sheet_verify.xlsx with node built-ins only (zip via zlib, XML via regex).
// Rules (docs/HTS_VERIFICATION_SPEC.md, CLAUDE.md invariants 2–4):
//  - Only Status = VERIFIED rows become rate rows; everything else is skipped (engine → UNSUPPORTED).
//  - Values are transcribed, never altered. Anything that isn't a plain cell (compound components, listing facts,
//    P03's value split) comes from an explicit table below and is ASSERTED against the row's evidence text (col W).
//  - Any surprise aborts the import. Fix the sheet (a human) — never this script's numbers.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { Ch99Lookup, HtsIndex } from '../src/domain/hts/buildIndex';
import { usd } from '../src/domain/money/money';
import { checkCh99Headings, parseCh99Headings } from '../src/domain/rates/ch99Headings';
import { releaseFromLabel } from '../src/domain/hts/release';
import { CURRENT_HTS_REVISION, CURRENT_RATE_VERSION, goldenFileName, rateFileName } from '../src/domain/rates/current';
import { quoteDuty } from '../src/domain/rates/engine';
import { checkRateKeysAgainstHts } from '../src/domain/rates/htsKeys';
import { excelSerialDate, readSheetRevision } from '../src/domain/rates/sheetRevision';
import { validateRateFile } from '../src/domain/rates/validate';
import type { Additional, Component, RateFile, RateRow } from '../src/domain/rates/schema';

const SOURCE = join('data', 'source', 'DDP_product_test_sheet_verify.xlsx');
// v2 (2026-10-08): the watch is keyed by its component-reporting 8-digit line 9102.21.70 (HTS Ch. 91 Stat. Note 1(d)).
// v3 (2026-10-09): CN watch P13 (two Ch. 99 add-ons: 9903.05.31 + 9903.88.15, cumulative per note 52(a)); programs named
// after their HTS note (CH99_NOTE52, CH99_NOTE20_LIST4A/4B) — the HTS names no Section 301 / forced-labor action for note 52.
// v4 (2026-10-09): EU watch P14 (Germany, 9903.05.39, combined 10% cap per note 52(k)); output text cites heading and note
// numbers only (no "List 4A/4B" / "301" wording).
// v5 (2026-10-10): no CSMS citation (no verified sheet row backs it); note 52 / heading citations unchanged. Rates unchanged.
// 2026-rev21-v1 (2026-10-11): re-verified on HTS 2026 Rev. 21 by full text comparison (HTS_VERIFICATION_SPEC §8); rates
// unchanged. The HTS revision (Verify column Y) and each row's effective date (column Z) come from the sheet, not this file;
// the revision must equal the HTS index's and CURRENT_HTS_REVISION (src/domain/rates/sheetRevision.ts).
const VERSION = CURRENT_RATE_VERSION;
const VERIFIED_BY = 'Shoma';
const OUT_RATES = join('data', 'rates', rateFileName(VERSION));
const OUT_PRODUCTS = join('data', 'eval', 'products.json');
const OUT_GOLDEN = join('data', 'eval', goldenFileName(VERSION));

class ImportError extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ImportError(msg);
}

// ───────────────────────── zip (central directory + raw deflate) ─────────────────────────
function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert(eocd >= 0, 'zip: end of central directory not found (not an .xlsx?)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  assert(count !== 0xffff && p !== 0xffffffff, 'zip: ZIP64 not supported — export the Verify tab as CSV instead');
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    assert(buf.readUInt32LE(p) === 0x02014b50, 'zip: bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    assert(buf.readUInt32LE(local) === 0x04034b50, `zip: bad local header for ${name}`);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    assert(method === 0 || method === 8, `zip: unsupported compression ${method} for ${name}`);
    files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ───────────────────────── xlsx (shared strings + cached cell values) ─────────────────────────
const decode = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

type Sheet = Map<number, Map<string, string>>; // row number → column letter → value (cached, as text)

function readWorkbook(files: Map<string, Buffer>): Map<string, Sheet> {
  const text = (name: string): string => {
    const f = files.get(name);
    assert(f, `xlsx: missing ${name}`);
    return f.toString('utf8');
  };
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...(m[1] ?? '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? '').join('')),
  );
  const rels = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map(
      (m) => [m[1] ?? '', m[2] ?? ''],
    ),
  );
  const sheets = new Map<string, Sheet>();
  for (const m of text('xl/workbook.xml').matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) {
    const target = rels.get(m[2] ?? '');
    assert(target, `xlsx: no relationship for sheet ${m[1]}`);
    const xml = text(`xl/${target.replace(/^\/?xl\//, '')}`);
    const sheet: Sheet = new Map();
    for (const row of xml.matchAll(/<row [^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = new Map<string, string>();
      for (const c of (row[2] ?? '').matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = /\bt="(\w+)"/.exec(c[2] ?? '')?.[1];
        const inner = c[3] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
        let value: string | undefined;
        if (type === 's' && v !== undefined) value = shared[Number(v)];
        else if (type === 'inlineStr') value = inline === undefined ? undefined : decode(inline);
        else if (v !== undefined) value = decode(v);
        if (value !== undefined && value !== '') cells.set(c[1] ?? '', value);
      }
      sheet.set(Number(row[1]), cells);
    }
    sheets.set(decode(m[1] ?? ''), sheet);
  }
  return sheets;
}

// ───────────────────────── sheet-specific tables (each asserted against the sheet) ─────────────────────────
/** Generic product names (no brands) — data/ must not carry trademarks. */
const GENERIC: Record<string, string> = {
  P01: 'Japanese-language trading card game booster box (sealed)',
  P02: 'Graded collectible trading card in a sealed slab (Japanese)',
  P03: '1990s Japanese automatic diver watch, 21 jewels, stainless case, steel bracelet',
  P04: 'Vintage 35mm SLR film camera with 50mm lens',
  P05: 'Articulated PVC collectible figure, ages 15+',
  P06: 'High-end spinning fishing reel (valued over $8.45)',
  P07: 'Vintage denim jeans of uncertain (US or Japan) manufacture',
  P08: "Men's selvedge blue denim jeans, 100% cotton",
  P09: 'Handheld video game console (early 2000s)',
  P10: 'Complete golf driver',
  P11: "Japanese gyuto chef's knife, stainless steel blade, natural wood handle",
  P12: 'Anime series Blu-ray box set, Japanese release (commercially recorded)',
  P13: 'Automatic diver watch, 21 jewels, stainless case, steel bracelet (China)',
  P14: 'Automatic diver watch, 21 jewels, stainless case, steel bracelet (Germany)',
};

/** Brand → generic replacements for free text (col W evidence, LLM notes). Printed for review on every run. */
const GENERICIZE: [RegExp, string][] = [
  [/Pok[eé]mon/gi, 'TCG'],
  [/SKX007J/g, 'Automatic diver watch'],
  [/\b7S26\b/g, 'movement'],
  [/Seiko 5 \/ 4R35/g, 'a comparable automatic watch'],
  [/AE-1 Program /g, ''],
  [/Nendoroid/g, 'Articulated PVC figure'],
  [/GBA SP handheld console/g, 'Handheld console'],
  [/GBA SP /g, ''],
  [/TekyGo! /g, ''],
  [/VG10 steel/g, 'stainless steel'],
];
/** Fails the import if any of these survive genericization. */
const BRAND_DENYLIST =
  /pok[eé]mon|\bPSA\b|seiko|SKX|7S26|4R35|presage|canon|AE-1|nendoroid|shimano|stella|levi|momotaro|nintendo|game boy|\bGBA\b|AGS-001|honma|VG-?10|tekygo|scarlet & violet|daiwa|mizuno|evisu|good smile/i;

function genericize(s: string): string {
  return GENERICIZE.reduce((acc, [re, to]) => acc.replace(re, to), s);
}

/** Compound MFN rates exist only as text in col W; transcribed here and asserted verbatim. */
const COMPOUND: Record<string, { text: string; components: Component[] }> = {
  P03: {
    text: '$1.53 each + 4.2% case + 9.8% band',
    components: [
      { kind: 'specific', amount_usd_micros: 1_530_000, per: 'each' },
      { kind: 'ad_valorem', rate_ppm: 42_000, applies_to: 'case' },
      { kind: 'ad_valorem', rate_ppm: 98_000, applies_to: 'band' },
    ],
  },
  P13: {
    text: '$1.53 each + 4.2% case + 9.8% band',
    components: [
      { kind: 'specific', amount_usd_micros: 1_530_000, per: 'each' },
      { kind: 'ad_valorem', rate_ppm: 42_000, applies_to: 'case' },
      { kind: 'ad_valorem', rate_ppm: 98_000, applies_to: 'band' },
    ],
  },
  P14: {
    text: '$1.53 each + 4.2% case + 9.8% band',
    components: [
      { kind: 'specific', amount_usd_micros: 1_530_000, per: 'each' },
      { kind: 'ad_valorem', rate_ppm: 42_000, applies_to: 'case' },
      { kind: 'ad_valorem', rate_ppm: 98_000, applies_to: 'band' },
    ],
  },
  P11: {
    text: '0.4¢ each + 6.1%',
    components: [
      { kind: 'specific', amount_usd_micros: 4_000, per: 'each' },
      { kind: 'ad_valorem', rate_ppm: 61_000, applies_to: 'full_value' },
    ],
  },
};

/** Listing facts the verified row depends on; each asserted against col W. */
const FACTS: Record<string, { facts: Record<string, boolean>; evidence: string[] }> = {
  P11: {
    facts: { steel_weight_share_ge_15pct: true, steel_us_melted_poured_ge_85pct: false },
    evidence: ['steel >15% of weight', 'Not US-melted steel'],
  },
  P12: { facts: { informational_material: true }, evidence: ['Commercially recorded', '"informational materials"'] },
};

/** Golden price override (decision 2026-10-05): P03 at $300 = case $250 + band $50, per col W. */
const GOLDEN_OVERRIDE: Record<string, { price_minor: number; value_split: { case_minor: number; band_minor: number }; evidence: string }> = {
  P03: { price_minor: 30_000, value_split: { case_minor: 25_000, band_minor: 5_000 }, evidence: 'AVE 5.6% at $300 (case 250 / band 50)' },
  P13: { price_minor: 28_000, value_split: { case_minor: 23_000, band_minor: 5_000 }, evidence: 'AVE 5.7% at $280 (case 230 / band 50)' },
  P14: { price_minor: 29_000, value_split: { case_minor: 24_000, band_minor: 5_000 }, evidence: 'AVE 5.7% at $290 (case 240 / band 50)' },
};

/**
 * Rows that apply SEVERAL Chapter 99 headings (column O "a + b"): each heading's rate, asserted against O (same headings,
 * same order), Q (= the sum) and W (each "heading +x%" text). Cumulative per note 52(a).
 */
const MULTI_CH99: Record<string, { heading: string; rate_ppm: number; text: string; ref: string; program: string }[]> = {
  P13: [
    { heading: '9903.05.31', rate_ppm: 125_000, text: '9903.05.31 +12.5%', ref: 'U.S. note 52', program: 'CH99_NOTE52' },
    { heading: '9903.88.15', rate_ppm: 75_000, text: '9903.88.15 +7.5%', ref: 'U.S. note 20(r)/(s)(i)', program: 'CH99_NOTE20_LIST4A' },
  ],
};
/** Phrases W must contain for a multi-heading CN row (the user's verification against the Ch. 99 PDF, 2026-10-09). */
const MULTI_CH99_EVIDENCE = ['note 20(r)', 'note 52(a)', 'not in List 4B', 'no in-effect exclusion', 'not in note 16'];

/** Exact expected duty where R × price isn't a whole cent (compound MFN + additive add-ons), asserted against W. */
const EXACT_DUTY: Record<string, { text: string; duty_minor: number }> = {
  P13: { text: '= $72.09', duty_minor: 7_209 },
  P14: { text: '= $29.00', duty_minor: 2_900 },
};

const ORIGIN: Record<string, string> = { Japan: 'JP', China: 'CN', Germany: 'DE' };
/** EU member-state origins handled by the note 52 EU headings (9903.05.38 / .39). Add a member only after verifying it. */
const EU_MEMBER = new Set(['DE']);
/** Phrases W must contain for an EU 9903.05.39 row (the user's verification against the Ch. 99 PDF, 2026-10-09). */
const EU_EVIDENCE = ['9903.05.39 combined 10%', 'note 52(k)', 'not in note 52(j)(2)', '9903.05.97', 'no note 52(b) exemption', 'not in note 16', 'IEEPA (terminated)'];
/** Origins that only appear on rows that aren't verified (used for UNSUPPORTED golden cases, never for rate rows). */
const NOT_VERIFIED_ORIGIN: Record<string, string> = { USA: 'US' };

// ───────────────────────── helpers ─────────────────────────
/** Sheet decimal (e.g. 0.16600000000000001) → integer ppm; refuses values that aren't whole ppm. */
function toPpm(raw: string | undefined, where: string): number {
  assert(raw !== undefined && raw !== '' && !Number.isNaN(Number(raw)), `${where}: expected a number, got "${raw}"`);
  const x = Number(raw) * 1_000_000;
  const ppm = Math.round(x);
  assert(Math.abs(x - ppm) < 1e-3, `${where}: ${raw} is not a whole number of ppm`);
  return ppm;
}

const hts8 = (hts10: string): string => hts10.slice(0, 10); // "9102.21.7000" → "9102.21.70"
const rest = (hts8dots: string): string => `https://hts.usitc.gov/reststop/search?keyword=${hts8dots}`;
const RULING = /^[A-Z]{1,2}\d{6}$/;

// ───────────────────────── main ─────────────────────────
function main(): void {
  const buf = readFileSync(SOURCE);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const evalSkipped: string[] = [];
  const sheets = readWorkbook(readZip(buf));
  const verify = sheets.get('Verify');
  const products = sheets.get('Products');
  assert(verify && products, 'xlsx: Verify and Products tabs are required');

  // Header checks — abort if the sheet layout moved.
  const vh = verify.get(11);
  assert(vh, 'Verify: header row 11 missing');
  const expectV: Record<string, RegExp> = {
    A: /^ID$/, C: /^Origin$/, I: /^CBP ruling to check$/, K: /^Demo priority$/, L: /^L\. Code exists/, M: /^M\. Verified HTS/,
    N: /^N\. Verified base/, O: /^O\. Ch\.99 heading$/, P: /^P\. Exemptions checked/, Q: /^Q\. Verified add-on/,
    R: /^Verified total/, U: /^U\. Ruling supports/, V: /^V\. Verified on/, W: /^W\. Notes$/, X: /^Status$/,
    Y: /^Y\. HTS revision$/, Z: /^Z\. Effective from \(date\)$/,
  };
  for (const [col, re] of Object.entries(expectV)) assert(re.test(vh.get(col) ?? ''), `Verify header ${col}11 = "${vh.get(col)}"`);
  const ph = products.get(2);
  assert(ph, 'Products: header row 2 missing');
  const expectP: Record<string, RegExp> = {
    A: /^ID$/, E: /sale price \(USD\)/, O: /^LLM HTS code$/, P: /^LLM base duty/, Q: /^LLM additional tariff/,
    R: /^LLM TOTAL duty/, S: /^LLM confidence/,
  };
  for (const [col, re] of Object.entries(expectP)) assert(re.test(ph.get(col) ?? ''), `Products header ${col}2 = "${ph.get(col)}"`);

  const productRows = new Map<string, Map<string, string>>();
  for (const [, cells] of products) {
    const id = cells.get('A');
    if (id && /^P\d{2}$/.test(id)) productRows.set(id, cells);
  }

  type Imported = { id: string; origin: string; hts10: string; cells: Map<string, string>; base: number; addon: number; total: number };
  const imported: Imported[] = [];
  const skipped: { id: string; status: string; reason: string }[] = [];
  const evalProducts: unknown[] = [];
  const golden: unknown[] = [];

  // The Verify table is the contiguous block of ID rows below the header (row 11). It ends at the first non-ID row (the
  // "Progress" block starts right after the last ID row, e.g. row 25 after P13 on row 24); an ID row below that aborts.
  const ordered = [...verify].filter(([n]) => n > 11).sort((a, b) => a[0] - b[0]);
  const isId = (c: Map<string, string>) => /^P\d{2}$/.test(c.get('A') ?? '');
  const first = ordered.findIndex(([, c]) => isId(c));
  assert(first >= 0, 'Verify: no ID rows below the header');
  const endIdx = ordered.findIndex(([, c], i) => i > first && !isId(c));
  const tableRows = endIdx < 0 ? ordered.slice(first) : ordered.slice(first, endIdx);
  const after = endIdx < 0 ? [] : ordered.slice(endIdx).filter(([, c]) => isId(c));
  assert(after.length === 0, `Verify: ID row(s) ${after.map(([n]) => n).join(', ')} below the end of the table (row ${ordered[endIdx]?.[0]}) — not read`);
  const readRange = `rows ${tableRows[0]![0]}–${tableRows.at(-1)![0]} (${tableRows.length} rows; table ends before row ${endIdx < 0 ? '(end of sheet)' : ordered[endIdx]![0]})`;

  for (const [, cells] of tableRows) {
    const id = cells.get('A')!;
    const status = cells.get('X') ?? '';
    const prod = productRows.get(id);
    assert(prod, `${id}: no Products row`);
    assert(GENERIC[id], `${id}: no generic name — add one to GENERIC`);

    // eval/products.json gets every product (incl. excluded) that HAS an offline LLM answer (Products O–S), genericized.
    // Rows added later without one (P13) stay out of the eval set instead of getting an invented answer.
    const notes = genericize(prod.get('S') ?? '');
    const hasLlmAnswer = Boolean(prod.get('O'));
    if (!hasLlmAnswer) evalSkipped.push(id);
    if (hasLlmAnswer) evalProducts.push({
      id,
      title: GENERIC[id],
      origin: ORIGIN[cells.get('C') ?? ''] ?? null,
      expected:
        status === 'VERIFIED'
          ? { status, hts10: cells.get('M'), total_ppm: toPpm(cells.get('R'), `${id} R`) }
          : { status, hts10: null, total_ppm: null },
      llm: {
        hts10: prod.get('O') ?? null,
        base_ppm: toPpm(prod.get('P'), `${id} LLM P`),
        addon_ppm: toPpm(prod.get('Q'), `${id} LLM Q`),
        total_ppm: toPpm(prod.get('R'), `${id} LLM R`),
        confidence: /^(HIGH|MED-HIGH|MED|LOW)\b/.exec(prod.get('S') ?? '')?.[1] ?? null,
        notes,
      },
      source: 'offline LLM test, 2026-09-13 (HTS Rev. 18 era)',
    });

    if (status !== 'VERIFIED') {
      skipped.push({ id, status, reason: genericize(cells.get('W') ?? '(no note)') });
      // Not-verified rows must be UNSUPPORTED for every origin the sheet names (P07: "USA / Japan").
      const named = (cells.get('C') ?? '').split('/').map((s) => s.trim());
      const origins = named.map((c) => ORIGIN[c] ?? NOT_VERIFIED_ORIGIN[c]).filter((o): o is string => Boolean(o));
      assert(origins.length > 0, `${id}: no recognizable origin in "${cells.get('C')}"`);
      for (const origin of origins) golden.push({ id, origin, hts10: cells.get('D') ?? null, expected: 'UNSUPPORTED' });
      continue;
    }

    const origin = ORIGIN[cells.get('C') ?? ''];
    assert(origin, `${id}: unsupported origin "${cells.get('C')}"`);
    const hts10 = cells.get('M') ?? '';
    // 10-digit statistical line, or an 8-digit component-reporting line (checked against the HTS index below).
    assert(/^\d{4}\.\d{2}\.\d{2}(\d{2})?$/.test(hts10), `${id}: M is not an HTS line (NNNN.NN.NNNN or NNNN.NN.NN) "${hts10}"`);
    assert(cells.get('L') === 'Y' && cells.get('P') === 'Y', `${id}: L and P must be Y`);
    const base = toPpm(cells.get('N'), `${id} N`);
    const addon = toPpm(cells.get('Q'), `${id} Q`);
    const total = toPpm(cells.get('R'), `${id} R`);
    assert(base + addon === total, `${id}: N + Q ≠ R (${base} + ${addon} ≠ ${total})`);
    imported.push({ id, origin, hts10, cells, base, addon, total });

    const price = GOLDEN_OVERRIDE[id];
    const priceUsd = prod.get('E');
    assert(priceUsd && /^\d+(\.\d{1,2})?$/.test(priceUsd), `${id}: Products E price "${priceUsd}"`);
    if (price) assert((cells.get('W') ?? '').includes(price.evidence), `${id}: W lacks "${price.evidence}"`);
    if (EXACT_DUTY[id]) assert((cells.get('W') ?? '').includes(EXACT_DUTY[id].text), `${id}: W lacks "${EXACT_DUTY[id].text}"`);
    golden.push({
      id,
      origin,
      hts10,
      price_minor: price?.price_minor ?? Math.round(Number(priceUsd) * 100),
      quantity: 1,
      ...(price ? { value_split: price.value_split } : {}),
      ...(FACTS[id] ? { facts: FACTS[id].facts } : {}),
      expected_total_ppm: total,
      ...(EXACT_DUTY[id] ? { expected_duty_minor: EXACT_DUTY[id].duty_minor } : {}),
      expected_chapter99: parseCh99Headings(cells.get('O') ?? '')[0], // the first heading in O (P13 lists two)
      expected: 'OK',
    });
  }

  // HTS revision (column Y) and effective dates (column Z) of the VERIFIED rows. Every rate key must be a real line in the
  // official HTS index of that revision (pnpm hts:import), and every applied Ch. 99 heading must be in its Ch. 99 lookup.
  assert(imported.length > 0, 'Verify: no VERIFIED rows');
  const firstY = imported[0]!.cells.get('Y');
  assert(firstY, `${imported[0]!.id} Y: HTS revision missing`);
  const slug = releaseFromLabel(firstY).slug;
  const HTS_INDEX = join('data', 'hts', `${slug}.json`);
  const CH99_LOOKUP = join('data', 'hts', `${slug}-ch99.json`);
  const htsIndex = JSON.parse(readFileSync(HTS_INDEX, 'utf8')) as HtsIndex;
  const htsCodes = new Map(htsIndex.codes.map((c) => [c.c, c.componentReporting ? { componentReporting: true as const } : {}]));
  const ch99 = JSON.parse(readFileSync(CH99_LOOKUP, 'utf8')) as Ch99Lookup;
  const { revision, effectiveFrom } = readSheetRevision(
    imported.map((r) => ({ id: r.id, y: r.cells.get('Y'), z: r.cells.get('Z') })),
    { indexRevision: htsIndex.hts_revision, currentRevision: CURRENT_HTS_REVISION },
  );
  const HTS_REVISION = revision.label;
  assert(ch99.hts_revision === HTS_REVISION, `Ch. 99 lookup revision "${ch99.hts_revision}" ≠ "${HTS_REVISION}"`);
  // The engine self-check below quotes at the latest effective date (every row is in force by then).
  const selfCheckDate = Object.values(effectiveFrom).sort().at(-1)!;

  // JP cap rate comes from the sheet itself: every JP 9903.05.49 row must total the same rate.
  const jpCaps = new Set(imported.filter((r) => r.origin === 'JP' && r.cells.get('O') === '9903.05.49').map((r) => r.total));
  assert(jpCaps.size === 1, `JP 9903.05.49 rows disagree on the combined total: ${[...jpCaps].join(', ')}`);
  const jpCap = [...jpCaps][0]!;
  // EU cap likewise comes from the sheet (every EU .39 row totals the same rate), and must match the official heading text:
  // .39 "… less than N percent", .38 "… equal to or greater than N percent" (Ch. 99 lookup).
  const euRows = imported.filter((r) => EU_MEMBER.has(r.origin));
  const euCaps = new Set(euRows.filter((r) => r.cells.get('O') === '9903.05.39').map((r) => r.total));
  assert(euCaps.size <= 1, `EU 9903.05.39 rows disagree on the combined total: ${[...euCaps].join(', ')}`);
  const euCap = [...euCaps][0];
  if (euRows.length) {
    assert(euCap !== undefined, 'EU rows present but none on 9903.05.39 — the cap cannot be read from the sheet');
    const pctText = `${euCap / 10_000} percent`;
    assert(euCap % 10_000 === 0, `EU cap ${euCap} ppm is not a whole percent`);
    assert((ch99.headings['9903.05.39'] ?? '').includes(`less than ${pctText}`), `9903.05.39 official text lacks "less than ${pctText}" — sheet cap ≠ HTS`);
    assert((ch99.headings['9903.05.38'] ?? '').includes(`equal to or greater than ${pctText}`), `9903.05.38 official text lacks "equal to or greater than ${pctText}"`);
  }

  // Build rate rows, merging listings that share (origin, hts10).
  const rows = new Map<string, RateRow>();
  for (const r of imported) {
    const w = r.cells.get('W') ?? '';
    const o = r.cells.get('O') ?? '';
    const key = `${r.origin}-${r.hts10}`;
    const where = `${r.id} (${key})`;

    // MFN
    let mfn: RateRow['mfn'];
    const compound = COMPOUND[r.id];
    if (compound) {
      assert(w.includes(compound.text), `${where}: W does not contain compound rate text "${compound.text}"`);
      mfn = { type: 'compound', ...compound };
      const adv = compound.components.find((c) => c.kind === 'ad_valorem' && c.applies_to === 'full_value');
      if (adv && adv.kind === 'ad_valorem') assert(adv.rate_ppm === r.base, `${where}: N ≠ ad valorem component`);
    } else {
      // A specific rate reads like "$1.53 each" / "0.4¢ each" (a threshold like ">$8.45" is not one).
      assert(!/(\$\d+(\.\d+)?|\d+(\.\d+)?¢) each/.test(w), `${where}: W looks like a specific/compound rate — add it to COMPOUND`);
      mfn = r.base === 0 ? { type: 'free' } : { type: 'ad_valorem', rate_ppm: r.base };
    }

    // Chapter 99
    const additional: Additional[] = [];
    const notApplied: RateRow['not_applied'] = [];
    const exemptRefs = ['9903.05.85–.92 checked (note 52(b), 52(c), 52(f) lists; .92 by description)'];
    // Column O: one or more Chapter 99 headings, each in the official lookup and not suspended.
    const heads = parseCh99Headings(o);
    const headErrors = checkCh99Headings(heads, ch99.headings);
    assert(headErrors.length === 0, `${where}: ${headErrors.join('; ')}`);
    const sources: RateRow['source_refs'] = [
      { kind: 'hts_line', ref: `${hts8(r.hts10)} General (HTS ${HTS_REVISION})`, url: rest(hts8(r.hts10)) },
      ...heads.map((h) => ({ kind: 'ch99_heading' as const, ref: h })),
    ];
    const conditions = (FACTS[r.id]?.evidence ?? []).length
      ? Object.entries(FACTS[r.id]!.facts).map(([fact, required_value]) => ({ fact, required_value, ref: '' }))
      : [];
    for (const e of FACTS[r.id]?.evidence ?? []) assert(w.includes(e), `${where}: W lacks fact evidence "${e}"`);

    if (r.origin === 'JP' && (o === '9903.05.49' || o === '9903.05.48')) {
      if (o === '9903.05.49') {
        assert(r.base < jpCap || compound, `${where}: .49 but base ≥ cap`);
        assert(r.total === jpCap, `${where}: .49 total ≠ cap`);
      } else {
        assert(r.base >= jpCap && r.addon === 0, `${where}: .48 needs base ≥ cap and no add-on`);
      }
      additional.push({
        program: 'CH99_NOTE52', chapter99: '9903.05.49', chapter99_at_or_above_cap: '9903.05.48', rule: 'combined_cap',
        rate_ppm: jpCap, basis: 'full_value', compare: 'ave', conditions: [], ref: 'U.S. note 52',
      });
      sources.push({ kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 52' });
    } else if (r.origin === 'CN' && o === '9903.05.31') {
      assert(r.addon > 0, `${where}: CN .31 add-on missing`);
      additional.push({
        program: 'CH99_NOTE52', chapter99: '9903.05.31', rule: 'additive', rate_ppm: r.addon, basis: 'full_value',
        conditions: [], ref: 'U.S. note 52',
      });
      // P05: "List 4B (9903.88.16, note 20(u)) SUSPENDED"; P09: "List 4B (9903.88.16) SUSPENDED".
      assert(/List 4B \(9903\.88\.16(?:, note 20\(u\))?\) SUSPENDED/.test(w), `${where}: W must record List 4B (9903.88.16) SUSPENDED`);
      notApplied.push({ program: 'CH99_NOTE20_LIST4B', chapter99: '9903.88.16', reason: "suspended (compiler's note)", ref: 'U.S. note 20(u)' });
      exemptRefs.push('note 20 (legacy China lists) checked');
      sources.push({ kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 52; note 20(u)' });
    } else if (r.origin === 'CN' && MULTI_CH99[r.id] && heads.join(' + ') === '9903.05.31 + 9903.88.15') {
      // CN with the note 52 duty AND an active legacy List 4A line (9903.88.15), cumulative per note 52(a) — P13.
      const parts = MULTI_CH99[r.id]!;
      assert(JSON.stringify(parts.map((p) => p.heading)) === JSON.stringify(heads), `${where}: O headings ≠ MULTI_CH99 (${parts.map((p) => p.heading).join(' + ')})`);
      assert(parts.reduce((s, p) => s + p.rate_ppm, 0) === r.addon, `${where}: Q (${r.addon} ppm) ≠ the sum of the headings' rates`);
      for (const p of parts) assert(w.includes(p.text), `${where}: W lacks "${p.text}"`);
      for (const e of MULTI_CH99_EVIDENCE) assert(w.includes(e), `${where}: W lacks "${e}"`);
      for (const p of parts) {
        additional.push({ program: p.program, chapter99: p.heading, rule: 'additive', rate_ppm: p.rate_ppm, basis: 'full_value', conditions: [], ref: p.ref });
      }
      notApplied.push({
        program: 'CH99_NOTE20_LIST4B', chapter99: '9903.88.16',
        reason: "9102.21.70 not listed under 9903.88.16 (note 20(u)); provision suspended (compiler's note)", ref: 'U.S. note 20(u)',
      });
      exemptRefs.push(
        'note 20: 9903.88.15 (note 20(r)/(s)(i)) applies to this line; not listed under 9903.88.16 (note 20(u)); no in-effect exclusion',
        'note 16 (Section 232): 9102 not listed',
      );
      sources.push(
        { kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 52 (incl. 52(a) cumulative)' },
        { kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 20(r)/(s)(i)' },
      );
    } else if (EU_MEMBER.has(r.origin) && (o === '9903.05.39' || o === '9903.05.38')) {
      // EU member state (note 52): combined 10% cap — .39 below it (top-up), .38 at or above it (no add-on); AVE per 52(k).
      if (o === '9903.05.39') {
        assert(r.base < euCap! || compound, `${where}: .39 but base ≥ cap`);
        assert(r.total === euCap, `${where}: .39 total ≠ cap`);
        for (const e of EU_EVIDENCE) assert(w.includes(e), `${where}: W lacks "${e}"`);
      } else {
        assert(r.base >= euCap! && r.addon === 0, `${where}: .38 needs base ≥ cap and no add-on`);
      }
      additional.push({
        program: 'CH99_NOTE52', chapter99: '9903.05.39', chapter99_at_or_above_cap: '9903.05.38', rule: 'combined_cap',
        rate_ppm: euCap!, basis: 'full_value', compare: 'ave', conditions: [], ref: 'U.S. note 52(k)',
      });
      exemptRefs.push('9903.05.97 (note 52(j)(2) EU list) checked', 'note 16 (Section 232): 9102 not listed');
      sources.push({ kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 52 (incl. 52(j)(2), 52(k))' });
    } else if (r.origin === 'JP' && o === '9903.82.09') {
      assert(/note 16\(c\)\(vii\)/i.test(w) && /9903\.05\.90/.test(w), `${where}: W must cite note 16(c)(vii) and 9903.05.90`);
      additional.push(
        {
          program: 'S232_DERIVATIVE_STEEL', chapter99: '9903.82.09', rule: 'additive', rate_ppm: r.addon, basis: 'full_value',
          conditions: conditions.map((c) => ({
            ...c,
            ref: c.fact === 'steel_weight_share_ge_15pct' ? 'note 16(c): metal ≥15% of weight' : 'note 16(e): else 9903.82.06',
          })),
          ref: 'note 16(c)(vii) derivative steel',
        },
        {
          program: 'CH99_NOTE52', chapter99: '9903.05.90', rule: 'exempt', rate_ppm: 0, basis: 'full_value', conditions: [],
          ref: 'note 52(f)(1): Section 232 article',
        },
      );
      exemptRefs.push('note 16 (Section 232) checked');
      sources.push({ kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 16(c)(vii); note 52(f)(1)' });
    } else if (r.origin === 'JP' && o === '9903.05.92') {
      assert(r.addon === 0, `${where}: .92 must have no add-on`);
      additional.push({
        program: 'CH99_NOTE52', chapter99: '9903.05.92', rule: 'exempt', rate_ppm: 0, basis: 'full_value',
        conditions: conditions.map((c) => ({ ...c, ref: '9903.05.92: films, compact disks, CD-ROMs… "including but not limited to"' })),
        ref: 'U.S. note 52',
      });
      sources.push({ kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 52' });
    } else {
      throw new ImportError(`${where}: unhandled origin/heading ${r.origin} ${o} — needs a human decision`);
    }

    // Ruling
    const u = r.cells.get('U') ?? '';
    const num = r.cells.get('I') ?? '';
    const number = RULING.test(num) ? num : null;
    let ruling: RateRow['ruling'];
    if (u === 'Y') {
      assert(number, `${where}: U = Y but no ruling number in I`);
      ruling = /analogy/i.test(w) ? { number, status: 'analogy', note: 'analogy only (different product)' } : { number, status: 'supports' };
    } else {
      assert(u === 'none', `${where}: U must be Y or none, got "${u}"`);
      ruling = number
        ? { number, status: 'none', note: /not yet read/i.test(w) ? 'cited, not yet read' : 'listed on the sheet; not used as support' }
        : { number: null, status: 'none' };
    }

    const special = /Free under JP agreement if claimed/.test(w)
      ? 'Special column: Free under the JP agreement if claimed. Policy uses General (no FTA claim assumed).'
      : undefined;
    const plastic = /Plastic handle would be \d{4}\.\d{2}\.\d{2} \([^)]*\)/.exec(w)?.[0];

    const row: RateRow = {
      id: key,
      hts10: r.hts10,
      ...(htsCodes.get(r.hts10)?.componentReporting ? { component_reporting: true as const } : {}),
      origin: r.origin,
      listings: [r.id],
      description: GENERIC[r.id]!,
      mfn,
      ...(special || plastic ? { special_note: [special, plastic ? `${plastic} — different row, not verified.` : undefined].filter(Boolean).join(' ') } : {}),
      additional,
      not_applied: notApplied,
      exemptions_checked: { done: true, refs: exemptRefs },
      source_refs: sources,
      ruling,
      evidence: genericize(w),
      verified_by: VERIFIED_BY,
      verified_on: excelSerialDate(r.cells.get('V'), `${where} V`),
      hts_revision: HTS_REVISION,
      effective_from: effectiveFrom[r.id]!,
      effective_to: null,
    };

    const existing = rows.get(key);
    if (!existing) {
      rows.set(key, row);
      continue;
    }
    // Same (origin, hts10) from another listing: the rate parts must be identical; merge listings/evidence/rulings.
    assert(JSON.stringify(existing.mfn) === JSON.stringify(row.mfn), `${where}: MFN differs from ${existing.listings.join(',')}`);
    assert(JSON.stringify(existing.additional) === JSON.stringify(row.additional), `${where}: Ch.99 differs from ${existing.listings.join(',')}`);
    existing.listings.push(r.id);
    existing.description = `${existing.description} / ${row.description}`;
    existing.evidence = `${existing.evidence} | ${r.id}: ${row.evidence}`;
    if (row.ruling.number && row.ruling.number !== existing.ruling.number) {
      existing.ruling = { ...existing.ruling, note: [existing.ruling.note, `also ${row.ruling.number} (${row.ruling.status}, ${r.id})`].filter(Boolean).join('; ') };
    }
    assert(existing.verified_on === row.verified_on, `${where}: verified_on differs within merged row`);
    assert(existing.effective_from === row.effective_from, `${where}: effective_from (Z) differs within merged row`);
  }

  const file: RateFile = {
    version: VERSION,
    hts_revision: HTS_REVISION,
    generated_from: { file: 'data/source/DDP_product_test_sheet_verify.xlsx', tab: 'Verify', sha256 },
    regime_notes: [
      'De minimis suspended for all countries (EO 14324 eff. Aug 29, 2025; CBP interim final rules made it indefinite eff. June 24, 2026).',
      'Chapter 99 U.S. note 52 additional duty (9903.05.xx): headings 9903.05.20–.84 by country, exemptions 9903.05.85–.92; effective July 24, 2026.',
      'China: 9903.88.15 (note 20(r)/(s)(i)) is active and applies cumulatively with 9903.05.31 where the line is listed (note 52(a)); 9903.88.16 (note 20(u)) is suspended.',
      'EU member states: 9903.05.39 (column 1 AVE < 10%) tops the total up to 10%; 9903.05.38 (≥ 10%) adds nothing; exemptions 9903.05.85–.92 and 9903.05.97 (note 52(j)(2)); AVE per note 52(k).',
      'IEEPA tariffs (9903.01.xx / 9903.02.xx) terminated; CBP stopped collecting for entries on/after Feb 24, 2026. Never added.',
      'Section 122 10% surcharge expired July 24, 2026.',
    ],
    rows: [...rows.values()],
  };

  // Self-checks before writing anything.
  const v = validateRateFile(file, { requiredRevision: HTS_REVISION });
  assert(v.ok, `generated file fails validation:\n  ${v.errors.join('\n  ')}`);
  const keyErrors = checkRateKeysAgainstHts(file.rows, { hts_revision: htsIndex.hts_revision, codes: htsCodes }, HTS_REVISION);
  assert(keyErrors.length === 0, `rate keys not in the HTS index (${HTS_INDEX}):\n  ${keyErrors.join('\n  ')}`);
  // Exact-duty golden cases: the engine on the generated rows must reproduce the W-stated duty to the cent.
  for (const g of golden as { id: string; origin: string; hts10: string; price_minor?: number; value_split?: { case_minor: number; band_minor: number }; expected_duty_minor?: number }[]) {
    if (g.expected_duty_minor === undefined) continue;
    const q = quoteDuty(file, {
      origin: g.origin,
      hts10: g.hts10,
      entryDate: selfCheckDate,
      customsValue: usd(g.price_minor!),
      quantity: 1,
      ...(g.value_split ? { valueSplit: { case: usd(g.value_split.case_minor), band: usd(g.value_split.band_minor) } } : {}),
    });
    assert(q.kind === 'OK', `${g.id}: engine refuses the generated row — ${q.kind === 'UNSUPPORTED' ? q.reason : ''}`);
    assert(q.kind === 'OK' && q.totalDuty.amountMinor === BigInt(g.expected_duty_minor), `${g.id}: engine duty ${q.kind === 'OK' ? q.totalDuty.amountMinor : '?'} ≠ W-stated ${g.expected_duty_minor}`);
  }
  const out = { rates: JSON.stringify(file, null, 2), products: JSON.stringify(evalProducts, null, 2), golden: '' };
  out.golden = JSON.stringify({ rate_version: VERSION, note: 'Expected values from the Verify tab (column R/O); prices from Products E unless overridden.', cases: golden }, null, 2);
  for (const [name, text] of Object.entries(out)) {
    const hit = BRAND_DENYLIST.exec(text);
    assert(!hit, `brand name "${hit?.[0]}" left in ${name} output — extend GENERICIZE`);
  }

  mkdirSync(join('data', 'rates'), { recursive: true });
  mkdirSync(join('data', 'eval'), { recursive: true });
  writeFileSync(OUT_RATES, out.rates + '\n');
  writeFileSync(OUT_PRODUCTS, out.products + '\n');
  writeFileSync(OUT_GOLDEN, out.golden + '\n');

  console.log(`source ${SOURCE} sha256 ${sha256.slice(0, 12)}…`);
  console.log(`Verify tab: read ${readRange}`);
  console.log('\nimported (VERIFIED):');
  for (const row of file.rows) {
    const heads = row.additional.map((a) => `${a.chapter99} ${a.rule}${a.rate_ppm ? ` ${a.rate_ppm / 10_000}%` : ''}`).join(' + ');
    console.log(`  ${row.listings.join('+').padEnd(7)} ${row.id.padEnd(18)} mfn=${row.mfn.type.padEnd(10)} ${heads}`);
  }
  console.log('\nskipped (not VERIFIED → engine returns UNSUPPORTED):');
  for (const s of skipped) console.log(`  ${s.id} ${s.status}: ${s.reason}`);
  console.log(`\nnot in the classifier eval set (no offline LLM answer on the Products sheet): ${evalSkipped.join(', ') || 'none'}`);
  console.log('\ngenericize map (review):');
  for (const [re, to] of GENERICIZE) console.log(`  ${re.source} → "${to}"`);
  const sha = (text: string): string => createHash('sha256').update(text + '\n').digest('hex').slice(0, 12);
  console.log('\nwrote (sha256 of content — identical across runs means the import is deterministic):');
  console.log(`  ${OUT_RATES} ${sha(out.rates)} (${file.rows.length} rows)`);
  console.log(`  ${OUT_PRODUCTS} ${sha(out.products)} (${evalProducts.length} products)`);
  console.log(`  ${OUT_GOLDEN} ${sha(out.golden)} (${golden.length} cases)`);

  // Stage the generated files (the PreToolUse guard blocks ad-hoc commands on the rates folder; the importer is the
  // sanctioned path). Committing is a separate, reviewed step.
  execFileSync('git', ['add', '--', OUT_RATES, OUT_PRODUCTS, OUT_GOLDEN], { stdio: 'inherit' });
  console.log('staged the 3 generated files (git add) — review with git diff --cached, then commit.');
}

try {
  main();
} catch (e) {
  console.error(`\nIMPORT ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
