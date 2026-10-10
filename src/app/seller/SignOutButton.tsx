'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/ui/Button';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/seller/session', { method: 'DELETE' }).catch(() => undefined);
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
