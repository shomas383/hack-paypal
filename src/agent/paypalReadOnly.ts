// PayPal Agent Toolkit, READ-ONLY. @paypal/agent-toolkit@1.11.0 gates each tool by configuration.actions.<group>.<action>
// (read from the installed ai-sdk/index.js, 2026-10-08). Only get_order ← actions.orders.get is enabled. Never enabled:
// create_order (orders.create), pay_order (orders.capture), create_refund, accept_dispute_claim, invoice/subscription
// writes. The toolkit's tools are AI SDK v4 tools, so we call get_order's execute ourselves (spike d) — the model only ever
// sees our v7 get_order_status tool, which also restricts the order id to this buyer session.
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';

export const TOOLKIT_ACTIONS = { orders: { get: true } } as const;

type V4Execute = (args: { id: string }, opts: { toolCallId: string; messages: unknown[] }) => Promise<unknown>;

export function readOnlyToolkit(creds: { clientId: string; clientSecret: string }) {
  const toolkit = new PayPalAgentToolkit({ clientId: creds.clientId, clientSecret: creds.clientSecret, configuration: { actions: TOOLKIT_ACTIONS, context: { sandbox: true } } });
  const tools = toolkit.getTools() as unknown as Record<string, { execute?: V4Execute }>;
  return {
    toolNames: Object.keys(tools),
    async getOrder(id: string): Promise<unknown> {
      const execute = tools.get_order?.execute;
      if (!execute) throw new Error('toolkit get_order is not available');
      return execute({ id }, { toolCallId: `get_order_${id}`, messages: [] });
    },
  };
}
