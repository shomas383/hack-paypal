import { describe, expect, it, vi } from 'vitest';
import { InvoiceStuckError, nextInvoiceStep, runInvoiceFlow, type InvoiceFlowDeps, type InvoiceRow } from './invoiceFlow';

const row = (over: Partial<InvoiceRow>): InvoiceRow => ({ status: 'CREATING', paypalInvoiceId: null, createRequestId: 'C-1', sendRequestId: null, ...over });

function deps(remoteStatus = 'SENT'): InvoiceFlowDeps {
  return {
    create: vi.fn(async () => 'INV-1'),
    saveDraft: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    get: vi.fn(async (id: string) => ({ id, status: remoteStatus })),
    saveStatus: vi.fn(async () => undefined),
    newRequestId: vi.fn(() => 'S-new'),
  };
}

describe('nextInvoiceStep', () => {
  it('a row we just claimed → CREATE; a CREATING row left by an earlier attempt → STUCK (never re-create, spike f)', () => {
    expect(nextInvoiceStep(row({}), { claimedNow: true })).toBe('CREATE');
    expect(nextInvoiceStep(row({}), { claimedNow: false })).toBe('STUCK');
  });

  it('DRAFT → RESUME_DRAFT; SENT or any later PayPal status → DONE', () => {
    expect(nextInvoiceStep(row({ status: 'DRAFT', paypalInvoiceId: 'INV-1', sendRequestId: 'S-1' }), { claimedNow: false })).toBe('RESUME_DRAFT');
    for (const s of ['SENT', 'PAID', 'UNPAID', 'CANCELLED']) {
      expect(nextInvoiceStep(row({ status: s, paypalInvoiceId: 'INV-1' }), { claimedNow: false })).toBe('DONE');
    }
  });
});

describe('runInvoiceFlow', () => {
  it('new: creates once, stores the send request id BEFORE sending, sends, records the PayPal status', async () => {
    const d = deps('SENT');
    const r = await runInvoiceFlow(row({}), { claimedNow: true }, d);
    expect(d.create).toHaveBeenCalledTimes(1);
    expect(d.create).toHaveBeenCalledWith('C-1');
    expect(d.saveDraft).toHaveBeenCalledWith('INV-1', 'S-new');
    expect(vi.mocked(d.saveDraft).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(d.send).mock.invocationCallOrder[0]!);
    expect(d.send).toHaveBeenCalledWith('INV-1', 'S-new');
    expect(d.saveStatus).toHaveBeenCalledWith('SENT');
    expect(r).toMatchObject({ id: 'INV-1', status: 'SENT' });
  });

  it('CREATING left by an earlier attempt: stops with InvoiceStuckError and makes no PayPal call', async () => {
    const d = deps();
    await expect(runInvoiceFlow(row({}), { claimedNow: false }, d)).rejects.toBeInstanceOf(InvoiceStuckError);
    for (const fn of [d.create, d.send, d.get]) expect(fn).not.toHaveBeenCalled();
  });

  it('DRAFT that PayPal already shows as SENT: records SENT and does NOT send again', async () => {
    const d = deps('SENT');
    const r = await runInvoiceFlow(row({ status: 'DRAFT', paypalInvoiceId: 'INV-1', sendRequestId: 'S-1' }), { claimedNow: false }, d);
    expect(d.get).toHaveBeenCalledWith('INV-1');
    expect(d.send).not.toHaveBeenCalled();
    expect(d.create).not.toHaveBeenCalled();
    expect(d.saveStatus).toHaveBeenCalledWith('SENT');
    expect(r.status).toBe('SENT');
  });

  it('DRAFT still a draft at PayPal: sends with the STORED send request id', async () => {
    const d = deps('DRAFT');
    vi.mocked(d.get).mockResolvedValueOnce({ id: 'INV-1', status: 'DRAFT' }).mockResolvedValueOnce({ id: 'INV-1', status: 'SENT' });
    await runInvoiceFlow(row({ status: 'DRAFT', paypalInvoiceId: 'INV-1', sendRequestId: 'S-1' }), { claimedNow: false }, d);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledWith('INV-1', 'S-1');
    expect(d.saveStatus).toHaveBeenLastCalledWith('SENT');
  });

  it('already SENT in our DB: no create, no send — only a read for display', async () => {
    const d = deps('SENT');
    await runInvoiceFlow(row({ status: 'SENT', paypalInvoiceId: 'INV-1', sendRequestId: 'S-1' }), { claimedNow: false }, d);
    expect(d.create).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.get).toHaveBeenCalledTimes(1);
  });
});
