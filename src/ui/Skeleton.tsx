// Placeholder matching the final layout. Fades in after --skeleton-delay so fast responses never flash it.
import s from './Skeleton.module.css';

// Purely visual (aria-hidden): the surrounding region announces loading in words (e.g. a button's "…" label).
export function Skeleton({ width = '100%', height = 'var(--leading-14)', className }: { width?: string; height?: string; className?: string | undefined }) {
  return <span className={`${s.skeleton} ${className ?? ''}`} style={{ width, height }} aria-hidden="true" />;
}

/** Table-shaped skeleton: `rows` × `cols` bars inside the real table's layout. */
export function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <Skeleton width={c === 0 ? '70%' : '50%'} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
