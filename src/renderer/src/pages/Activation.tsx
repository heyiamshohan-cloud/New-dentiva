import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { LogoMark } from '../icons';
import { Button, Field, Input } from '../components/ui';

interface ActivationStatus {
  activated: boolean;
  reason: '' | 'none' | 'corrupt' | 'tampered' | 'machine-mismatch';
  installationId: string;
  lockedUntil: number | null;
}

/** Display-only grouping of an already-normalized alphanumeric serial. */
function groupSerial(norm: string): string {
  return norm.replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Product activation — first-run gate shown before setup or sign-in, and
 * whenever this machine has no valid activation. No network, and no bypass
 * route: the main process independently rejects every business channel
 * while unactivated.
 */
export function ActivationPage() {
  const { refreshStatus } = useSession();
  const [status, setStatus] = useState<ActivationStatus | null>(null);
  const [serial, setSerial] = useState('');
  const [error, setError] = useState('');
  const [justActivated, setJustActivated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    api<ActivationStatus>('activation.status').then((s) => {
      setStatus(s);
      if (s.lockedUntil) setRemaining(Math.max(0, s.lockedUntil - Date.now()));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = window.setInterval(() => setRemaining((r) => Math.max(0, r - 1000)), 1000);
    return () => window.clearInterval(t);
  }, [remaining]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const norm = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
    setSerial(norm);
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !serial) return;
    setLoading(true);
    setError('');
    try {
      await api('activation.activate', { serial });
      setJustActivated(true);
      await refreshStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Activation could not be completed.';
      setError(msg);
      // refresh lockout state if present
      api<ActivationStatus>('activation.status').then((s) => {
        setStatus(s);
        setRemaining(s.lockedUntil ? Math.max(0, s.lockedUntil - Date.now()) : 0);
      }).catch(() => undefined);
    } finally {
      setLoading(false);
    }
  };

  const locked = remaining > 0;
  const lockText = locked
    ? `More attempts available in ${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}.`
    : '';

  const reasonCopy: Record<string, { title: string; body: string }> = {
    'machine-mismatch': {
      title: 'Activation moved to this computer',
      body: 'This installation’s activation belongs to a different machine. Re-enter your serial to activate it here — your clinic data is untouched.'
    },
    corrupt: {
      title: 'Activation state needs repair',
      body: 'The activation record on this computer could not be read. Enter your serial again to restore it.'
    },
    tampered: {
      title: 'Activation record invalid',
      body: 'The activation record on this computer failed verification. Enter your serial to activate this installation again.'
    }
  };
  const copy = status && reasonCopy[status.reason] ? reasonCopy[status.reason] : null;

  return (
    <div className="center-screen">
      <form className="auth-card" onSubmit={submit} aria-label="Product activation">
        <div className="auth-brand">
          <LogoMark size={56} />
          <h1>Dentiva Pro</h1>
          <div className="tag">{copy ? copy.title : 'Product activation'}</div>
        </div>
        <p className="activation-note">
          {copy
            ? copy.body
            : justActivated
              ? 'This computer is activated. Setting the clinic up comes next.'
              : 'Enter the activation serial supplied with your licence to set up Dentiva Pro on this computer. Everything stays on this machine — no internet connection is needed.'}
        </p>
        {error && <div className="dlg-error" role="alert">{error}</div>}
        {locked && !error && <div className="dlg-error" role="alert">{lockText}</div>}
        {!justActivated && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Activation serial" required>
              <Input
                value={groupSerial(serial)}
                onChange={onChange}
                placeholder="Enter your serial"
                autoComplete="off"
                spellCheck={false}
                disabled={locked}
                inputMode="text"
                invalid={error !== ''}
                style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}
              />
            </Field>
            <Button type="submit" variant="primary" loading={loading} disabled={locked || serial.length < 12}>
              Activate
            </Button>
          </div>
        )}
        {status && (
          <div className="activation-install">
            <span>Installation ID</span>
            <b>{status.installationId}</b>
            <span className="muted">quote this to your supplier when activating a new machine</span>
          </div>
        )}
      </form>
    </div>
  );
}
