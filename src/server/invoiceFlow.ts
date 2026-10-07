// One PayPal invoice per quote. Invoicing create ignores PayPal-Request-Id (spike f, docs/PAYPAL.md), so a create is
// attempted at most once per quote: a CREATING row left by an earlier attempt stops with InvoiceStuckError instead
// of re-creating. A DRAFT is re-checked at PayPal before any resend. Persistence and PayPal calls are injected.

export interface InvoiceRow {
  status: string; // CREATING | DRAFT | PayPal invoice status (SENT, PAID, …)
  paypalInvoiceId: string | null;
  createRequestId: string;
  sendRequestId: string | null;
}

export interface RemoteInvoice {
  id: string;
  status: string;
}

export interface InvoiceFlowDeps<R extends RemoteInvoice = RemoteInvoice> {
  create(createRequestId: string): Promise<string>;
  /** Persist the PayPal id + the send request id BEFORE the send POST (invariant 7). */
  saveDraft(invoiceId: string, sendRequestId: string): Promise<void>;
  send(invoiceId: string, sendRequestId: string): Promise<void>;
  get(invoiceId: string): Promise<R>;
  saveStatus(status: string): Promise<void>;
  newRequestId(): string;
}

export class InvoiceStuckError extends Error {
  constructor() {
    super('an earlier invoice attempt for this quote did not finish — check PayPal before retrying');
  }
}

export type InvoiceStep = 'CREATE' | 'STUCK' | 'RESUME_DRAFT' | 'DONE';

/** `claimedNow`: this request inserted the CREATING row (unique per quote), so it owns the single create attempt. */
export function nextInvoiceStep(row: InvoiceRow, opts: { claimedNow: boolean }): InvoiceStep {
  if (row.status === 'CREATING') return opts.claimedNow ? 'CREATE' : 'STUCK';
  if (row.status === 'DRAFT') return 'RESUME_DRAFT';
  return 'DONE';
}

export async function runInvoiceFlow<R extends RemoteInvoice>(row: InvoiceRow, opts: { claimedNow: boolean }, deps: InvoiceFlowDeps<R>): Promise<R> {
  const step = nextInvoiceStep(row, opts);
  if (step === 'STUCK') throw new InvoiceStuckError();

  if (step === 'CREATE') {
    const id = await deps.create(row.createRequestId);
    const sendReq = deps.newRequestId();
    await deps.saveDraft(id, sendReq);
    return sendAndRecord(id, sendReq, deps);
  }

  const id = row.paypalInvoiceId;
  if (!id) throw new InvoiceStuckError();
  const remote = await deps.get(id);
  if (step === 'DONE') return remote; // read-only, for display; never create or send again

  // RESUME_DRAFT: an earlier send may have reached PayPal even though we never recorded it.
  if (remote.status !== 'DRAFT') {
    await deps.saveStatus(remote.status);
    return remote;
  }
  let sendReq = row.sendRequestId;
  if (!sendReq) {
    sendReq = deps.newRequestId();
    await deps.saveDraft(id, sendReq);
  }
  return sendAndRecord(id, sendReq, deps);
}

async function sendAndRecord<R extends RemoteInvoice>(id: string, sendReq: string, deps: InvoiceFlowDeps<R>): Promise<R> {
  await deps.send(id, sendReq);
  const got = await deps.get(id);
  await deps.saveStatus(got.status);
  return got;
}
