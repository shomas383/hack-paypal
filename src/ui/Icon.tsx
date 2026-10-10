// 16 px stroke icons (one style, currentColor). Decorative by default (aria-hidden); status is always also written as text.
import s from './Icon.module.css';

const PATHS = {
  check: 'M3.5 8.5l3 3 6-7',
  'check-circle': 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM5.25 8.25l2 2 3.5-4',
  'x-circle': 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5',
  alert: 'M8 2l6.5 11.5h-13L8 2zM8 6.5v3M8 11.6v.1',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v3.5M8 5v.1',
  dot: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  chevron: 'M6 4l4 4-4 4',
  'arrow-left': 'M10 3.5L5.5 8l4.5 4.5',
} as const;

export type IconName = keyof typeof PATHS | 'spinner';

export function Icon({ name, label, className }: { name: IconName; label?: string | undefined; className?: string | undefined }) {
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  if (name === 'spinner') {
    return (
      <svg viewBox="0 0 16 16" className={`${s.icon} ${s.spin} ${className ?? ''}`} fill="none" {...a11y}>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className={`${s.icon} ${className ?? ''}`} fill="none" {...a11y}>
      <path d={PATHS[name]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
