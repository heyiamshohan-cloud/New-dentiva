/**
 * Typed client over the preload bridge. Session token is attached to every
 * call; server re-validates token + RBAC on each request.
 */

declare global {
  interface Window {
    dentiva: {
      invoke<T = unknown>(channel: string, payload?: Record<string, unknown>): Promise<
        { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } }
      >;
      appInfo(): Promise<{ name: string; version: string; dataDir: string }>;
    };
  }
}

export {};
export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };
export const getToken = () => token;

export async function api<T = unknown>(channel: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!window.dentiva) {
    throw new ApiError('NO_BRIDGE', 'The desktop bridge is not available. Dentiva Pro must run inside the desktop application.');
  }
  const res = await window.dentiva.invoke<T>(channel, { ...payload, token: token ?? undefined });
  if (!res.ok) throw new ApiError(res.error.code, res.error.message, res.error.details);
  return res.data;
}

export async function appInfo(): Promise<{ name: string; version: string; dataDir: string }> {
  return window.dentiva.appInfo();
}

/** Format minor units (paisa) the same way the main process does. */
export function money(paisa: number | null | undefined, symbol = '৳'): string {
  const p = paisa ?? 0;
  const neg = p < 0;
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${neg ? '−' : ''}${symbol}${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(frac).padStart(2, '0')}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function uuid(): string {
  return crypto.randomUUID();
}
