// The /seller sign-in page links to the public read-only demo only while SELLER_PUBLIC_VIEW is on.
import { describe, expect, it } from 'vitest';
import { demoLinkFor } from './demoLink';

describe('demoLinkFor', () => {
  it('no link while the public view is off', () => {
    expect(demoLinkFor(false)).toBeNull();
  });

  it('links to /seller/demo while it is on', () => {
    expect(demoLinkFor(true)).toEqual({ href: '/seller/demo', text: 'No passcode? See the read-only demo →' });
  });
});
