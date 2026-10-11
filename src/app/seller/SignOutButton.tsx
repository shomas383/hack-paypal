'use client';
import { useState } from 'react';
import { Button } from '@/ui/Button';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/seller/session', { method: 'DELETE' }).catch(() => undefined);
        // A full load, not router.refresh(): the soft refresh drops <title> for ~300 ms (Next re-streams the metadata).
        window.location.reload();
      }}
    >
      Sign out
    </Button>
  );
}
