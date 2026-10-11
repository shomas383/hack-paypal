# US Import Duty Verification Spec (HTS + Chapter 99)

Purpose: verify the **US import duty for one product of one origin**: the 10-digit HTS code, the base (column 1) rate, and every Chapter 99 add-on or exemption, against the **current** Harmonized Tariff Schedule, with sources, so the result can go into a rate table without anyone redoing it.

Written 2026-10-05 from a full manual verification of 12 products against **HTS 2026 Revision 20** (published 2026-09-28). Facts about the tariff regime are dated. Re-check the "Regime facts" section whenever the HTS revision changes.

---

## 0. Ground rules (non-negotiable)

1. **Never invent** an HTS code, rate, heading, note number or ruling holding. If a value can't be confirmed from a primary source, leave the row **TODO**. The engine then returns `UNSUPPORTED`, which is the correct outcome.
2. **Primary sources only** for numbers: the HTS itself (hts.usitc.gov / its REST API / its CSV export / the Chapter PDFs), CBP rulings (CROSS), CBP CSMS messages, and the Federal Register. Trade blogs, broker articles, LLM output and old spreadsheets are **leads, not evidence**.
3. **Quote, don't paraphrase.** Every decision must cite the exact line: HTS number, revision, and the heading or note text.
4. **One origin per row.** "Japan or China" isn't a valid origin. Pick one from the product's label, or make two rows.
5. **The AI-filled "manual" baseline is not ground truth.** In the reference run, 3 of 11 baseline codes were outdated or incomplete and 1 total was wrong (§9).

---

## 1. Inputs to collect before touching the HTS

Write these down for the specific unit. Classification depends on facts, not brand names.

| Fact | Why it matters | Example from the reference run |
|---|---|---|
| Exact model / listing | One verified item per row | Seiko SKX007**J**, not "Seiko 5 / Presage" |
| **Country of origin from the label** | Chooses the Chapter 99 rule | SKX007J = Japan; SKX007K = Malaysia/Singapore; GBA SP label "Made in China" |
| Material(s) and their share | Splits lines; Section 232 uses a metal-weight test | VG10 steel blade; 100% cotton denim |
| Function / use | Heading choice | Kitchen knife vs hunting knife |
| Complete article vs part; set vs single | GRI 3(b), "complete" lines | Camera + lens kit → camera; complete golf club 9506.31 vs grip 9506.39 |
| Product-specific splitters | Statistical suffixes and 8-digit lines | Watch: movement type, **jewel count** (>17), case metal, **band material**; Toy: **age label** (children's product = for age 12 and under); Apparel: men's/women's/boys', fiber, denim; Knife: **handle material** (plastic vs other) |
| Price, and value split for compound duties | Ad valorem equivalent (AVE) | Watch $300 = case $250 + bracelet $50 |

If a fact needs the physical item (a label, tag or caseback), ask the user. Don't assume.

---

## 2. Source access: what works (tested 2026-10-05 in this environment)

### 2.1 HTS REST API via WebFetch ✅ (primary tool for rates)
- URL: `https://hts.usitc.gov/reststop/search?keyword=<code or words>`
  - e.g. `...search?keyword=9102.21.70`, `...search?keyword=9903.05.49`, `...search?keyword=9006`
- Returns JSON entries with `htsno, indent, description, general, special, other, footnotes`.
- **Limitation 1: unnumbered parent rows are omitted.** Lines like "Other cameras:", "Having over 17 jewels in the movement:" or "Men's trousers and breeches:" have no HTS number and **don't appear**. A **jump in `indent`** (e.g. 3 → 5) means a parent row is missing. You can't safely choose a statistical suffix without those parents (e.g. 6203.42.45.11 "Blue denim" is under "Men's trousers"; .21–.46 are under boys').
- **Limitation 2: WebFetch passes the page through a summarizer**, which can truncate or paraphrase. Observed: it dropped "(or ad valorem equivalent)" and "as provided for in U.S. note 52" from 9903.05.49. Always use a prompt like:
  > `Return every entry verbatim and in full, no truncation or paraphrase: htsno | indent | description | general | special | other | footnotes. Count the entries.`
  Re-fetch with a narrower keyword if text looks cut. Responses are cached ~15 min per URL.
- `.../reststop/exportList?...` and `.../reststop/file?...` (CSV/JSON export, Chapter PDFs) come back as **binary** through WebFetch and can't be used.

### 2.2 Shell network ❌
- `curl` to hts.usitc.gov and rulings.cbp.gov fails (`CONNECT tunnel failed, response 403`, egress allowlist). **Don't retry with other commands.**

### 2.3 Full tree context: needs a human download or a browser
Use one of these, in order:
1. **Browser tool** (built-in browser or Claude in Chrome), if present: open `https://hts.usitc.gov/`, search the 4-digit heading, use **Export → CSV**. Read the browser skill first.
2. **Ask the user** to export the heading (e.g. "9102", "6203") as CSV from hts.usitc.gov and upload it.

CSV format (confirmed): `HTS Number,Indent,Description,Unit of Quantity,General Rate of Duty,Special Rate of Duty,Column 2 Rate of Duty,Quota Quantity,Additional Duties`. **Parent rows have an empty HTS Number**, which is exactly what the API omits. Rates sit on the 8-digit row; 10-digit statistical rows inherit them (their rate cells are blank). The "Additional Duties" column comes back **empty**, so Chapter 99 never appears in it.

### 2.4 Chapter 99 PDF: needs a human download or a browser
- Ask for the **current revision's Chapter 99 PDF** (e.g. `Chapter_99_2026HTSRev20.pdf`, ~818 pages).
- Convert once and search the text:
  ```bash
  pdftotext -layout Chapter_99.pdf ch99.txt
  grep -n "^ *16\. (a)\|^ *17\. (a)\|^ *20\. (a)\|^ *52\.$" ch99.txt   # note boundaries
  grep -n -A9 "^ *9903.05.49 " ch99.txt                              # a heading row (description + rate columns)
  ```
- Note texts come first in the file; the heading/rate table is near the end (9903.05.xx rows ≈ line 43,000+ in Rev 20). Heading rows start at column 0 with the number; their rate columns are laid out to the right ("The duty provided in the applicable subheading + 25%").

### 2.5 CBP rulings (CROSS): needs a human download or a browser
- `https://rulings.cbp.gov/ruling/<NUM>` and `/api/...` return **403** to WebFetch.
- **customsmobile.com is unsafe:** `docview?doc_id=NY+N306836` returned **NY N008044** (a different ruling). Never use a mirror's text without checking that the ruling number *inside* the document matches.
- Workflow:
  1. **Find candidates** with WebSearch, e.g. `CBP ruling 9506.31 complete golf club` or `CBP ruling N306836`. Result titles show ruling numbers and subjects.
  2. **Get the document** through a browser tool, or ask the user to download it from rulings.cbp.gov (PDF or .doc).
  3. **Extract the text:** PDF → `pdftotext -layout file.pdf -`; .doc → `soffice --headless --convert-to txt:Text file.doc` (antiword may fail).
  4. **Check** the ruling number, date, `TARIFF NO.` line, the product description, and the "applicable subheading will be…" sentence.

### 2.6 Other primary sources
- **CBP CSMS #69326983** (unverified research pointer — not cited in the product (removed in v5)): filing guidance for the Chapter 99 U.S. note 52 additional duty (9903.05.xx). Find via WebSearch; a broker reprint was used in earlier research. Prefer cbp.gov.
- Federal Register for proclamations and interim final rules.

---

## 3. Procedure (one product + one origin)

### Step 1: Confirm the revision
Check the HTS release named on hts.usitc.gov, the CSV, or the PDF header ("Harmonized Tariff Schedule of the United States Revision 20 (2026)"). Record it. If it's newer than this spec's Rev 20, re-check §5.

### Step 2: Classify (code → column M)
1. Pick the heading from the product facts. Read the full heading and subheading text, and the Section/Chapter notes when they matter (e.g. Chapter 49 note 1(c) excludes playing cards from printed matter; Chapter 95 note 3 sends parts and accessories with the article).
2. **Walk the tree top-down** with the CSV (§2.3). Choose the branch at every indent level. Typical splits seen:
   - 9101 (precious-metal case) vs **9102** (other); 9102.21 automatic → jewel count → band material
   - 6203.42 "Recreational performance outerwear" vs **"Other"** → men's/boys' → blue denim
   - 8211.92 "With rubber or plastic handles" vs **"Other"**
   - 9503.00.00 suffixes by "children's products" (15 U.S.C. § 2052, age 12 and under) → **.90 "Other"** for 15+ collectibles
   - 8523.49.30 sound only vs **.40** sound + image / proprietary format discs
3. **Record all 10 digits** (8-digit + 2-digit statistical suffix). If a line has no children, the suffix is shown on the line itself (e.g. 9504.40.00.**00**).
4. Watch for **renumbered lines.** If the baseline's code doesn't exist in the current revision, find the line with the same description (observed: 9006.53.**01** → **.02**; 6203.42.**40** → **.45**).
5. Kits/sets: GRI 3(b), classify by essential character (camera + lens → camera).

### Step 3: Base rate (column N)
1. Read **General** on the 8-digit line.
2. **Compound or specific rates** (e.g. `$1.53 each + 4.2% on the case + 9.8% on the strap, band or bracelet`; `0.4¢ each + 6.1%`):
   - Store the **components**, not a flat %.
   - **AVE = total duty $ ÷ customs value**. Example: (1.53 + 0.042×250 + 0.098×50) ÷ 300 = 5.6%.
   - The AVE changes with price; recompute per listing.
3. **Special column:** note programs that include the origin (e.g. `JP` = U.S.–Japan Trade Agreement → Free on 9507.30.60, 9506.31.00). **Default policy: use General** (a DDP estimate shouldn't assume anyone files an FTA claim) and mention the Special rate in the notes. For Japan rows the 12.5% total is the same either way.
4. **Customs value** = transaction value of the goods; itemized international shipping is excluded.
5. Ignore Column 2 (Cuba/North Korea).

### Step 4: Chapter 99 for the origin (columns O, Q)
Do all of these in order.

**4a. Exemptions from the Chapter 99 U.S. note 52 additional duty (9903.05.xx) (headings 9903.05.85–9903.05.92):** check each.

| Heading | Exempts | How to check |
|---|---|---|
| .85 | Goods in transit before 12:01 a.m. ET July 24, 2026 (entered before July 28) | Not relevant for new quotes |
| .86 | Products listed in **note 52(b)** | Grep the 8-digit code inside 52(b) (Rev 20: list includes 8523.51.00, **not** 8523.49) |
| .87 | Particular articles in **note 52(c)** (seeds, fruit…) | Read the list |
| .88 | Civil aircraft and parts, note 52(d) | |
| .89 | Pharmaceutical-use articles, note 52(e) | |
| .90 | Note 52(f): steel/aluminum/copper articles and derivatives **in 9903.82.02/.04–.26**, vehicles and parts, wood products, semiconductors, patented pharma | → do 4c (Section 232) |
| .91 | Humanitarian donations | |
| .92 | **Informational materials**: publications, **films**, posters, records, photographs, tapes, **compact disks, CD-ROMs**, artworks, news wire feeds ("including but not limited to") | Description-based; **no HTS list**. A commercially recorded film/series on Blu-ray qualifies → no add-on |

Exempt headings carry "The duty provided in the applicable subheading" (no add-on). Exempt ≠ duty-free: Section 232 may still apply.

**4b. Origin rule (Chapter 99 U.S. note 52 additional duty (9903.05.xx), effective 12:01 a.m. ET July 24, 2026):**

| Origin | Heading | Rule (read the heading text each time) |
|---|---|---|
| **Japan** | **9903.05.49** if col.1 rate (or **AVE**) **< 12.5%**; **9903.05.48** if ≥ 12.5% | .49 rate column "12.5%" = **total becomes 12.5%** → add-on Q = 0.125 − N. .48 = no change → Q = 0 (e.g. denim 16.6%) |
| **China** | **9903.05.31** | "The duty provided in the applicable subheading **+ 12.5%**" → **additive** → Q = 0.125, **plus** any active legacy China list under note 20 (4d), cumulative per note 52(a) |
| **EU members** | **9903.05.39** if col.1 rate (or **AVE**, note 52(k)) **< 10%**; **9903.05.38** if ≥ 10% | Read 2026-10-09 (user, Rev 20 Ch. 99 PDF): .39 "column 1 less than 10 percent … 10%" (p. 653); note 52(k): AVE = column 1 duty / customs value, and "the sum of the column 1 duty rate and the additional ad valorem rate of duty is 10 percent" (p. 606) → **combined cap**, like JP .49 at 10%. Check the note 52(j)(2) EU exemption list (**9903.05.97**, p. 578) as well as .85–.92. EU 9903.02.xx headings are IEEPA (terminated). Verified so far: **DE** (P14). Each further member state needs its own verified row |
| UK | 9903.05.81 (+10%) | **Not yet read.** Read it before using |

Other countries: search `9903.05` for "articles the product of <country>".

**4c. Section 232 (steel/aluminum/copper), only if the product could be metal:**
1. In ch99.txt, take note 16's range (from `16. (a)` to `17. (a)`) and grep the 8-digit code.
2. If found, identify the subdivision (c)(i)–(xi) it sits under. Rev 20 titles: (i) articles of aluminum, (ii) derivative aluminum, (iii) articles of steel, (iv) derivative steel, (v) copper, (vi) derivative aluminum, (vii) derivative steel, (viii) copper, (ix) derivative aluminum, (x) derivative steel, (xi) derivative steel.
3. Map to the heading (read the row each time):
   - (vi)–(viii), (xi) → **9903.82.09**: "duty provided in the applicable subheading **+ 25%**"; **9903.82.06** (+10%) only if ≥85% of the metal was melted/smelted in the US (note 16(e))
   - (ix)–(x) → 9903.82.07 (total 10%) / .08 if (e) met; otherwise 9903.82.10 (total 15%) / .11 (note 16(f))
   - (c)(i)–(v) → 9903.82.02; UK, Russia, USMCA, motorcycle-part and industrial-parts headings (.04/.05, .14–.17, .20–.26, 9903.85.67/.68) only where their conditions apply
4. **Note 16(c):** the 232 duty applies to the **full customs value**. For articles outside chapters 72/73/74/76 it applies only if the listed metal is **≥15% of the article's weight**.
5. **Note 16(b):** 232 duty is collected **on top of** any FTA/special rate.
6. A 232-covered article is exempt from the 12.5% via 9903.05.90. Total = base + 232 add-on (knife: 6.1% + 25% = 31.1%).
7. A note list mentioning the code doesn't prove the heading still exists. Confirm the **heading row exists in the Rev's tariff table** (e.g. old aluminum list 9903.85.08 still appears in note text, but its heading row is gone in Rev 20, so it isn't collected).

**4d. China legacy lists under U.S. note 20 (2018–19), China only.** The Rev 20 Chapter 99 text never says "Section 301"
(not in note 20 either). Cite heading and note numbers only (e.g. "U.S. note 20(r)/(s)(i)"). No Federal Register citation:
"84 Fed. Reg. 43304" appears in note 20's exclusion paragraphs, not in note 20(r) itself (user, 2026-10-09; rates-v4 refs).
1. Grep the 8-digit code in **note 20**. Identify the subdivision header above the hit and its 9903.88.xx heading.
2. Read that heading row and the subdivision's **compiler's notes**. Example: 9503.00.00 and 9504.50.00 are in note 20(u) → **9903.88.16 (List 4B) "[Compiler's note: provision suspended.]"** → don't add.
3. Note 20 also contains **exclusion** lists (e.g. 20(z) / 9903.88.21). Check whether a hit is an inclusion or an exclusion.
4. If active, add its rate to Q. With two headings, column O lists both ("9903.05.31 + 9903.88.15") and W states each
   "heading +x%" (P13, rates-v3).

**4e. Things that look applicable but aren't (Rev 20 era):**
- **IEEPA tariffs** (9903.01.xx "fentanyl", 9903.02.xx "reciprocal", e.g. 9903.02.30 Japan 15%): still printed in Chapter 99, but **terminated**. *Learning Resources, Inc. v. Trump* (Feb 20, 2026); CBP stopped collecting for entries on or after Feb 24, 2026. Never add them.
- **Section 122** 10% surcharge: expired July 24, 2026.
- Lists for **other countries** (e.g. note 51 / 9903.03.12–.16 = Canada only). Always read who a list applies to before applying it.

### Step 5: Total (column R)
Total = N + Q (+ any active legacy list or 232 add-on already in Q). Sanity checks:
- Japan, non-exempt, non-232: total = max(N, 12.5%).
- China: total = N + 12.5% (+ active legacy list).
- 232 item: total = N + 232 rate.
- .92 informational: total = N.

### Step 6: Ruling cross-check (column U)
1. WebSearch for a ruling on **the same or analogous product and code** (§2.5).
2. Read the holding. Record **Y** (supports the code), **N** (contradicts it; stop and re-classify), or **none**.
3. Rulings are snapshots in time:
   - Their **Chapter 99 lines go stale** (N352819, Sept 2025, cites IEEPA 9903.02.30 Japan 15%; N306836, 2019, cites China 9903.88.15). Use rulings for **classification only**.
   - **Typos happen** (N352819/N359352 body text says "9404.40.0000"; the header `TARIFF NO.` says 9504.40.0000 and the description matches → header wins).
   - Rulings about other products are **analogies**. Say so in the notes (N320537 is a TV-connected fitness console → 9504.50, used for a handheld).
   - A ruling may **reject alternatives**. Note them (N359352 rejected 4911.99.6000 for graded cards).

### Step 7: Record (Verify tab columns)
| Col | Content |
|---|---|
| L | `Y` if the code exists in the current revision and its description fits |
| M | 10-digit code `XXXX.XX.XXXX` |
| N | base as decimal (Free = 0; AVE for compound) |
| O | the Chapter 99 heading actually applied (9903.05.49 / .48 / .31 / .92 / 9903.82.09 …) |
| P | `Y` once all of 9903.05.85–.92 (and note 16 if metal) were checked |
| Q | add-on as decimal (**0.125, not 0.00125**: the cell is %-formatted; type `0.125` or `12.5%`) |
| U | ruling `Y` / `N` / `none` |
| V | verification date |
| W | evidence: revision, line description, rate text, Ch99 heading + note, exemptions checked, ruling number + holding, and any baseline error found |

**Spreadsheet hygiene:** edit names and origins on **Products** (B, D). Verify columns A–K, R–T and X are formulas (green/black); never type into them. Products rows and Verify rows have **different row numbers** (P01 = Products row 3 = Verify row 12). Check the ID in column A before typing.

### Step 8: Engine import notes
- Store compound MFN as components (`specific_components` + percentages), computed per listing price.
- Store add-ons with `program`, `chapter99`, `rule` (`combined_cap` for Japan .49/.48; `additive` for China .31 and 232), the rate, and `exemptions_checked: true` plus refs (note 52(b),(c),(f), note 16, note 20).
- `UNSUPPORTED` for: anything not VERIFIED; claims needing paperwork (9801.00.10 U.S. goods returned); unclear facts (pakkawood knife handles; an unknown 232 subdivision).

---

## 4. When to ask the user (don't guess)
- Physical facts: origin label, age label, tag fiber content, jewel count, handle material, price split.
- Downloads the environment can't make: HTS CSV export, the Chapter 99 PDF, ruling PDFs/.docs (unless a browser tool is available).
- Real judgment calls: say what you'd decide and why, and let the user confirm (e.g. Blu-ray as "informational materials").

---

## 5. Regime facts as of HTS 2026 Rev 20 (re-verify on each new revision)
- De minimis suspended for all countries (EO 14324 eff. Aug 29, 2025; CBP interim final rules made it indefinite eff. June 24, 2026).
- Chapter 99 U.S. note 52 additional duty (9903.05.xx): headings 9903.05.20–.84 by country, exemptions 9903.05.85–.92; effective July 24, 2026; CSMS #69326983 (unverified research pointer — not cited in the product (removed in v5)). (The Rev 20 Chapter 99 text contains neither "Section 301" nor "forced labor" anywhere, note 20 included — checked against the Ch. 99 PDF by the user, 2026-10-09.)
- Japan 9903.05.48/.49 (12.5% combined); China 9903.05.31 (+12.5% additive).
- Section 232 derivatives: note 16; 9903.82.09 = +25% (lists (c)(vi)–(viii), (xi)), full value, ≥15% metal-weight test.
- China legacy lists: U.S. note 20 (Federal Register notices referenced there, e.g. 84 Fed. Reg. 43304). List 4A
  (9903.88.15, +7.5%) active where the line is listed — cumulative with 9903.05.31 per note 52(a); List 4B (9903.88.16)
  suspended.
- IEEPA tariffs terminated (Feb 2026); Section 122 expired July 24, 2026.

---

## 6. Common mistakes (all seen in the reference run)
| Mistake | Correct handling |
|---|---|
| Using a stale 15% "Japan reciprocal" rate | IEEPA ended Feb 2026 → 12.5% combined via 9903.05.49 |
| China "27.5%" (IEEPA + suspended List 4B) | 9903.05.31 +12.5% only, unless a note 20 list is active |
| Treating 12.5% as additive for Japan | It's a **cap/top-up**; base ≥12.5% → no add-on |
| Missing description-based exemption .92 | Blu-ray/film → 0% add-on |
| 8-digit codes in a 10-digit field | Add the statistical suffix |
| Renumbered codes from old sheets | Match by description in the current revision |
| Flat % for compound duties | Store components; compute AVE per price |
| Assuming the Section 232 rate from memory (e.g. "50%") | Read the 9903.82 heading for the code's note 16 subdivision (Rev 20: 25% for (c)(vii) knives) |
| Applying a note-list hit without checking which country/heading it belongs to | Read the subdivision header (Canada note 51, China note 20, UK lists) |
| Trusting WebFetch summaries / mirror sites | Demand verbatim; check ruling numbers inside the document |

---

## 7. Reference results (HTS 2026 Rev 20, verified 2026-10-05)
| ID | Product (origin) | HTS | Base | Ch.99 | Total | Ruling |
|---|---|---|---|---|---|---|
| P01 | Pokémon TCG booster box (JP) | 9504.40.0000 | Free | 9903.05.49 | 12.5% | N352819 (2025) |
| P02 | PSA-graded single card (JP) | 9504.40.0000 | Free | 9903.05.49 | 12.5% | N359352 (2026; rejected 4911.99.6000) |
| P03 | Automatic watch, 21 jewels, steel bracelet (JP) | 9102.21.70 (component reporting: Ch. 91 Stat. Note 1(d), suffixes 10/20/30; no 9102.21.7000 exists; re-verified 2026-10-08) | $1.53 + 4.2% case + 9.8% band (AVE 5.6% @ $300) | 9903.05.49 | 12.5% | none |
| P04 | 35mm SLR + lens (JP) | 9006.53.0205 | Free | 9903.05.49 | 12.5% | none |
| P05 | Articulated PVC figure, 15+ (CN) | 9503.00.0090 | Free | 9903.05.31 (List 4B suspended) | 12.5% | none |
| P06 | Spinning reel >$8.45 (JP) | 9507.30.6000 | 3.9% (JP: Free if claimed) | 9903.05.49 | 12.5% | none |
| P07 | US-made jeans returned (US/JP) | 9801.00.10 | — | — | UNSUPPORTED | — |
| P08 | Men's cotton blue denim jeans (JP) | 6203.42.4511 | 16.6% | 9903.05.48 | 16.6% | none |
| P09 | Handheld game console (CN) | 9504.50.0000 | Free | 9903.05.31 (List 4B suspended) | 12.5% | N320537 (analogy) |
| P10 | Complete golf driver (JP) | 9506.31.0000 | 4.4% (JP: Free if claimed) | 9903.05.49 | 12.5% | N306836 |
| P11 | Kitchen knife, steel, wood handle (JP) | 8211.92.9030 | 0.4¢ + 6.1% | 9903.82.09 (+25%, note 16(c)(vii)); exempt from 12.5% via .90 | 31.1% | none |
| P12 | Recorded anime Blu-ray (JP) | 8523.49.4000 | Free | 9903.05.92 (informational) | 0% | H236026 (not yet read) |
| P13 | Automatic watch, 21 jewels, steel bracelet (CN; verified 2026-10-08, rates-v3) | 9102.21.70 (component reporting) | $1.53 + 4.2% case + 9.8% band (AVE 5.7% @ $280) | 9903.05.31 (+12.5%, note 52) + 9903.88.15 (+7.5%, note 20(r)/(s)(i); not in List 4B; no in-effect exclusion), cumulative per note 52(a) | $72.09 @ $280 (case 230 / band 50) | none |
| P14 | Automatic watch, 21 jewels, steel bracelet (DE; verified 2026-10-09, rates-v4) | 9102.21.70 (component reporting) | $1.53 + 4.2% case + 9.8% band (AVE 5.7% @ $290) | 9903.05.39 (combined 10%, note 52(k)); not in note 52(j)(2) (9903.05.97); no note 52(b) exemption; not in note 16 | 10%: $29.00 @ $290 (case 240 / band 50) = MFN $16.51 + $12.49 | none |
