// Production AgentDeps: Postgres + the rate engine + the read-only PayPal toolkit. Read / prepare only — this module
// imports no approval, order, authorize, capture, void or invoice function (src/agent/noMoneyTools.test.ts).
import { and, eq, isNotNull } from 'drizzle-orm';
import { createQuote, findQuoteForSession, listListings, sessionCapturedMinor } from '@/server/checkout';
import { db } from '@/server/db/client';
import { auditLog, orders, purchaseProposals, quotes } from '@/server/db/schema';
import { serverEnv } from '@/server/env';
import { currentCh99, currentHtsIndex } from '@/server/hts';
import { currentRateTable } from '@/server/rates';
import { readOnlyToolkit } from './paypalReadOnly';
import type { AgentDeps } from './tools';

let toolkit: ReturnType<typeof readOnlyToolkit> | undefined;

export function agentDeps(): AgentDeps {
  return {
    listListings: async () =>
      (await listListings()).map((l) => ({
        id: l.id,
        title: l.title,
        origin: l.origin,
        hts10: l.hts10,
        priceMinor: l.priceMinor,
        shippingMinor: l.shippingMinor,
        description: l.description,
        sellerPublished: l.sheetRef === 'CLASSIFIER', // published from the seller console (src/domain/classifier/publish.ts)
        createdAt: l.createdAt,
      })),
    createQuote,
    getQuote: findQuoteForSession,
    rateRow: (rateRowId) => {
      const r = currentRateTable().rows.find((x) => x.id === rateRowId);
      return r ? { hts_revision: r.hts_revision, verified_on: r.verified_on, component_reporting: r.component_reporting, source_refs: r.source_refs } : null;
    },
    currentRateVersion: () => currentRateTable().version,
    caps: () => ({ perOrderMinor: serverEnv().spendCapPerOrderMinor, perSessionMinor: serverEnv().spendCapPerSessionMinor }),
    sessionCapturedMinor,
    saveProposal: async (p) => {
      const [row] = await db
        .insert(purchaseProposals)
        .values({ sessionId: p.sessionId, quoteId: p.quoteId, budgetMinor: p.budgetMinor, totalMinor: p.totalMinor, status: 'PENDING', reasoning: p.reasoning })
        .returning({ id: purchaseProposals.id });
      await db.insert(auditLog).values({
        event: 'agent.proposal',
        entity: 'quote',
        entityId: p.quoteId,
        sessionId: p.sessionId,
        data: { proposalId: row!.id, budgetMinor: String(p.budgetMinor), totalMinor: String(p.totalMinor) },
      });
      return row!.id;
    },
    paypalOrderIdsForSession: async (sessionId) => {
      const rows = await db
        .select({ id: orders.paypalOrderId })
        .from(orders)
        .innerJoin(quotes, eq(orders.quoteId, quotes.id))
        .where(and(eq(quotes.sessionId, sessionId), isNotNull(orders.paypalOrderId)));
      return new Set(rows.map((r) => r.id!));
    },
    getPayPalOrder: async (id) => {
      toolkit ??= readOnlyToolkit({ clientId: serverEnv().paypalClientId, clientSecret: serverEnv().paypalClientSecret });
      return toolkit.getOrder(id);
    },
    officialText: (code) => (code.startsWith('9903.') ? (currentCh99().headings[code] ?? null) : (currentHtsIndex().chains.get(code)?.join(' > ') ?? null)),
    htsChain: (code) => currentHtsIndex().chains.get(code) ?? null,
    now: () => new Date(),
  };
}
