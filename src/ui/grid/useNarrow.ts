'use client';
// True below the given width (default 640 px), tracked with matchMedia. Grids show fewer columns on phones.
import { useSyncExternalStore } from 'react';

export function useNarrow(maxWidth = 640): boolean {
  const q = `(max-width: ${maxWidth}px)`;
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}
