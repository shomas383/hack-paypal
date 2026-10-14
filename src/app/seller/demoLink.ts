// The sign-in page's pointer to the public read-only demo (SELLER_PUBLIC_VIEW=1); null hides it.
export function demoLinkFor(publicView: boolean): { href: '/seller/demo'; text: string } | null {
  return publicView ? { href: '/seller/demo', text: 'No passcode? See the read-only demo →' } : null;
}
