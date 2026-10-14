// Public read-only seller view (SPEC §4.5): off unless SELLER_PUBLIC_VIEW=1. Reads only; every payload goes through the
// allowlist projections in src/domain/seller/publicView.ts. No seller session is read or created.
import { toPublicDetail, toPublicLedgerRow, toPublicQueueRow, type PublicDetail, type PublicLedgerRow, type PublicQueueRow } from '@/domain/seller/publicView';
import { CheckoutError } from '../checkout';
import { serverEnv } from '../env';
import { ordersLedger } from './ledger';
import { reviewDetail, reviewQueue } from './review';

export function sellerPublicViewEnabled(): boolean {
  return serverEnv().sellerPublicView;
}

function requirePublicView(): void {
  if (!sellerPublicViewEnabled()) throw new CheckoutError(404, 'not found');
}

export async function publicQueue(): Promise<PublicQueueRow[]> {
  requirePublicView();
  return (await reviewQueue()).map(toPublicQueueRow);
}

export async function publicLedger(): Promise<PublicLedgerRow[]> {
  requirePublicView();
  return (await ordersLedger()).map(toPublicLedgerRow);
}

export async function publicDetail(id: string): Promise<PublicDetail> {
  requirePublicView();
  return toPublicDetail(await reviewDetail(id, { readOnly: true }));
}
