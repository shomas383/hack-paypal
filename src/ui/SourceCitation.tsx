// Provenance for a duty line: the official text (quoted, verbatim), the sources, and the data version / verification.
import s from './SourceCitation.module.css';

export function SourceCitation({
  officialText,
  sources,
  htsRevision,
  verifiedOn,
  rateVersion,
}: {
  officialText?: string | null | undefined;
  sources: string[];
  htsRevision?: string | null | undefined;
  verifiedOn?: string | null | undefined;
  rateVersion?: string | null | undefined;
}) {
  const meta = [htsRevision ? `HTS ${htsRevision}` : null, verifiedOn ? `verified ${verifiedOn}` : null, rateVersion ? `rate version ${rateVersion}` : null].filter(Boolean);
  return (
    <div className={s.citation}>
      {officialText ? (
        <blockquote className={s.official} data-testid="official-text">
          “{officialText}”
        </blockquote>
      ) : null}
      {sources.length ? (
        <p>
          <span className={s.label}>Sources: </span>
          {sources.join('; ')}
        </p>
      ) : null}
      {meta.length ? <p className={s.meta}>{meta.join(' · ')}</p> : null}
    </div>
  );
}
