# Wireframes (text): Landed

Approved 2026-10-10. These wireframes use real data only: rates-v4 and the seeded listings. Widths: the app is at most
1200 px wide and checkout at most 720 px. Existing `data-testid`s are kept.

The **provenance pattern** is a summary row such as "9903.05.39 · combined cap 10% · $12.49". The official heading text,
the sources, the rate version and the verified date sit one disclosure away ("Official text and sources").

## Shared frame
- A top bar 48 px tall with a 1 px bottom rule.
- On the left, the wordmark "Landed" (text only) and the label "Sandbox" (warning colour, plain text, no pill).
- On the right, the links "Listings · Agent · Seller". "Seller" appears only while a seller session is active.

---

## 1. /agent

**Regions, in order**
1. **Title.** H1 "Shopping agent". Sub-line: "Compares delivered prices (goods, shipping and estimated US import duty) and
   prepares a purchase for you to approve."
2. **Request** (no card; a 1 px rule below).
   - Fields:
     - "What are you looking for?": a textarea that starts with "automatic diver watch under $400 delivered".
     - "Budget, delivered (USD)": an input that starts with "400.00", with a "$" prefix.
   - Help text: "Delivered = goods + shipping + estimated US import duty. The budget and spend caps are checked in code;
     the agent can't change them."
   - Actions:
     - Secondary button "Confirm budget". After the buyer confirms, it's replaced by success text with an icon, "Budget
       confirmed: $400.00 delivered", and a ghost button "Change".
     - Primary button "Run comparison". It stays disabled until the budget is confirmed, with the reason underneath:
       "Confirm the budget to run the comparison."
3. **Transcript** (`role="log"`). There's no aria-live on the node that receives streamed text. It's an ordered list of
   steps, and each **ToolCallStep** is one row: a status icon, a verb and object, and a right-aligned meta column. Details
   sit underneath, with no card.
   - **Step 1.** "Searched listings for “automatic diver watch”" · meta "4 of 9 match".
     - Table, caption "Matching listings". Columns: Listing (mono) · Origin · Goods (USD) · Shipping (USD).

       | Listing | Origin | Goods (USD) | Shipping (USD) |
       |---|---|---:|---:|
       | L-P03 | JP | 300.00 | 25.00 |
       | L-P03-B | JP | 380.00 | 25.00 |
       | L-P13 | CN | 280.00 | 25.00 |
       | L-P14 | DE | 290.00 | 25.00 |

     - Below it, a code-generated notice (warning text with an icon, no fill): "1 listing contained seller instructions;
       withheld." (from `instructionNotice()`).
   - **Step 2.** "Quoted 4 listings" · meta "rate version 2026-rev20-v4". **QuotesTable**, caption "Landed-cost quotes,
     sorted by delivered total". Money headers carry "(USD)".

     | Listing | Origin | HTS | Goods | Shipping | Duty (est.) | Delivered | Budget |
     |---|---|---|---:|---:|---:|---:|---|
     | L-P14 | DE | 9102.21.70 | 290.00 | 25.00 | 29.00 | 344.00 | ✓ Within |
     | L-P03 | JP | 9102.21.70 | 300.00 | 25.00 | 37.50 | 362.50 | ✓ Within |
     | L-P13 | CN | 9102.21.70 | 280.00 | 25.00 | 72.09 | 377.09 | ✓ Within |
     | L-P03-B | JP | 9102.21.70 | 380.00 | 25.00 | 47.50 | 452.50 | ✗ Over by 52.50 |

     - The Budget column always shows text and an icon (check-circle in success colour, x-circle in danger colour).
     - "Over by" is computed in code from the stored totals.
     - **InsightLine.** Computed in code by the pure function `priceInsight(rows)`, and shown only when the lowest goods
       price isn't the lowest delivered total. It uses within-budget OK quotes and integer minor units. Copy: "Lowest
       goods price: L-P13 (CN) $280.00 → delivered $377.09 · Lowest delivered: L-P14 (DE) $344.00".
   - **Step 3.** "Read the duty breakdown for L-P14 (DE)". **DutyBreakdown** rows:
     - "MFN · 9102.21.70 · $1.53 each + 4.2% case + 9.8% band · $16.51"
     - "9903.05.39 · combined cap 10% · $12.49"
     - Total row: "US import duty (est.) · $29.00" (top rule, weight 600).

     Each row has a Disclosure, "Official text and sources", that opens to:
     - The quoted official text. For 9903.05.39: "Except for products described in headings 9903.05.85–9903.05.92 and
       9903.05.97, articles the product of a member state of the European Union, with an ad valorem (or ad valorem
       equivalent) rate of duty under column 1 less than 10 percent, as provided for in U.S. note 52 to this subchapter".
     - The sources: U.S. note 52(k); CSMS #69326983.
     - "HTS 2026 Rev. 20 · verified 2026-10-09 · rate version 2026-rev20-v4".
   - **Step 4.** "Prepared a purchase for L-P14 (DE)", which leads to region 4.
   - **Agent text.** Streams between the steps as plain paragraphs, labelled "Agent's explanation" once. Only
     `**bold**` is rendered.
4. **ProposalSummary.** The only bordered block on the page: 1 px border, 8 px radius, white.
   - Heading: "Proposed purchase, not yet approved".
   - "L-P14 (DE) · Automatic diver watch, 21 jewels, stainless case, steel bracelet (Germany)".
   - "Delivered $344.00 · within your confirmed budget of $400.00", followed by the estimate/DDP sentence.
   - The agent's reasoning, behind a Disclosure labelled "Agent's reasoning".
   - Primary link-button: "Review and approve at checkout".
   - Secondary text: "Nothing is bought until you approve and pay with your own PayPal login."
   - **When code refuses the proposal:** the heading becomes "Purchase not prepared", followed by the code's message
     verbatim with a danger icon, for example "This order: $452.50; per-order cap: $400.00." There's no action, and the
     quotes table stays.
5. **Footer meta** (muted, 12 px): "5 steps · 14.4 s · 27,563 input / 1,418 output tokens".
6. **A visually hidden `role="status"`**, announced once when the run finishes: "Found 4 quotes, 3 within budget.
   Prepared a purchase for L-P14 at $344.00."

**States**

| State | What the buyer sees |
|---|---|
| Idle | Regions 1–2 only. |
| Budget missing | Help text: "Enter a budget to continue. The agent can't run without one." Run is disabled. |
| Budget invalid | Error under the field: "Enter an amount like 400.00." |
| Running | The Run button reads "Running comparison…": same width, spinner icon, disabled. A step row appears as soon as its tool call arrives. A skeleton of the final table (4 rows) shows after 200 ms. |
| Streaming text | Appended to the current paragraph. No caret animation. |
| Partial | A quote that comes back UNSUPPORTED stays in the table: "No verified rate for this origin and HTS line, so no quote." (muted, info icon). Its Delivered cell is "—" with the label "Unavailable". |
| Request error | A `role="alert"` above the transcript: "The comparison stopped: <what happened>. Run it again; nothing was bought." Run is enabled again. |
| Rate limited (429) | "You've reached the limit of 5 agent runs per hour for this session. Try again later." The numbers come from the server's message. |
| Tool error | That step's icon turns danger and its detail reads "This step failed: <message>." The other steps stay. |
| Done | The footer appears and the status message is announced. |

---

## 2. Checkout (/checkout/[quoteId], at most 720 px)

**Regions, in order**
1. A "Listings" back link, then H1 "Review landed cost".
2. **Agent banner.** Shown only when a proposal exists: `role="note"`, an accent-subtle left rule, no filled box. Copy:
   "Proposed by your agent. Delivered total $344.00, within your confirmed budget of $400.00. Review the duty lines below.
   Approving and paying are up to you."
3. **Item.** H2 is the title (`title`). Meta line: "Origin DE · HTS 9102.21.70 (component reporting, HTS Ch. 91 Statistical
   Note 1)".
4. **LandedCostLedger.** A native `<table>` (`breakdown`) with the caption "Landed cost (USD)". Header cells use
   `scope="col"`, and each row label is a `<th scope="row">`.

   | Item | Amount (USD) |
   |---|---:|
   | Goods (customs value) | 290.00 |
   | Shipping (flat demo rate, not a carrier quote) | 25.00 |
   | US import duty (est.) · MFN · 9102.21.70 | 16.51 |
   | US import duty (est.) · 9903.05.39 · combined cap 10% | 12.49 |
   | **Total** | **344.00** |

   - Every duty row has the "Official text and sources" Disclosure.
   - The Total row is weight 600 with a 1 px strong top rule (`total`).
   - These testids are kept: `goods`, `shipping`, `duty-line`, `duty` (the duty subtotal), `hts`, `ch99`,
     `component-reporting`, `official-text`, `duty-line-item`.
   - CN, with three duty lines: MFN 16.09 · 9903.05.31 +12.5% 35.00 · 9903.88.15 +7.5% 21.00 · duty subtotal 72.09 ·
     Total 377.09.
5. **Estimate sentence** (`disclaimer`): "Includes US import duty, estimated from verified rates and paid here at checkout
   (delivered duty paid). It's an estimate, not a customs ruling. Rate version 2026-rev20-v4 · HTS 2026 Rev. 20 · verified
   2026-10-09. Quote expires at 14:39 (your time)." The time is the buyer's local time.
6. **Approve.** A primary near-black button (`approve`), "Approve $344.00 purchase", with "Per-order cap: $400.00"
   (`spend-cap`) beside it.
   - While approving, the button keeps its label, shows a spinner and is disabled.
   - If approval is refused, a `role="alert"` under the button shows the code's message verbatim, for example "Approval
     refused. This order: $452.50; per-order cap: $400.00.", plus a link "Back to listings".
7. **After approval.** "Approved at 14:26. Pay with PayPal to authorize the payment." Then "You'll pay $344.00 in the
   PayPal window." above the PayPal host (`paypal-button-container`), which shows a 44 px skeleton while the SDK loads.
8. **Outcome** (`outcome`).
   - CAPTURED: "Payment captured · $344.00 · capture <id>" (the id in mono), then "Policy checks passed."
   - VOIDED: "Payment voided, nothing was charged. Reason: <plain text> (<CODE> in mono)."
9. **Below a rule.** A secondary button, "Send DDP invoice instead", with the invoice result restyled underneath.

**States**

| State | What the buyer sees |
|---|---|
| Quote expired | "This quote has expired. Get a new quote from the listing." with a link to the listing. |
| PayPal not eligible | "PayPal isn't available in this browser. Try another browser or send a DDP invoice instead." |
| PayPal window closed | "PayPal window closed. Nothing was charged." |
| PayPal error | "PayPal reported an error: <msg>. Nothing was charged; try again." |
| Completing | "Authorizing and running the policy checks…" |
| 404 | "Quote not found. Quotes belong to the browser session that created them." with a link to Listings. |

---

## 3. /seller (at most 1200 px)

The URL holds the current tab, filter and selection, for example `?tab=classify|review|orders&status=…&row=<id>`.

### Access
- H1 "Seller console". A "Passcode" password field and the button "Open seller console".
- Wrong passcode: "That passcode isn't correct. 4 attempts left this hour."
- Locked out: "Too many attempts. Try again in 15 minutes."

### Classify tab
- **Form fields:**
  - Title (required).
  - Description (optional), hint "Any language, including Japanese."
  - Origin: a select with Japan, China, Germany, or "Unknown".
  - Price (USD).
  - Shipping (USD).
- **Actions:** primary "Classify listing", plus the demo links "Use sample: Japanese watch listing" and "Use sample: denim
  jeans".
- **ClassificationProgress** (the page polls every 1 s). Each step shows done, active or pending as text plus an icon:
  1. "Proposing headings…", then "Proposed n headings: …"
  2. "Matching official Rev 20 lines…", then "Matched n official lines"
  3. "Choosing a line…", then "Chose <code> · confidence <x.xx>"
- **Result:**
  - "Proposed: <code>", with the full official chain in a Disclosure.
  - Confidence as a number with a small bar.
  - Status "Auto-accepted" or "Needs review", with each reason in plain words:

    | Reason code | Shown as |
    |---|---|
    | LOW_CONFIDENCE | "Confidence 0.62 is below the 0.80 threshold" |
    | MISSING_ATTRIBUTES | "The listing doesn't say: <attribute>" |
    | TOP2_DIFFER_6 | "The top two candidates are in different subheadings" |
    | ANSWER_CONTRADICTS | "Your answer rules out the proposed line" |

  - Evidence: quoted spans from the listing, each one checked by code.
- **Seller questions.** These are generated by code from the official chains, never by the model.
  - **(a) Choice questions:** "Which description matches the item?" The options are the official texts at the first
    level where the remaining candidates differ, plus "None of these".
  - **(b) Rare exclusions:** a single checkbox, "None of these apply to this item." It lists the other official lines
    under the top candidate's subheading.
  - The answers are stored as seller statements, and the routing then reruns in code.
  - An optional secondary button, "Re-check with seller answers", makes a live call and is labelled with its cost.

### Review queue tab (AG Grid)
- **Columns:** Listing · Origin · Top code (mono) · Confidence (number + bar) · Reasons · Status · Seller answers ·
  Updated.
- **Grid controls:** filter, sort, and a "Search listings" quick filter.
- **Opening a row** shows a side panel, not a modal, with:
  - the candidates, each with its full chain, confidence and verified evidence
  - the seller statements
  - an audit trail, e.g. "Classified 14:02 · Answered 14:05 · Accepted 14:06 by seller session …a1f3"
- **Actions:**
  - **Accept classification:** optimistic, with a 6 s toast "Accepted 9102.21.70. Undo".
  - **Override code…:** only codes from that run's expanded Rev 20 list are allowed, and a reason is required. Also
    optimistic with Undo.
  - **Publish listing…:** a confirm dialog. It also asks for the case/band value split when the rate row is compound.
    There's no undo.
- **Publishing:**
  - Confirm text: "Publish ‘…’ as <code>? It becomes quotable only if a verified rate row exists for <origin> + <code>."
  - Then either "Quotable: $362.50 delivered at $300.00" or "No verified rate yet. Buyers will see the listing without a
    price until one is verified."
- **Empty states:**
  - Nothing to review: "Nothing needs review. New classifications that need a decision appear here."
  - No classifications at all: "No classifications yet. Classify a listing to start."

### Orders and duty tab (AG Grid)
- **Columns:** Date · Listing · Goods (USD) · Shipping (USD) · Duty (USD) · Total (USD) · HTS · Ch. 99 headings · Rate
  version · Status (text + icon) · PayPal order (mono).
- A pinned bottom row sums the captured duty, computed in code.
- Action: "Export CSV".
- Empty: "No orders yet. Orders appear after a buyer approves and pays at checkout."
- Loading: "Loading orders…"

---

## 4. /listings and /
- **/listings:** one row per listing: Title · Origin · HTS (mono) · Goods (USD) · Shipping (USD) · a "Get landed cost"
  button (`quote-<id>`).
  - The note above the list: "Shipping is a flat $25.00 demo rate, not a carrier quote."
  - Empty: "No listings yet."
  - A published listing without a verified rate shows "No verified rate yet" instead of the button.
- **/:** H1 "Landed" and one sentence: "Duty-aware checkout for cross-border purchases on PayPal. Sandbox only." Then
  links: "Browse listings" · "Shopping agent" · "Seller console".
