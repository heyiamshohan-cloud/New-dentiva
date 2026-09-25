import React, { useState } from 'react';
import { useSession } from '../session';
import { Button, Input } from '../components/ui';

/** Full-screen lock — patient, clinical and financial data are hidden. */
export function LockScreen() {
  const { user, unlock, signOut } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      await unlock(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed.');
    } finally {
      setLoading(false);
      setPassword('');
    }
  };

  return (
    <div className="overlay" style={{ background: 'rgba(13, 30, 42, 0.86)', alignItems: 'center', paddingTop: 0, zIndex: 500 }}>
      <form className="auth-card lock-card" onSubmit={submit}>
        <div className="avatar-big">{(user?.displayName ?? '?').slice(0, 1).toUpperCase()}</div>
        <h1 style={{ fontSize: 18 }}>{user?.displayName}</h1>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 18px' }}>Dentiva Pro is locked. Enter your password to continue.</p>
        {error && <div className="dlg-error" role="alert">{error}</div>}
        <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
          <Button onClick={() => void signOut()}>Sign out</Button>
          <Button variant="primary" type="submit" loading={loading}>Unlock</Button>
        </div>
      </form>
    </div>
  );
}
