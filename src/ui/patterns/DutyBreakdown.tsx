// Duty breakdown for one quote (agent): one summary row per line ("9903.05.39 · combined cap 10% · $12.49"); the official
// text, sources and verification one disclosure away. Amounts are the tool's stored-quote strings.
import { dutyLineLabel, splitSources } from '../dutyText';
import { Disclosure } from '../Disclosure';
import { SourceCitation } from '../SourceCitation';
import s from './DutyBreakdown.module.css';

export interface BreakdownLine {
  chapter99: string | null;
  amount: string;
  basis: string;
  source: string;
  official_text: string | null;
}

export function DutyBreakdown({
  hts,
  lines,
  total,
  htsRevision,
  verifiedOn,
  rateVersion,
}: {
  hts: string;
  lines: BreakdownLine[];
  total: string;
  htsRevision?: string | undefined;
  verifiedOn?: string | undefined;
  rateVersion?: string | undefined;
}) {
  return (
    <div className={s.breakdown} data-testid="agent-breakdown">
      <ul className={s.lines}>
        {lines.map((l, i) => (
          <li key={i} className={s.line}>
            <div className={s.row}>
              <span className={s.label}>{dutyLineLabel(l, hts)}</span>
              <span className={s.num}>{l.amount}</span>
            </div>
            <Disclosure summary="Official text and sources">
              <SourceCitation officialText={l.official_text} sources={splitSources(l.source)} htsRevision={htsRevision} verifiedOn={verifiedOn} rateVersion={rateVersion} />
            </Disclosure>
          </li>
        ))}
      </ul>
      <div className={`${s.row} ${s.total}`}>
        <span>US import duty (est.)</span>
        <span className={s.num}>{total}</span>
      </div>
    </div>
  );
}
