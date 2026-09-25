import { AppError, ERR, ISODateTime, Role, SessionInfo } from '@shared/types';
import { newSessionToken } from './passwords';

export interface Actor {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
}

interface Session {
  actor: Actor;
  token: string;
  loginAt: ISODateTime;
  lastActivityAt: number; // ms epoch
  locked: boolean;
}

/**
 * In-memory session manager. Sessions never persist across restarts — a
 * restart means re-authentication (spec: Authentication / Crash Recovery).
 * The lock flag protects patient, clinical and financial data when idle.
 */
export class SessionManager {
  private session: Session | null = null;
  private idleTimeoutMs = 10 * 60 * 1000; // default 10 min, configurable

  setIdleTimeout(minutes: number): void {
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 24 * 60) {
      this.idleTimeoutMs = Math.round(minutes * 60 * 1000);
    }
  }

  start(actor: Actor): SessionInfo {
    this.session = {
      actor,
      token: newSessionToken(),
      loginAt: new Date().toISOString(),
      lastActivityAt: Date.now(),
      locked: false
    };
    return this.info();
  }

  end(): void {
    this.session = null;
  }

  lock(): void {
    if (this.session) this.session.locked = true;
  }

  unlock(): void {
    if (!this.session) throw new AppError(ERR.UNAUTHENTICATED, 'No active session.');
    this.session.locked = false;
    this.session.lastActivityAt = Date.now();
  }

  /** Returns the actor if the session is valid, unlocked and not idle-expired. */
  requireActor(token: string | undefined): Actor {
    const s = this.session;
    if (!s || !token || s.token !== token) {
      throw new AppError(ERR.UNAUTHENTICATED, 'You are not signed in. Please sign in again.');
    }
    if (Date.now() - s.lastActivityAt > this.idleTimeoutMs) {
      s.locked = true;
      throw new AppError(ERR.SESSION_LOCKED, 'The application locked due to inactivity. Please unlock to continue.');
    }
    if (s.locked) {
      throw new AppError(ERR.SESSION_LOCKED, 'The application is locked. Please unlock to continue.');
    }
    s.lastActivityAt = Date.now();
    return s.actor;
  }

  /** Like requireActor but allowed while locked (unlock flows, read-only status). */
  peekActor(token: string | undefined): Actor {
    const s = this.session;
    if (!s || !token || s.token !== token) {
      throw new AppError(ERR.UNAUTHENTICATED, 'You are not signed in.');
    }
    return s.actor;
  }

  isLocked(): boolean {
    if (!this.session) return false;
    if (Date.now() - this.session.lastActivityAt > this.idleTimeoutMs) {
      this.session.locked = true;
    }
    return this.session.locked;
  }

  current(): SessionInfo | null {
    return this.session ? this.info() : null;
  }

  private info(): SessionInfo {
    const s = this.session!;
    return {
      token: s.token,
      userId: s.actor.userId,
      username: s.actor.username,
      displayName: s.actor.displayName,
      role: s.actor.role,
      loginAt: s.loginAt,
      locked: s.locked
    };
  }
}
