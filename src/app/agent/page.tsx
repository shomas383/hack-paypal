import { devToolsEnabled } from '@/server/devOnly';
import { AppShell } from '@/ui/AppShell';
import { AgentClient } from './AgentClient';

export const metadata = { title: 'Shopping agent — Landed' };

// ?replay=<query> (dev only) streams the recorded live run from /api/dev/agent-replay instead of calling the model.
// Ignored in production, where the replay endpoint is also a 404.
export default async function AgentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const replay = (await searchParams).replay;
  const endpoint = devToolsEnabled() && typeof replay === 'string' ? `/api/dev/agent-replay?${replay}` : '/api/agent';
  return (
    <AppShell current="agent">
      <AgentClient endpoint={endpoint} />
    </AppShell>
  );
}
