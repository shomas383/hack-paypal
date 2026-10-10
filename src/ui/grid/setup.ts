'use client';
// AG Grid Community 36.2.0 modules used by the seller console (Community only; no Enterprise features). Registered once.
import {
  CellStyleModule,
  ClientSideRowModelModule,
  CsvExportModule,
  DateFilterModule,
  ModuleRegistry,
  NumberFilterModule,
  PinnedRowModule,
  QuickFilterModule,
  RowStyleModule,
  TextFilterModule,
  TooltipModule,
} from 'ag-grid-community';

let registered = false;
export function registerGridModules(): void {
  if (registered) return;
  ModuleRegistry.registerModules([
    ClientSideRowModelModule,
    TextFilterModule,
    NumberFilterModule,
    DateFilterModule,
    QuickFilterModule,
    RowStyleModule,
    CsvExportModule,
    CellStyleModule,
    PinnedRowModule,
    TooltipModule,
  ]);
  registered = true;
}
