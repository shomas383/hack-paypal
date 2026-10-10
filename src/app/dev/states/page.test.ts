import { afterEach, describe, expect, it, vi } from 'vitest';
import DevStatesPage from './page';

describe('/dev/states', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is a 404 in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => DevStatesPage()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it('renders outside production', () => {
    expect(DevStatesPage()).toBeTruthy();
  });
});
