// Labelled form field. The hint and the error are linked to the control (aria-describedby); an error sets aria-invalid
// and sits directly under the control. Controls are 16 px (no iOS zoom) with --border-input (3:1). `after` puts an action
// on the control's row (same height, bottom edges aligned), e.g. "Confirm budget".
import { cloneElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Icon } from './Icon';
import s from './Field.module.css';

export function Field({
  id,
  label,
  hint,
  error,
  prefix,
  after,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  prefix?: string;
  after?: ReactNode;
  className?: string | undefined;
  children: ReactElement<{ id?: string | undefined; 'aria-describedby'?: string | undefined; 'aria-invalid'?: boolean | undefined }>;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children) ? cloneElement(children, { id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true } : {}) }) : children;
  const box = prefix ? (
    <div className={s.prefixed}>
      <span className={s.prefix} aria-hidden="true">
        {prefix}
      </span>
      {control}
    </div>
  ) : (
    control
  );
  return (
    <div className={`${s.field} ${className ?? ''}`}>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
      {after ? (
        <div className={s.inline}>
          <div className={s.inlineControl}>{box}</div>
          <div className={s.after}>{after}</div>
        </div>
      ) : (
        box
      )}
      {error ? (
        <p id={`${id}-error`} className={s.error}>
          <Icon name="alert" />
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className={s.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={`${s.control} ${props.className ?? ''}`} />;
}

export function Select(props: ComponentProps<'select'>) {
  return <select {...props} className={`${s.control} ${s.select} ${props.className ?? ''}`} />;
}

export function Textarea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`${s.control} ${s.textarea} ${props.className ?? ''}`} />;
}
