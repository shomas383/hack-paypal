'use client';
// Review queue (AG Grid Community). The URL holds the tab, status filter, search and the open row, so a reload or a shared
// link shows the same view. Opening a row shows the detail panel (questions, actions, audit trail).
import { AgGridReact } from 'ag-grid-react';
import type { CellKeyDownEvent, ColDef } from 'ag-grid-community';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { landedGridTheme } from '@/lib/ag-grid-theme';
import { Field, Input, Select } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { StatusBadge } from '@/ui/StatusBadge';
import { registerGridModules } from '@/ui/grid/setup';
import { useNarrow } from '@/ui/grid/useNarrow';
import { classificationStatus, reasonShort } from '@/ui/reasonText';
import { ReviewPanel } from './ReviewPanel';
import s from './seller.module.css';

registerGridModules();

const MONO = s.gridMono ?? '';

export interface QueueRow {
  id: string;
  title: string;
  origin: string | null;
  topCode: string | null;
  hts10: string | null;
  confidence: number | null;
  reasons: string[];
  status: string;
  answered: number;
  questions: number;
  updatedAt: string;
}

const STATUSES = ['PENDING_REVIEW', 'AUTO_ACCEPTED', 'ACCEPTED', 'OVERRIDDEN', 'PUBLISHED', 'FAILED', 'CLASSIFYING'];
const timeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function StatusCell({ value }: { value: string }) {
  const st = classificationStatus(value);
  return <StatusBadge tone={st.tone}>{st.text}</StatusBadge>;
}

function ConfidenceCell({ value, compact }: { value: number | null; compact?: boolean }) {
  if (value === null || value === undefined) return <span className={s.muted}>—</span>;
  return (
    <span className={s.confidenceCell}>
      <span className={s.num}>{value.toFixed(2)}</span>
      {compact ? null : (
        <span className={s.bar} aria-hidden="true">
          <span style={{ width: `${Math.round(value * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

async function fetchQueue(): Promise<{ rows: QueueRow[]; error: string | null }> {
  try {
    const res = await fetch('/api/seller/classifications', { cache: 'no-store' });
    const j = (await res.json()) as QueueRow[] | { error?: string };
    if (!res.ok || !Array.isArray(j)) {
      return { rows: [], error: res.status === 401 ? 'Your seller session ended. Reload the page and sign in again.' : `The queue didn't load: ${(j as { error?: string }).error ?? res.status}.` };
    }
    return { rows: j, error: null };
  } catch {
    return { rows: [], error: "The queue didn't load. Check your connection and reload." };
  }
}

export function ReviewQueue() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get('status') ?? '';
  const rowId = params.get('row');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const narrow = useNarrow();

  const setParam = useCallback(
    (next: Record<string, string | null>) => {
      const p = new URLSearchParams(params.toString());
      p.set('tab', 'review');
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const applyResult = useCallback((r: { rows: QueueRow[]; error: string | null }) => {
    setRows(r.rows);
    setError(r.error);
  }, []);
  const load = useCallback(() => fetchQueue().then(applyResult), [applyResult]);

  useEffect(() => {
    let stop = false;
    void fetchQueue().then((r) => !stop && applyResult(r));
    return () => {
      stop = true;
    };
  }, [applyResult]);

  // Search goes to the URL after a short pause (no history entry per keystroke).
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== search) setParam({ q: search || null });
    }, 300);
    return () => clearTimeout(t);
  }, [search, params, setParam]);

  const visible = useMemo(() => (rows ?? []).filter((r) => !status || r.status === status), [rows, status]);
  const needsReview = (rows ?? []).filter((r) => r.status === 'PENDING_REVIEW').length;

  // Every visible column fits the grid's width (no hidden-off-to-the-side columns): full set, panel open, phone.
  const compact = narrow || Boolean(rowId);
  const columns = useMemo<ColDef<QueueRow>[]>(
    () => [
      { field: 'title', headerName: 'Listing', flex: 2, minWidth: narrow ? 120 : 160, tooltipField: 'title', filter: 'agTextColumnFilter' },
      { field: 'origin', headerName: 'Origin', width: 90, hide: compact, valueFormatter: (p) => p.value ?? 'Unknown' },
      { field: 'topCode', headerName: 'Top code', width: 120, hide: narrow, cellClass: MONO, valueFormatter: (p) => p.value ?? '—' },
      { field: 'confidence', headerName: narrow ? 'Conf.' : 'Confidence', width: narrow ? 80 : 130, cellRenderer: ConfidenceCell, cellRendererParams: { compact: narrow }, filter: 'agNumberColumnFilter', type: 'numericColumn', headerTooltip: 'Confidence' },
      { field: 'reasons', headerName: 'Reasons', flex: 1, minWidth: 180, hide: compact, valueFormatter: (p) => ((p.value as string[] | undefined)?.length ? (p.value as string[]).map(reasonShort).join(', ') : '—'), tooltipValueGetter: (p) => ((p.value as string[] | undefined) ?? []).map(reasonShort).join(', ') },
      { field: 'status', headerName: 'Status', width: 140, cellRenderer: StatusCell },
      { headerName: 'Seller answers', width: 140, hide: compact, valueGetter: (p) => (p.data && p.data.questions ? `${p.data.answered} of ${p.data.questions}` : '—') },
      { field: 'updatedAt', headerName: 'Updated', width: 150, hide: compact, sort: 'desc', valueFormatter: (p) => (p.value ? timeFmt.format(new Date(p.value as string)) : '') },
    ],
    [narrow, compact],
  );

  const open = (id: string | undefined) => id && setParam({ row: id });
  const onKey = (e: CellKeyDownEvent<QueueRow>) => {
    const k = (e.event as KeyboardEvent | undefined)?.key;
    if (k === 'Enter' || k === ' ') open(e.data?.id);
  };

  return (
    <div className={s.gridSection}>
      <div className={s.toolbar}>
        <div className={s.filters}>
          <Field id="queue-search" label="Search listings" className={s.filterField}>
            <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="queue-search" />
          </Field>
          <Field id="queue-status" label="Status" className={s.filterField}>
            <Select value={status} onChange={(e) => setParam({ status: e.target.value || null, row: null })} data-testid="queue-status">
              <option value="">All statuses</option>
              {STATUSES.map((v) => (
                <option key={v} value={v}>
                  {classificationStatus(v).text}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className={s.muted} aria-live="polite">
          {rows === null ? 'Loading the queue…' : `${visible.length} shown · ${needsReview} need review`}
        </p>
      </div>
      {error ? (
        <p role="alert" className={s.error}>
          <Icon name="x-circle" />
          <span>{error}</span>
        </p>
      ) : null}
      <div className={rowId ? s.queueWithPanel : undefined}>
        <div className={s.gridWrap} data-testid="queue-grid">
          <AgGridReact<QueueRow>
            theme={landedGridTheme}
            rowData={visible}
            loading={rows === null}
            columnDefs={columns}
            quickFilterText={search}
            getRowId={(p) => p.data.id}
            domLayout="autoHeight"
            onRowClicked={(e) => open(e.data?.id)}
            onCellKeyDown={onKey}
            rowClass={s.clickableRow ?? ''}
            getRowClass={(p) => (p.data?.id === rowId ? s.selectedRow : undefined)}
            tooltipShowDelay={400}
            overlayLoadingTemplate='<span class="ag-overlay-loading-center">Loading the queue…</span>'
            overlayNoRowsTemplate={rows?.length ? '<span>No classifications match these filters.</span>' : '<span>No classifications yet. Classify a listing to start.</span>'}
          />
        </div>
        {rowId ? <ReviewPanel key={rowId} id={rowId} onChanged={load} onClose={() => setParam({ row: null })} /> : null}
      </div>
    </div>
  );
}
