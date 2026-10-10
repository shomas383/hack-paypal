// The landed-cost ledger (checkout): a native table — caption, column headers, row headers — with each duty line's
// provenance one disclosure away. Amounts come from the stored quote only. data-testids are the e2e contract.
import type { ReactNode } from 'react';
import type { Money as MoneyT } from '@/domain/money/money';
import { Disclosure } from '../Disclosure';
import { Money } from '../Money';
import { SourceCitation } from '../SourceCitation';
import s from './LandedCostLedger.module.css';

export interface LedgerDutyLine {
  label: string;
  amount: MoneyT;
  officialText: string | null;
  sources: string[];
}

export function LandedCostLedger({
  goods,
  shipping,
  duty,
  total,
  dutyMeta,
  lines,
  provenance,
}: {
  goods: MoneyT;
  shipping: MoneyT;
  duty: MoneyT;
  total: MoneyT;
  dutyMeta: ReactNode;
  lines: LedgerDutyLine[];
  provenance: { htsRevision?: string | undefined; verifiedOn?: string | undefined; rateVersion: string };
}) {
  return (
    <table className={s.ledger} data-testid="breakdown">
      <caption className={s.caption}>Landed cost</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col" className={s.num}>
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Goods (customs value)</th>
          <td className={s.num}>
            <Money value={goods} data-testid="goods" />
          </td>
        </tr>
        <tr>
          <th scope="row">Shipping (flat demo rate, not a carrier quote)</th>
          <td className={s.num}>
            <Money value={shipping} data-testid="shipping" />
          </td>
        </tr>
        <tr data-testid="duty-line" className={s.group}>
          <th scope="row">
            US import duty (est.)
            <span className={s.meta}>{dutyMeta}</span>
          </th>
          <td className={s.num}>
            <Money value={duty} data-testid="duty" />
          </td>
        </tr>
        {lines.map((l, i) => (
          <tr key={i} data-testid="duty-line-item" className={s.sub}>
            <th scope="row">
              <span className={s.code}>{l.label}</span>
              <Disclosure summary="Official text and sources" className={s.disclosure}>
                <SourceCitation officialText={l.officialText} sources={l.sources} htsRevision={provenance.htsRevision} verifiedOn={provenance.verifiedOn} rateVersion={provenance.rateVersion} />
              </Disclosure>
            </th>
            <td className={`${s.num} ${s.subAmount}`}>
              <Money value={l.amount} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={s.total}>
          <th scope="row">Total</th>
          <td className={s.num}>
            <Money value={total} data-testid="total" />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
