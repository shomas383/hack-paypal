import { describe, expect, it } from 'vitest';
import { orderCapMessage, sessionCapMessage } from './capMessages';

describe('cap refusal messages — numbers computed in code', () => {
  it('per-order cap', () => {
    expect(orderCapMessage({ orderMinor: 45_250n, capMinor: 40_000n })).toBe('This order: $452.50; per-order cap: $400.00.');
  });

  it('session cap: what is already counted, the cap, and this order', () => {
    expect(sessionCapMessage({ alreadyMinor: 72_500n, capMinor: 80_000n, orderMinor: 37_709n })).toBe(
      'Already captured this session: $725.00 of the $800.00 session cap. This order ($377.09) would exceed it.',
    );
  });
});
