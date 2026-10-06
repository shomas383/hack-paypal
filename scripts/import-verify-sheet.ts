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
import { validateRateFile } from '../src/domain/rates/validate';
import type { Additional, Component, RateFile, RateRow } from '../src/domain/rates/schema';

const SOURCE = join('data', 'source', 'DDP_product_test_sheet_verify.xlsx');
const VERSION = '2026-rev20-v1';
const HTS_REVISION = '2026 Rev. 20';
const VERIFIED_BY = 'Shoma';
// Accepted assumption (2026-10-05): Rev. 20 publication date. VERIFY: Rev. 20 effective date if it differs.
const EFFECTIVE_FROM = '2026-09-28';
const OUT_RATES = join('data', 'rates', `${VERSION}.json`);
const OUT_PRODUCTS = join('data', 'eval', 'products.json');
const OUT_GOLDEN = join('data', 'eval', `golden-${VERSION}.json`);

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
};

const ORIGIN: Record<string, string> = { Japan: 'JP', China: 'CN' };
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

function excelDate(serial: string | undefined, where: string): string {
  assert(serial && /^\d+$/.test(serial), `${where}: expected an Excel date serial, got "${serial}"`);
  return new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86_400_000).toISOString().slice(0, 10);
}

const hts8 = (hts10: string): string => hts10.slice(0, 10); // "9102.21.7000" → "9102.21.70"
const rest = (hts8dots: string): string => `https://hts.usitc.gov/reststop/search?keyword=${hts8dots}`;
const RULING = /^[A-Z]{1,2}\d{6}$/;

// ───────────────────────── main ─────────────────────────
function main(): void {
  const buf = readFileSync(SOURCE);
  const sha256 = createHash('sha256').update(buf).digest('hex');
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

  for (const [rowNum, cells] of verify) {
    const id = cells.get('A');
    if (!id || !/^P\d{2}$/.test(id) || rowNum <= 11) continue;
    const status = cells.get('X') ?? '';
    const prod = productRows.get(id);
    assert(prod, `${id}: no Products row`);
    assert(GENERIC[id], `${id}: no generic name — add one to GENERIC`);

    // eval/products.json gets every product (incl. excluded) with the LLM's answer, genericized.
    const notes = genericize(prod.get('S') ?? '');
    evalProducts.push({
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
    assert(/^\d{4}\.\d{2}\.\d{4}$/.test(hts10), `${id}: M is not a 10-digit HTS "${hts10}"`);
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
    golden.push({
      id,
      origin,
      hts10,
      price_minor: price?.price_minor ?? Math.round(Number(priceUsd) * 100),
      quantity: 1,
      ...(price ? { value_split: price.value_split } : {}),
      ...(FACTS[id] ? { facts: FACTS[id].facts } : {}),
      expected_total_ppm: total,
      expected_chapter99: cells.get('O'),
      expected: 'OK',
    });
  }

  // JP cap rate comes from the sheet itself: every JP 9903.05.49 row must total the same rate.
  const jpCaps = new Set(imported.filter((r) => r.origin === 'JP' && r.cells.get('O') === '9903.05.49').map((r) => r.total));
  assert(jpCaps.size === 1, `JP 9903.05.49 rows disagree on the combined total: ${[...jpCaps].join(', ')}`);
  const jpCap = [...jpCaps][0]!;

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
    const sources: RateRow['source_refs'] = [
      { kind: 'hts_line', ref: `${hts8(r.hts10)} General (HTS ${HTS_REVISION})`, url: rest(hts8(r.hts10)) },
      { kind: 'ch99_heading', ref: o },
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
        program: 'S301_FORCED_LABOR', chapter99: '9903.05.49', chapter99_at_or_above_cap: '9903.05.48', rule: 'combined_cap',
        rate_ppm: jpCap, basis: 'full_value', compare: 'ave', conditions: [], ref: 'U.S. note 52; CSMS #69326983',
      });
      sources.push({ kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 52' }, { kind: 'csms', ref: 'CSMS #69326983' });
    } else if (r.origin === 'CN' && o === '9903.05.31') {
      assert(r.addon > 0, `${where}: CN .31 add-on missing`);
      additional.push({
        program: 'S301_FORCED_LABOR', chapter99: '9903.05.31', rule: 'additive', rate_ppm: r.addon, basis: 'full_value',
        conditions: [], ref: 'U.S. note 52; CSMS #69326983',
      });
      // P05: "List 4B (9903.88.16, note 20(u)) SUSPENDED"; P09: "List 4B (9903.88.16) SUSPENDED".
      assert(/List 4B \(9903\.88\.16(?:, note 20\(u\))?\) SUSPENDED/.test(w), `${where}: W must record List 4B (9903.88.16) SUSPENDED`);
      notApplied.push({ program: 'S301_CHINA_LIST_4B', chapter99: '9903.88.16', reason: "suspended (compiler's note)", ref: 'U.S. note 20(u)' });
      exemptRefs.push('note 20 (legacy China 301 lists) checked');
      sources.push({ kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 52; note 20(u)' }, { kind: 'csms', ref: 'CSMS #69326983' });
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
          program: 'S301_FORCED_LABOR', chapter99: '9903.05.90', rule: 'exempt', rate_ppm: 0, basis: 'full_value', conditions: [],
          ref: 'note 52(f)(1): Section 232 article',
        },
      );
      exemptRefs.push('note 16 (Section 232) checked');
      sources.push({ kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 16(c)(vii); note 52(f)(1)' });
    } else if (r.origin === 'JP' && o === '9903.05.92') {
      assert(r.addon === 0, `${where}: .92 must have no add-on`);
      additional.push({
        program: 'S301_FORCED_LABOR', chapter99: '9903.05.92', rule: 'exempt', rate_ppm: 0, basis: 'full_value',
        conditions: conditions.map((c) => ({ ...c, ref: '9903.05.92: films, compact disks, CD-ROMs… "including but not limited to"' })),
        ref: 'U.S. note 52',
      });
      sources.push({ kind: 'us_note', ref: 'Ch. 99 Subch. III U.S. note 52' }, { kind: 'csms', ref: 'CSMS #69326983' });
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
      verified_on: excelDate(r.cells.get('V'), `${where} V`),
      hts_revision: HTS_REVISION,
      effective_from: EFFECTIVE_FROM,
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
  }

  const file: RateFile = {
    version: VERSION,
    hts_revision: HTS_REVISION,
    generated_from: { file: 'data/source/DDP_product_test_sheet_verify.xlsx', tab: 'Verify', sha256 },
    regime_notes: [
      'De minimis suspended for all countries (EO 14324 eff. Aug 29, 2025; CBP interim final rules made it indefinite eff. June 24, 2026).',
      'Forced-labor Section 301: U.S. note 52; headings 9903.05.20–.84 by country, exemptions 9903.05.85–.92; effective July 24, 2026; CSMS #69326983.',
      'IEEPA tariffs (9903.01.xx / 9903.02.xx) terminated; CBP stopped collecting for entries on/after Feb 24, 2026. Never added.',
      'Section 122 10% surcharge expired July 24, 2026. China legacy 301 List 4B (9903.88.16) suspended.',
    ],
    rows: [...rows.values()],
  };

  // Self-checks before writing anything.
  const v = validateRateFile(file, { requiredRevision: HTS_REVISION });
  assert(v.ok, `generated file fails validation:\n  ${v.errors.join('\n  ')}`);
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
  console.log('\nimported (VERIFIED):');
  for (const row of file.rows) {
    const heads = row.additional.map((a) => `${a.chapter99} ${a.rule}${a.rate_ppm ? ` ${a.rate_ppm / 10_000}%` : ''}`).join(' + ');
    console.log(`  ${row.listings.join('+').padEnd(7)} ${row.id.padEnd(18)} mfn=${row.mfn.type.padEnd(10)} ${heads}`);
  }
  console.log('\nskipped (not VERIFIED → engine returns UNSUPPORTED):');
  for (const s of skipped) console.log(`  ${s.id} ${s.status}: ${s.reason}`);
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
