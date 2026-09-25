import { AppError, ERR, SessionInfo } from '@shared/types';
import { SessionManager, Actor } from '../security/session';
import { verifyPassword } from '../security/passwords';
import { UserService } from './users';
import { AuditService } from './audit';

/**
 * Authentication: login / logout / lock / unlock with scrypt-verified
 * credentials. Failed attempts are audited; timing is equalised by always
 * running the (slow) verification path even for unknown users.
 */
export class AuthService {
  constructor(
    private users: UserService,
    private session: SessionManager,
    private audit: AuditService
  ) {}

  login(username: string, password: string): SessionInfo {
    const user = this.users.getByUsername(username.trim());
    const hashToCheck = user?.password_hash ?? 'scrypt:16384:8:1:c2FsdHNhbHRzYWx0c2FsdHNh:eW91c2hvdWxkbmV2ZXJtYXRjaHRoaXNoYXNoaGFzaGFzaGFzaGFzaGFzaGFzaA';
    const ok = verifyPassword(password, hashToCheck);
    if (!user || !ok) {
      this.audit.record(username || 'unknown', 'auth.login_failed', 'users', user?.id ?? '', { reason: user ? 'bad password' : 'unknown user' });
      throw new AppError(ERR.UNAUTHENTICATED, 'Incorrect username or password.');
    }
    if (!user.active) {
      this.audit.record(username, 'auth.login_blocked', 'users', user.id, { reason: 'inactive account' });
      throw new AppError(ERR.FORBIDDEN, 'This account is inactive. Contact the clinic administrator.');
    }
    const actor: Actor = { userId: user.id, username: user.username, displayName: user.display_name, role: user.role };
    const info = this.session.start(actor);
    this.users.touchLogin(user.id);
    this.audit.record(user.username, 'auth.login', 'users', user.id, { role: user.role });
    return info;
  }

  logout(): void {
    const cur = this.session.current();
    if (cur) this.audit.record(cur.username, 'auth.logout', 'users', cur.userId, {});
    this.session.end();
  }

  lock(): void {
    const cur = this.session.current();
    if (cur) this.audit.record(cur.username, 'auth.lock', 'users', cur.userId, {});
    this.session.lock();
  }

  unlock(token: string, password: string): SessionInfo {
    const actor = this.session.peekActor(token);
    const user = this.users.getByUsername(actor.username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      this.audit.record(actor.username, 'auth.unlock_failed', 'users', actor.userId, {});
      throw new AppError(ERR.UNAUTHENTICATED, 'Incorrect password.');
    }
    this.session.unlock();
    this.audit.record(actor.username, 'auth.unlock', 'users', actor.userId, {});
    return this.session.current()!;
  }

  status(): { signedIn: boolean; locked: boolean; session: SessionInfo | null } {
    const cur = this.session.current();
    return { signedIn: !!cur, locked: this.session.isLocked(), session: cur };
  }
}
