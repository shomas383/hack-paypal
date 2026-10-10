// Labelled form field. The hint and the error are linked to the control (aria-describedby); an error sets aria-invalid
// and sits directly under the control. Controls are 16 px (no iOS zoom) with --border-input (3:1).
import { cloneElement, isValidElement, type InputHTMLAttributes, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';
import s from './Field.module.css';

export function Field({
  id,
  label,
  hint,
  error,
  prefix,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  prefix?: string;
  className?: string;
  children: ReactElement<{ id?: string | undefined; 'aria-describedby'?: string | undefined; 'aria-invalid'?: boolean | undefined }>;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children) ? cloneElement(children, { id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true } : {}) }) : children;
  return (
    <div className={`${s.field} ${className ?? ''}`}>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
      {prefix ? (
        <div className={s.prefixed}>
          <span className={s.prefix} aria-hidden="true">
            {prefix}
          </span>
          {control}
        </div>
      ) : (
        control
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

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${s.control} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${s.control} ${s.textarea} ${props.className ?? ''}`} />;
}
