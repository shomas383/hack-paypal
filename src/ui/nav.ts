// The main navigation (AppShell). Seller is shown to everyone: /seller is the passcode sign-in, which links the public
// read-only demo while SELLER_PUBLIC_VIEW is on; /seller and /seller/demo both pass current="seller".
export type NavId = 'listings' | 'agent' | 'estimate' | 'seller';

export const MAIN_NAV: readonly { id: NavId; label: string; href: string }[] = [
  { id: 'listings', label: 'Listings', href: '/listings' },
  { id: 'agent', label: 'Agent', href: '/agent' },
  { id: 'estimate', label: 'Estimate', href: '/estimate' },
  { id: 'seller', label: 'Seller', href: '/seller' },
];

export function ariaCurrent(id: NavId, current: NavId | undefined): 'page' | undefined {
  return id === current ? 'page' : undefined;
}
