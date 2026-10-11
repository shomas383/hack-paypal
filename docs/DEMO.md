# Demo script (target 2:45, hard max 2:59)
Rule: every screen shown must be real, running software against PayPal sandbox. Generic product names on screen (no trademarks).

0:00–0:25 Problem. "The US ended de minimis for every country. Same automatic diver watch, three origins, three real
landed prices." Show comparison card JP / CN / EU with itemized duty lines + source/date footnote (rates-v4, $25 demo shipping):
- CN $280 → **$377.09** delivered (duty $72.09: MFN $16.09 + 9903.05.31 $35.00 + 9903.88.15 $21.00) — lowest goods price,
  highest delivered total
- DE $290 → **$344.00** (duty $29.00: MFN $16.51 + 9903.05.39 $12.49, EU combined 10%)
- JP $300 → **$362.50** (duty $37.50: MFN $16.93 + 9903.05.49 $20.57, JP combined 12.5%)
- JP-B $380 → **$452.50** (duty $47.50) — over a $400 budget

0:25–0:55 Seller side (`/seller`, before the buyer agent). Paste the Japanese-language watch listing that leaves out the
jewel count ("Use a sample: Japanese watch listing"; JP, $300) → Classify listing → the three real steps tick through
("Proposed 1 heading: 9102.21" → "Matched 6 official lines" → "Chose 9102.21.70") → **Needs review**: confidence below
0.80, "The listing doesn't say: jewel count in movement". Open it in the review queue (AG Grid): the choice question is
built by code from the official HTS chain — pick "Having over 17 jewels in the movement" and confirm "None of these apply"
→ Save answers (the jewel-count reason clears; the routing reran in code) → Accept classification (Undo toast) → Publish
listing… with case $250 / band $50 → "Quotable: **$362.50** delivered at $300.00". Point out: codes come only from the
official schedule; the model never sets a code it wasn't offered or any amount. (Live run 2026-10-10: exactly this.)

0:55–1:45 Buyer agent (`/agent`). Prompt: "automatic diver watch under $400 delivered." Buyer confirms the $400.00 budget.
Agent searches — the search step also lists the seller's Japanese watch just published, under its Japanese title with
"Matched on official HTS description (9102.21.70): … With automatic winding" (official text, no translation; point at it) —
quotes the four English watches (JP / CN / DE / JP-B) and the Japanese listing ($362.50), explains duties (MFN + Chapter 99 U.S. note 52 additional duty
(9903.05.xx), official text quoted, cited), and proposes **L-P14 (DE) at $344.00** as PENDING — the agent can't approve or
pay. Point at the quotes card: CN has the lowest goods price ($280) but the highest delivered total within budget ($377.09);
JP-B is over budget (✗, computed by code). The code-generated notice shows the injected test listing was withheld.
(Live run 2026-10-10 UTC: DE proposed, 5 steps, ~14 s.) The checkout banner reads "Proposed by your agent".
Optional second beat (if time allows): add "vintage" to the prompt. The agent then picks the only listing that claims an
era (L-P03, "1990s", $362.50) and says that the age comes from the seller's listing, not from anything it checked. It
honours stated preferences and doesn't invent product facts (live run 2026-10-10 UTC).
Then the checkout. Checkout shows the landed-cost breakdown with
"US import duty (est.)" + HTS + source BEFORE the PayPal button (PayPal's popup labels it only "Tax"). Human clicks Approve (spend cap visible) →
PayPal sandbox approval popup → order shows item, shipping, and duty (as tax) matching quote → authorized → policy gate passes → captured.

1:45–2:15 Trust moment. Show the pure-LLM answer from the earlier offline test: 15% on Japan rows (stale IEEPA-era rate). Rate engine
flags mismatch: current combined MFN + Chapter 99 U.S. note 52 additional duty (9903.05.xx) = 12.5% for Japan (CBP CSMS #69326983, effective July 24, 2026).  "LLM for
classification. Verified data for money."

2:15–2:45 Impact + roadmap. Who it's for (small cross-border sellers, AI shopping agents), DDP invoice path (show invoice with duty line
for 5 seconds — the invoice shows our "US import duty (est.) – HTS …" label verbatim), roadmap: more destinations, carrier APIs, customs filing, Store Sync once cross-border is supported.

Recording checklist: 1080p, captions, no music or royalty-free, sandbox banners visible, browser zoom 110%, test run twice before recording.