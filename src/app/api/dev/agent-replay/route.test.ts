import { afterEach, describe, expect, it, vi } from 'vitest';
import { devToolsEnabled } from '@/server/devOnly';
import { POST } from './route';

const req = (q = '') => new Request(`http://localhost/api/dev/agent-replay${q}`, { method: 'POST' });

describe('dev-only agent replay', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('devToolsEnabled is false only in production', () => {
    expect(devToolsEnabled('production')).toBe(false);
    expect(devToolsEnabled('development')).toBe(true);
    expect(devToolsEnabled('test')).toBe(true);
  });

  it('returns 404 in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await POST(req());
    expect(res.status).toBe(404);
  });

  it('replays the recorded run as NDJSON outside production (budget first, done last)', async () => {
    const res = await POST(req('?delay=0'));
    expect(res.status).toBe(200);
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as { type: string; proposal?: { delivered_total?: string } });
    expect(events[0]!.type).toBe('budget');
    expect(events.at(-1)).toMatchObject({ type: 'done', proposal: { delivered_total: '$344.00' } });
  });

  it('fixture=ja replays the one-Japanese-watch run: the JA listing found through its HTS description and quoted, DE proposed', async () => {
    const events = (await (await POST(req('?delay=0&fixture=ja'))).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string; name?: string; output?: { results?: { listingId: string; match_source: string }[]; compared?: { listingId: string }[] }; proposal?: { delivered_total?: string } });
    const search = events.find((e) => e.type === 'tool-result' && e.name === 'search_listings')!.output!.results!;
    expect(search.map((r) => [r.listingId, r.match_source])).toEqual([
      ['L-P03', 'title'],
      ['L-P03-B', 'title'],
      ['L-P13', 'title'],
      ['L-P14', 'title'],
      ['L-C-469846d7', 'hts_description'],
    ]);
    expect(events.find((e) => e.type === 'tool-result' && e.name === 'compare_landed_costs')!.output!.compared!.map((r) => r.listingId)).toContain('L-C-469846d7');
    expect(events.at(-1)).toMatchObject({ type: 'done', proposal: { delivered_total: '$344.00' } });
  });

  it('an unknown fixture name is a 400 (names only, never paths)', async () => {
    expect((await POST(req('?fixture=..%2F..%2Fpackage.json'))).status).toBe(400);
  });

  it('fail=N ends with an error event after N events', async () => {
    const events = (await (await POST(req('?delay=0&fail=3'))).text()).trim().split('\n').map((l) => JSON.parse(l) as { type: string });
    expect(events).toHaveLength(4);
    expect(events.at(-1)!.type).toBe('error');
  });
});
