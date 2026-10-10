'use client';
// A time in the viewer's own time zone. The server doesn't know the zone, so its snapshot is UTC; during hydration React
// keeps the server text, then switches to the client snapshot ("14:39 (your time)") without a mismatch.
import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

export function LocalTime({ iso, ...rest }: { iso: string; 'data-testid'?: string }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => `${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))} (your time)`,
    () => `${iso.slice(11, 16)} UTC`,
  );
  return (
    <time {...rest} dateTime={iso}>
      {text}
    </time>
  );
}
