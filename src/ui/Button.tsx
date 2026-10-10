// Buttons: primary (near-black), secondary (bordered), ghost. Verb + object labels. While loading the label stays and a
// spinner is added (no label swap, no width jump); the button is disabled and aria-busy.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';
import s from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost';

function cls(variant: Variant, size: 'md' | 'sm', extra?: string) {
  return [s.button, s[variant], size === 'sm' ? s.sm : '', extra ?? ''].filter(Boolean).join(' ');
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm'; loading?: boolean; children: ReactNode }) {
  return (
    <button {...rest} type={type} className={cls(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <Icon name="spinner" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  children,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: 'md' | 'sm'; children: ReactNode }) {
  return (
    <a {...rest} className={cls(variant, size, className)}>
      <span>{children}</span>
    </a>
  );
}
