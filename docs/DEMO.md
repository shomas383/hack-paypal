# Demo script (target 2:45, hard max 2:59)
Rule: every screen shown must be real, running software against PayPal sandbox. Generic product names on screen (no trademarks).

0:00–0:25 Problem. "The US ended de minimis for every country. Same vintage Japanese automatic watch, three origins, three real
landed prices." Show comparison card JP / CN / EU with itemized duty lines + source/date footnote.

0:25–0:55 Seller side. Japanese-language listing pasted → classifier returns HTS candidate + confidence + Japanese evidence spans.
A second listing (missing material/age) lands in the review queue (AG Grid console). Reviewer accepts.

0:55–1:45 Buyer agent. Prompt: "vintage automatic diver watch under $400 delivered." Agent searches, compares origins, explains
duties (MFN + Section 301, cited), proposes best option, and ASKS for approval. Human clicks Approve (spend cap visible) →
PayPal sandbox approval popup → order shows item, shipping, and duty (as tax) matching quote → authorized → policy gate passes → captured.

1:45–2:15 Trust moment. Show the pure-LLM answer from the earlier offline test: 15% on Japan rows (stale IEEPA-era rate). Rate engine
flags mismatch: current combined MFN + Section 301 = 12.5% for Japan (CBP CSMS #69326983, effective July 24, 2026).  "LLM for
classification. Verified data for money."

2:15–2:45 Impact + roadmap. Who it's for (small cross-border sellers, AI shopping agents), DDP invoice path (show invoice with duty line
for 5 seconds), roadmap: more destinations, carrier APIs, customs filing, Store Sync once cross-border is supported.

Recording checklist: 1080p, captions, no music or royalty-free, sandbox banners visible, browser zoom 110%, test run twice before recording.