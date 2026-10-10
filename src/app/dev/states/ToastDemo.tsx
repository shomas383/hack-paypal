'use client';
import { useState } from 'react';
import { Button } from '@/ui/Button';
import { Toast } from '@/ui/Toast';

export function ToastDemo() {
  const [open, setOpen] = useState(false);
  const [undone, setUndone] = useState(false);
  return (
    <div>
      <Button onClick={() => { setUndone(false); setOpen(true); }}>Accept classification</Button>
      {undone ? <p>Undone. The classification is back in the review queue.</p> : null}
      {open ? (
        <Toast
          message="Accepted 9102.21.70."
          action={{ label: 'Undo', onClick: () => { setUndone(true); setOpen(false); } }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
