// Status as text + icon, coloured by tone. Never colour alone, never a filled pill.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import s from './StatusBadge.module.css';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'progress';

const ICON: Record<Tone, IconName> = {
  success: 'check-circle',
  warning: 'alert',
  danger: 'x-circle',
  neutral: 'dot',
  info: 'info',
  progress: 'spinner',
};

export function StatusBadge({ tone, children, className, ...rest }: { tone: Tone; children: ReactNode; className?: string | undefined; 'data-testid'?: string }) {
  return (
    <span {...rest} className={`${s.badge} ${s[tone]} ${className ?? ''}`}>
      <Icon name={ICON[tone]} />
      <span>{children}</span>
    </span>
  );
}
