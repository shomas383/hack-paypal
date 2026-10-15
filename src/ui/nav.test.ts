// The main navigation: Listings, Agent, Estimate and Seller for every visitor. Seller goes to /seller (passcode sign-in,
// which links the read-only demo while SELLER_PUBLIC_VIEW is on); /seller and /seller/demo both mark it current.
import { describe, expect, it } from 'vitest';
import { MAIN_NAV, ariaCurrent } from './nav';

describe('main navigation', () => {
  it('lists the four sections in order, Seller linking to /seller', () => {
    expect(MAIN_NAV).toEqual([
      { id: 'listings', label: 'Listings', href: '/listings' },
      { id: 'agent', label: 'Agent', href: '/agent' },
      { id: 'estimate', label: 'Estimate', href: '/estimate' },
      { id: 'seller', label: 'Seller', href: '/seller' },
    ]);
  });

  it('marks only the current section', () => {
    expect(MAIN_NAV.map((i) => ariaCurrent(i.id, 'seller'))).toEqual([undefined, undefined, undefined, 'page']);
    expect(MAIN_NAV.map((i) => ariaCurrent(i.id, 'estimate'))).toEqual([undefined, undefined, 'page', undefined]);
    expect(MAIN_NAV.map((i) => ariaCurrent(i.id, undefined))).toEqual([undefined, undefined, undefined, undefined]);
  });
});
