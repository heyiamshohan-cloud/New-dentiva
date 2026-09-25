import React, { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { LogoMark } from '../icons';
import { Button, Field, Input } from '../components/ui';
import type { SessionInfo } from '@shared/types';

export function LoginPage() {
  const { signIn, clinicName } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const s = await api<SessionInfo>('auth.login', { username, password });
      signIn({ token: s.token, userId: s.userId, username: s.username, displayName: s.displayName, role: s.role });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <LogoMark size={56} />
          <h1>Dentiva Pro</h1>
          <div className="tag">{clinicName || 'Dental Clinic Management'}</div>
        </div>
        {error && <div className="dlg-error" role="alert">{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Username" required>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          </Field>
          <Field label="Password" required>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Button variant="primary" size="lg" type="submit" loading={loading}>Sign in</Button>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 18, textAlign: 'center' }}>
          All data is stored locally on this computer. Dentiva Pro works fully offline.
        </p>
      </form>
    </div>
  );
}
