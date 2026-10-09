import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeDeps } from './fakeDeps';
import { readOnlyToolkit, TOOLKIT_ACTIONS } from './paypalReadOnly';
import { AGENT_TOOL_NAMES, buildAgentTools } from './tools';

const MONEY = /approv|authori[sz]|capture|void|refund|pay_|^pay|create_order|dispute|send_invoice|record_payment/i;

describe('the buyer agent cannot move money', () => {
  it('its tool list is exactly the five read/prepare tools, none of them money-moving', () => {
    const names = Object.keys(buildAgentTools({ sessionId: 's', budgetMinor: 1n }, fakeDeps().deps));
    expect(names.sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    expect(names.filter((n) => MONEY.test(n))).toEqual([]);
  });

  it('the PayPal toolkit is configured with orders.get only and exposes exactly get_order', () => {
    expect(TOOLKIT_ACTIONS).toEqual({ orders: { get: true } });
    const tk = readOnlyToolkit({ clientId: 'test-id', clientSecret: 'test-secret' }); // getTools() makes no network call
    expect(tk.toolNames).toEqual(['get_order']);
    expect(tk.toolNames.filter((n) => MONEY.test(n))).toEqual([]);
  });

  it('no agent source imports a money-moving function', () => {
    const dir = join(process.cwd(), 'src', 'agent');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const forbidden = /\b(approveQuote|startPayPalOrder|completePayPalOrder|captureAuthorization|voidAuthorization|authorizeOrder|createOrder|createInvoice|sendInvoice|sendDdpInvoice|decideCapture|paypalRequest)\b/;
    for (const f of files) expect([f, readFileSync(join(dir, f), 'utf8').match(forbidden)?.[0] ?? null]).toEqual([f, null]);
  });
});
