'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/ui/Button';
import { Field, Input } from '@/ui/Field';
import s from './seller.module.css';

export function SellerSignIn() {
  const router = useRouter();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode) {
      setError('Enter the seller console passcode.');
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/seller/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode }) });
      if (res.ok) {
        router.refresh();
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `The server answered ${res.status}. Try again.`);
      setPasscode('');
      input.current?.focus();
    } catch {
      setError("The server couldn't be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.signInForm} onSubmit={submit} noValidate>
      <Field id="passcode" label="Passcode" error={error}>
        <Input ref={input} type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} data-testid="seller-passcode" />
      </Field>
      <Button type="submit" variant="primary" loading={busy} data-testid="seller-sign-in">
        Open seller console
      </Button>
    </form>
  );
}
