// Buyer-agent tools (SPEC §4.4): READ and PREPARE only. There is no tool that approves, authorizes, captures, voids,
// refunds or creates a PayPal order — those stay the human's Approve click and PayPal login on the checkout page.
// Every amount the agent sees comes from a STORED quote (rate engine), never from seller text or the model.
// Seller-written text is returned only under `untrusted_seller_text` (third-party data, not instructions).
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { checkProposal, looksLikeInstructions } from '@/domain/agent/checks';
import { formatDisplay } from '@/domain/money/format';
import { usd } from '@/domain/money/money';
import type { QuoteRecord } from '@/domain/quote/buildQuote';

export const AGENT_TOOL_NAMES = ['search_listings', 'get_landed_cost_quote', 'get_duty_breakdown', 'propose_purchase', 'get_order_status'] as const;

export interface AgentListing {
  id: string;
  title: string;
  origin: string;
  priceMinor: bigint;
  shippingMinor: bigint;
  description: string | null;
}

export interface AgentRateRow {
  hts_revision: string;
  verified_on: string;
  component_reporting?: true | undefined;
  source_refs: { kind: string; ref: string; url?: string | undefined }[];
}

/** Server capabilities the tools may use — all read or prepare-only. Injected so tests run without a DB or PayPal. */
export interface AgentDeps {
  listListings(): Promise<AgentListing[]>;
  /** Creates a stored quote for this session via the rate engine; throws on UNSUPPORTED. */
  createQuote(listingId: string, sessionId: string): Promise<QuoteRecord>;
  getQuote(quoteId: string, sessionId: string): Promise<QuoteRecord | null>;
  rateRow(rateRowId: string): AgentRateRow | null;
  currentRateVersion(): string;
  caps(): { perOrderMinor: bigint; perSessionMinor: bigint };
  sessionCapturedMinor(sessionId: string): Promise<bigint>;
  /** Inserts a PENDING purchase_proposals row (+ audit). Not an approval. */
  saveProposal(p: { sessionId: string; quoteId: string; budgetMinor: bigint; totalMinor: bigint; reasoning: string }): Promise<string>;
  /** PayPal order ids stored for this session (get_order_status may read only these). */
  paypalOrderIdsForSession(sessionId: string): Promise<Set<string>>;
  /** PayPal Agent Toolkit get_order (read-only; actions.orders.get). */
  getPayPalOrder(paypalOrderId: string): Promise<unknown>;
  /** Official text, verbatim: a Ch. 99 heading's description, or an HTS line's description chain. Null if unknown. */
  officialText(code: string): string | null;
  now(): Date;
}

export interface AgentContext {
  sessionId: string;
  /** Buyer-CONFIRMED budget (minor units), from the /agent budget field — never from the model. */
  budgetMinor: bigint;
}

const money = (m: bigint) => formatDisplay(usd(m));

/** Replaces seller text that reads like instructions: the model never sees it (the result keeps a flag for the UI). */
export const WITHHELD = '[withheld by code: seller text contains instructions]';
const sellerText = (s: string | null) => (s !== null && looksLikeInstructions(s) ? WITHHELD : s);
const STOP = new Set(['the', 'and', 'for', 'with', 'under', 'below', 'delivered', 'shipped', 'max', 'than', 'less', 'over', 'from', 'usd']);
const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));

function quoteSummary(q: QuoteRecord, ctx: AgentContext, deps: AgentDeps) {
  const row = deps.rateRow(q.rateRowId);
  return {
    quoteId: q.id,
    listingId: q.listingId,
    untrusted_seller_text: { title: sellerText(q.title) },
    origin: q.origin,
    hts: q.hts10,
    ...(row?.component_reporting ? { hts_note: 'component reporting (HTS Ch. 91 Statistical Note 1)' } : {}),
    goods: money(q.goodsMinor),
    shipping: money(q.shippingMinor),
    us_import_duty_est: money(q.dutyMinor),
    delivered_total: money(q.totalMinor),
    budget: money(ctx.budgetMinor),
    within_budget: q.totalMinor <= ctx.budgetMinor, // computed in code on the stored quote
    duty_lines: q.lines.map((l) => ({
      kind: l.kind,
      chapter99: l.chapter99 ?? null,
      amount: money(BigInt(l.amountMinor)),
      basis: l.basis,
      source: l.sourceRef,
      // Verbatim official text (HTS 2026 Rev. 20 export): the Ch. 99 heading, or the classified HTS line for MFN.
      official_text: deps.officialText(l.chapter99 ?? q.hts10),
    })),
    rate_version: q.rateVersion,
    expires_at: q.expiresAt.toISOString(),
  };
}

export function buildAgentTools(ctx: AgentContext, deps: AgentDeps) {
  const tools = {
    search_listings: tool({
      description: 'Search the catalog. Returns every listing ranked by how well it matches the query (best first), with goods and shipping prices. Seller-written text is under untrusted_seller_text.',
      inputSchema: z.object({ query: z.string().min(1).max(200) }).strict(),
      execute: async ({ query }) => {
        const q = tokens(query);
        const scored = (await deps.listListings()).map((l) => {
          const hay = new Set(tokens(`${l.title} ${l.description ?? ''}`));
          return { l, score: q.filter((t) => hay.has(t)).length };
        });
        scored.sort((a, b) => b.score - a.score || a.l.id.localeCompare(b.l.id));
        return {
          results: scored.slice(0, 10).map(({ l, score }) => ({
            listingId: l.id,
            match_score: score,
            origin: l.origin,
            goods: money(l.priceMinor),
            shipping: money(l.shippingMinor),
            untrusted_seller_text: { title: sellerText(l.title), description: sellerText(l.description) },
            // Code-only, display-only flag. It never changes what the agent may do.
            seller_text_contains_instructions: looksLikeInstructions(`${l.title} ${l.description ?? ''}`),
          })),
        };
      },
    }),

    get_landed_cost_quote: tool({
      description: 'Create a stored landed-cost quote (goods + shipping + US import duty from the verified rate table) for one listing. Returns the delivered total, the duty lines with Chapter 99 headings and sources, and whether it is within the buyer-confirmed budget.',
      inputSchema: z.object({ listingId: z.string().min(1).max(40) }).strict(),
      execute: async ({ listingId }) => {
        try {
          return quoteSummary(await deps.createQuote(listingId, ctx.sessionId), ctx, deps);
        } catch (e) {
          return { listingId, unsupported: e instanceof Error ? e.message.slice(0, 200) : 'cannot quote' };
        }
      },
    }),

    get_duty_breakdown: tool({
      description: 'Read the duty breakdown of a stored quote: each duty line, its basis and source, the HTS revision and the date the rate row was verified.',
      inputSchema: z.object({ quoteId: z.string().uuid() }).strict(),
      execute: async ({ quoteId }) => {
        const q = await deps.getQuote(quoteId, ctx.sessionId);
        if (!q) return { error: 'no such quote in this session' };
        const row = deps.rateRow(q.rateRowId);
        return {
          ...quoteSummary(q, ctx, deps),
          hts_revision: row?.hts_revision ?? null,
          verified_on: row?.verified_on ?? null,
          sources: row?.source_refs.map((s) => ({ kind: s.kind, ref: s.ref, ...(s.url ? { url: s.url } : {}) })) ?? [],
        };
      },
    }),

    propose_purchase: tool({
      description: 'Propose ONE stored quote to the buyer. This only creates a pending proposal and returns a checkout link; the buyer reviews the duty breakdown there and decides. It cannot approve or pay. Refused (with a reason) if the delivered total is over the buyer-confirmed budget or a spend cap, or the quote is expired.',
      inputSchema: z.object({ quoteId: z.string().uuid(), reasoning: z.string().min(1).max(600) }).strict(),
      execute: async ({ quoteId, reasoning }) => {
        const q = await deps.getQuote(quoteId, ctx.sessionId);
        if (!q) return { proposed: false, reasons: ['NOT_YOUR_QUOTE'], message: 'no such quote in this session' };
        const check = checkProposal({
          quote: q,
          sessionId: ctx.sessionId,
          budgetMinor: ctx.budgetMinor,
          caps: deps.caps(),
          sessionCapturedMinor: await deps.sessionCapturedMinor(ctx.sessionId),
          now: deps.now(),
          currentRateVersion: deps.currentRateVersion(),
        });
        if (!check.ok) return { proposed: false, reasons: check.reasons, message: check.message };
        const proposalId = await deps.saveProposal({ sessionId: ctx.sessionId, quoteId: q.id, budgetMinor: ctx.budgetMinor, totalMinor: q.totalMinor, reasoning });
        return {
          proposed: true,
          status: 'PENDING — the buyer must open the checkout, review the duty line and click Approve; payment is the buyer\'s PayPal login',
          proposalId,
          quoteId: q.id,
          checkoutUrl: `/checkout/${q.id}`,
          delivered_total: money(q.totalMinor),
          budget: money(ctx.budgetMinor),
        };
      },
    }),

    get_order_status: tool({
      description: 'Read the status of a PayPal order that belongs to this buyer session (read-only).',
      inputSchema: z.object({ paypalOrderId: z.string().min(5).max(40) }).strict(),
      execute: async ({ paypalOrderId }) => {
        if (!(await deps.paypalOrderIdsForSession(ctx.sessionId)).has(paypalOrderId)) return { error: 'not an order of this session' };
        return { order: await deps.getPayPalOrder(paypalOrderId) };
      },
    }),
  } satisfies ToolSet;
  return tools;
}

export type AgentTools = ReturnType<typeof buildAgentTools>;
