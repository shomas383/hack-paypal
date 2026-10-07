import { formatDisplay } from '@/domain/money/format';
import { usd } from '@/domain/money/money';
import { listListings } from '@/server/checkout';

export const dynamic = 'force-dynamic';

export default async function ListingsPage() {
  const rows = await listListings();
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 760, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Listings</h1>
      <p>Sandbox demo. Shipping is a flat $25.00 demo rate, not a carrier quote.</p>
      <ul data-testid="listings" style={{ listStyle: 'none', padding: 0 }}>
        {rows.map((l) => (
          <li key={l.id} data-testid={`listing-${l.id}`} style={{ border: '1px solid #ccc', padding: '0.75rem', marginBottom: '0.5rem' }}>
            <strong>{l.title}</strong>
            <div>
              Origin {l.origin} · HTS {l.hts10} · {formatDisplay(usd(l.priceMinor))} + {formatDisplay(usd(l.shippingMinor))} shipping
            </div>
            <form method="post" action="/api/quotes">
              <input type="hidden" name="listingId" value={l.id} />
              <button type="submit" data-testid={`quote-${l.id}`}>Get landed cost</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
