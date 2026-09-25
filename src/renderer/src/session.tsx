import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, setToken, getToken, ApiError } from './api';
import type { Role } from '@shared/types';
import { roleHas, type Permission } from '@shared/permissions';

export interface SessionUser {
  token: string;
  userId: number;
  username: string;
  displayName: string;
  role: Role;
}

interface SessionState {
  status: 'booting' | 'setup' | 'signedOut' | 'signedIn';
  user: SessionUser | null;
  locked: boolean;
  setupComplete: boolean;
  clinicName: string;
  can: (perm: Permission) => boolean;
  signIn: (s: SessionUser) => void;
  signOut: () => Promise<void>;
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside provider');
  return s;
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>('booting');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [locked, setLocked] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [clinicName, setClinicName] = useState('');

  const refreshStatus = useCallback(async () => {
    try {
      const st = await api<{ signedIn: boolean; locked: boolean; setupComplete: boolean; clinicName: string; userCount: number; session: SessionUser | null }>('auth.status', { token: undefined });
      setSetupComplete(st.setupComplete);
      setClinicName(st.clinicName);
      if (!st.setupComplete && st.userCount === 0) {
        setStatus('setup');
      } else if (!user) {
        setStatus('signedOut');
      }
      if (user && st.locked) setLocked(true);
    } catch {
      setStatus('signedOut');
    }
  }, [user]);

  useEffect(() => { void refreshStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback((s: SessionUser) => {
    setToken(s.token);
    setUser(s);
    setLocked(false);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    try { await api('auth.logout'); } catch { /* session may already be gone */ }
    setToken(null);
    setUser(null);
    setLocked(false);
    setStatus('signedOut');
  }, []);

  const lock = useCallback(async () => {
    if (!user) return;
    try { await api('auth.lock'); } catch { /* best effort */ }
    setLocked(true);
  }, [user]);

  const unlock = useCallback(async (password: string) => {
    const t = getToken();
    const s = await api<SessionUser>('auth.unlock', { token: t, password });
    setUser(s);
    setLocked(false);
  }, []);

  // Inactivity lock: renderer-side timer + server-side idle enforcement.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (status !== 'signedIn' || locked) return;
    const reset = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { void lock(); }, 10 * 60 * 1000);
    };
    const events = ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [status, locked, lock]);

  // Any SESSION_LOCKED response hard-locks the UI.
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof ApiError && (e.reason.code === 'SESSION_LOCKED' || e.reason.code === 'UNAUTHENTICATED')) {
        if (e.reason.code === 'SESSION_LOCKED') setLocked(true);
      }
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  const can = useCallback((perm: Permission) => (user ? roleHas(user.role, perm) : false), [user]);

  return (
    <Ctx.Provider value={{ status, user, locked, setupComplete, clinicName, can, signIn, signOut, lock, unlock, refreshStatus }}>
      {children}
    </Ctx.Provider>
  );
}
