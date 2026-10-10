'use client';
// One toast at a time, bottom-left, announced via role="status". Optional action (e.g. Undo). Auto-dismiss after
// `timeoutMs`; hovering or focusing it pauses the timer.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import s from './Toast.module.css';

export function Toast({ message, action, onDismiss, timeoutMs = 6000 }: { message: ReactNode; action?: { label: string; onClick: () => void }; onDismiss: () => void; timeoutMs?: number }) {
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => dismiss.current(), timeoutMs);
    return () => clearTimeout(t);
  }, [paused, timeoutMs]);
  return (
    <div className={s.toast} role="status" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span>{message}</span>
      {action ? (
        <button type="button" className={s.action} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
