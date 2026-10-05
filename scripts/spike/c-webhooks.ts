// Spike (c): webhook receipt + verification via postback, idempotent by event id.
// Source: Webhooks v1 schema.json (developer.paypal.com/api/webhooks/v1/schema.json, fetched 2026-10-05):
//   verify-webhook-signature req {auth_algo, cert_url, transmission_id, transmission_sig, transmission_time,
//   webhook_id, webhook_event} → 200 {verification_status: SUCCESS|FAILURE};
//   simulate-event req {webhook_id, event_type*, resource_version?} → 202 event.
// Setup: `cloudflared tunnel --url http://localhost:8787`, register https://<tunnel>/ as a webhook in the
// sandbox app (events from PAYPAL.md § Webhooks), put its id in PAYPAL_WEBHOOK_ID, then run spike (a) in
// another terminal to generate real events.
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { type Check, check, issuesOf, loadEnv, log, ok, paypalRequest, report, sleep } from './_lib';

const PORT = 8787;

interface WebhookEvent {
  id: string;
  event_type: string;
}

interface Delivery {
  headers: IncomingHttpHeaders;
  raw: string;
}

export async function run(args: string[]): Promise<void> {
  const env = loadEnv();
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID is empty — register the tunnel URL in the sandbox app first');
  const minutes = Number(args[0] ?? 15);

  const seen = new Map<string, { type: string; verification: string; simulated: boolean }>();
  let duplicates = 0;
  let firstDelivery: Delivery | undefined;
  const simEvent = { id: undefined as string | undefined }; // set after simulate-event; read by handle()

  async function handle(d: Delivery): Promise<void> {
    const event = JSON.parse(d.raw) as WebhookEvent;
    if (seen.has(event.id)) {
      duplicates++;
      log(`duplicate delivery of ${event.id} ignored (idempotent by event id)`);
      return;
    }
    const h = (k: string) => String(d.headers[k] ?? '');
    const v = await paypalRequest<{ verification_status?: string }>('POST', '/v1/notifications/verify-webhook-signature', {
      body: {
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: webhookId,
        webhook_event: event,
      },
    });
    const verification = ok(v.status) ? (v.body.verification_status ?? '?') : `HTTP ${v.status} ${issuesOf(v.body)}`;
    seen.set(event.id, { type: event.event_type, verification, simulated: event.id === simEvent.id });
    log(`event ${event.id} ${event.event_type} → ${verification}${event.id === simEvent.id ? ' (simulated)' : ''}`);
  }

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      res.writeHead(200).end(); // ack fast; process after
      if (req.method !== 'POST' || !raw) return;
      const delivery = { headers: req.headers, raw };
      firstDelivery ??= delivery;
      handle(delivery).catch((e: unknown) => log(`handler error: ${String(e)}`));
    });
  });
  await new Promise<void>((r) => server.listen(PORT, r));
  console.log(`\n>>> Listening on :${PORT}. Tunnel: cloudflared tunnel --url http://localhost:${PORT}`);

  // Simulator event: delivered to the registered URL; postback verification is expected NOT to work (PAYPAL.md).
  const sim = await paypalRequest<{ id?: string }>('POST', '/v1/notifications/simulate-event', {
    body: { webhook_id: webhookId, event_type: 'PAYMENT.AUTHORIZATION.CREATED' },
  });
  simEvent.id = sim.body?.id;
  log(`simulate-event → HTTP ${sim.status} id=${simEvent.id ?? issuesOf(sim.body)}`);

  console.log(`>>> Now run \`pnpm spike:a\` in another terminal. Waiting up to ${minutes} min for a real verified event…\n`);
  const isRealVerified = () => [...seen.values()].some((e) => !e.simulated && e.verification === 'SUCCESS');
  const deadline = Date.now() + minutes * 60_000;
  while (!isRealVerified() && Date.now() < deadline) await sleep(1000);
  await sleep(3000); // let in-flight deliveries finish

  // Dedupe check: replay the first delivery into the same handler.
  if (firstDelivery) await handle(firstDelivery);
  server.close();

  const real = [...seen.entries()].filter(([, e]) => !e.simulated);
  const simulated = [...seen.values()].find((e) => e.simulated);
  const checks: Check[] = [
    check('real event received', real.length > 0, real.map(([id, e]) => `${e.type}(${id})`).join(', ') || 'none'),
    check('real event verified via postback (SUCCESS)', isRealVerified(),
      real.map(([, e]) => `${e.type}=${e.verification}`).join(', ') || 'none'),
    check('duplicate delivery deduped by event id', duplicates > 0, `${duplicates} duplicate(s) ignored`),
    { name: 'simulator event postback result', status: 'INFO',
      detail: simulated ? simulated.verification : `not delivered (simulate HTTP ${sim.status})` },
  ];
  report('spike (c) webhooks', checks);
}
