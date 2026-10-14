'use client';
// Orders and duty ledger (AG Grid Community): every sandbox order with its stored quote. Amounts are Money (integer minor
// units) through the shared exact formatter; the pinned row sums captured duty in code; CSV exports exact decimals.
// mode 'public' (the read-only /seller/demo) reads the allowlisted GET-only API; the grid and the CSV are the same.
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ProcessCellForExportParams } from 'ag-grid-community';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toPayPalValue } from '@/domain/money/format';
import { usd, type Money } from '@/domain/money/money';
import { landedGridTheme, moneyColumn } from '@/lib/ag-grid-theme';
import { formatUsd } from '@/lib/money';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { StatusBadge, type Tone } from '@/ui/StatusBadge';
import { registerGridModules } from '@/ui/grid/setup';
import { useNarrow } from '@/ui/grid/useNarrow';
import type { SellerViewMode } from './ReviewQueue';
import s from './seller.module.css';

registerGridModules();

const MONO = s.gridMono ?? '';

interface Api {
  orderId: string;
  date: string;
  listingId: string;
  title: string;
  goodsMinor: string;
  shippingMinor: string;
  dutyMinor: string;
  totalMinor: string;
  hts10: string;
  ch99: string[];
  rateVersion: string;
  status: string;
  paypalOrderId: string | null;
}
interface Row {
  orderId: string;
  date: Date | null;
  listing: string;
  goods: Money | null;
  shipping: Money | null;
  duty: Money | null;
  total: Money | null;
  hts10: string;
  ch99: string;
  rateVersion: string;
  status: string;
  paypalOrderId: string;
  pinned?: boolean;
}

const STATUS: Record<string, { tone: Tone; text: string }> = {
  CAPTURED: { tone: 'success', text: 'Captured' },
  VOIDED: { tone: 'danger', text: 'Voided' },
  AUTHORIZED: { tone: 'info', text: 'Authorized' },
  CREATED: { tone: 'neutral', text: 'Created' },
  CREATING: { tone: 'neutral', text: 'Creating' },
  FAILED: { tone: 'danger', text: 'Failed' },
};

function StatusCell({ value, data }: { value: string; data?: Row }) {
  if (data?.pinned || !value) return null;
  const st = STATUS[value] ?? { tone: 'neutral' as const, text: value };
  return <StatusBadge tone={st.tone}>{st.text}</StatusBadge>;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const ORDERS_URL: Record<SellerViewMode, string> = { owner: '/api/seller/orders', public: '/api/seller/public/orders' };

export function LedgerGrid({ mode = 'owner' }: { mode?: SellerViewMode }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grid = useRef<AgGridReact<Row>>(null);
  const narrow = useNarrow();
  // Listing (the only flex column) keeps real width. The grid is at most 1152 px wide (the app width), so goods, shipping
  // and the PayPal order id live in tooltips (Total, Status) and the CSV; below 1200 px date, HTS and Ch. 99 are dropped
  // too. Rate version is always shown. The CSV always has every column.
  const tablet = useNarrow(1199);

  useEffect(() => {
    let stop = false;
    fetch(ORDERS_URL[mode], { cache: 'no-store' })
      .then(async (res) => {
        const j = (await res.json()) as Api[] | { error?: string };
        if (stop) return;
        if (!res.ok || !Array.isArray(j)) {
          setError(res.status === 401 ? 'Your seller session ended. Reload the page and sign in again.' : mode === 'public' && res.status === 404 ? 'The read-only view is off.' : `Orders didn't load: ${(j as { error?: string }).error ?? res.status}.`);
          setRows([]);
          return;
        }
        setRows(
          j.map((o) => ({
            orderId: o.orderId,
            date: new Date(o.date),
            listing: `${o.listingId} · ${o.title}`,
            goods: usd(BigInt(o.goodsMinor)),
            shipping: usd(BigInt(o.shippingMinor)),
            duty: usd(BigInt(o.dutyMinor)),
            total: usd(BigInt(o.totalMinor)),
            hts10: o.hts10,
            ch99: o.ch99.join(', '),
            rateVersion: o.rateVersion,
            status: o.status,
            paypalOrderId: o.paypalOrderId ?? '',
          })),
        );
      })
      .catch(() => !stop && (setError("Orders didn't load. Check your connection and reload."), setRows([])));
    return () => {
      stop = true;
    };
  }, [mode]);

  // Code-computed: the sum of duty on CAPTURED orders (integer minor units).
  const captured = useMemo(() => (rows ?? []).filter((r) => r.status === 'CAPTURED'), [rows]);
  const capturedDuty = useMemo(() => captured.reduce((a, r) => a + (r.duty?.amountMinor ?? 0n), 0n), [captured]);
  const pinned: Row[] = rows?.length
    ? [{ orderId: 'sum', date: null, listing: `Captured duty, ${captured.length} ${captured.length === 1 ? 'order' : 'orders'}`, goods: null, shipping: null, duty: usd(capturedDuty), total: null, hts10: '', ch99: '', rateVersion: '', status: '', paypalOrderId: '', pinned: true }]
    : [];

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'date', headerName: 'Date', valueFormatter: (p) => (p.value ? dateFmt.format(p.value as Date) : ''), filter: 'agDateColumnFilter', width: 130, sort: 'desc', hide: tablet, tooltipValueGetter: (p) => (p.value ? (p.value as Date).toISOString() : '') },
      // The only flex column: it takes all the remaining width; the full "id · title" shows on hover.
      { field: 'listing', headerName: 'Listing', flex: 1, minWidth: narrow ? 140 : 240, filter: 'agTextColumnFilter', tooltipField: 'listing', cellClass: (p) => (p.data?.pinned ? (s.pinnedLabel ?? '') : '') },
      { ...moneyColumn<Row>('Goods', (r) => r.goods), width: 105, hide: true },
      { ...moneyColumn<Row>('Shipping', (r) => r.shipping), width: 115, hide: true },
      { ...moneyColumn<Row>('Duty', (r) => r.duty), width: narrow ? 90 : 100 },
      { ...moneyColumn<Row>('Total', (r) => r.total), width: 105, hide: narrow, tooltipValueGetter: (p) => (p.data && !p.data.pinned && p.data.goods && p.data.shipping && p.data.duty ? `Goods ${formatUsd(p.data.goods)} · shipping ${formatUsd(p.data.shipping)} · duty ${formatUsd(p.data.duty)}` : '') },
      { field: 'hts10', headerName: 'HTS', width: 125, cellClass: MONO, hide: tablet },
      { field: 'ch99', headerName: 'Ch. 99 headings', width: 145, cellClass: MONO, hide: tablet, tooltipField: 'ch99' },
      // Always shown: legacy orders (rates v1, pre-rekey code 9102.21.7000) are told apart by it.
      { field: 'rateVersion', headerName: 'Rate version', width: narrow ? 125 : 130, cellClass: MONO },
      { field: 'status', headerName: 'Status', width: narrow ? 110 : 120, cellRenderer: StatusCell, filter: 'agTextColumnFilter', tooltipValueGetter: (p) => (p.data?.paypalOrderId ? `PayPal order ${p.data.paypalOrderId}` : '') },
      { field: 'paypalOrderId', headerName: 'PayPal order', width: 190, cellClass: MONO, hide: true },
    ],
    [narrow, tablet],
  );

  const exportCsv = () =>
    grid.current?.api.exportDataAsCsv({
      skipPinnedBottom: true, // data rows only; the captured-duty sum stays in the grid
      allColumns: true, // every column, including those hidden to fit a narrow screen
      fileName: `landed-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      // Exact decimals for money (no "$", no separators); ISO dates.
      processCellCallback: (p: ProcessCellForExportParams) => {
        const v: unknown = p.value;
        if (v && typeof v === 'object' && 'amountMinor' in v) return toPayPalValue(v as Money);
        if (v instanceof Date) return v.toISOString();
        return v === null || v === undefined ? '' : String(v);
      },
    });

  return (
    <div className={s.gridSection}>
      <div className={s.toolbar}>
        <p className={s.muted}>
          {rows === null ? 'Loading orders…' : `${rows.length} ${rows.length === 1 ? 'order' : 'orders'} · captured duty ${formatUsd(usd(capturedDuty))}`}
        </p>
        <Button size="sm" onClick={exportCsv} disabled={!rows?.length} data-testid="ledger-export">
          Export CSV
        </Button>
      </div>
      {error ? (
        <p role="alert" className={s.error}>
          <Icon name="x-circle" />
          <span>{error}</span>
        </p>
      ) : null}
      <div className={s.gridWrap} data-testid="ledger-grid">
        <AgGridReact<Row>
          ref={grid}
          theme={landedGridTheme}
          rowData={rows ?? []}
          loading={rows === null}
          columnDefs={columns}
          pinnedBottomRowData={pinned}
          getRowId={(p) => p.data.orderId}
          domLayout="autoHeight"
          suppressCellFocus={false}
          tooltipShowDelay={400}
          overlayLoadingTemplate='<span class="ag-overlay-loading-center">Loading orders…</span>'
          overlayNoRowsTemplate="<span>No orders yet. Orders appear after a buyer approves and pays at checkout.</span>"
        />
      </div>
    </div>
  );
}
