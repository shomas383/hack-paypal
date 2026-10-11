// Same-origin check for public POST routes that spend a model budget (/api/estimates). Browsers send Origin on every POST
// fetch; a request without it, or from another site, is refused. The expected host is PUBLIC_BASE_URL's when set, else the
// request's own. Pure.
export function sameOrigin(req: Request, publicBaseUrl?: string): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    const expected = new URL(publicBaseUrl ?? req.url).host;
    return new URL(origin).host === expected;
  } catch {
    return false;
  }
}
