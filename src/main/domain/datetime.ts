/** Clinic-aware date/time utilities. Storage is UTC ISO; civil dates are clinic-local. */

/** Current UTC timestamp in ISO-8601 with seconds precision. */
export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Convert an ISO UTC timestamp to the clinic-local civil date `YYYY-MM-DD`. */
export function toLocalDate(isoUtc: string, timeZone: string): string {
  const d = new Date(isoUtc);
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function todayLocal(timeZone: string): string {
  return toLocalDate(nowUtc(), timeZone);
}

export function isValidLocalDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Compute whole-year age on `onDate` (local civil date) from dob (YYYY-MM-DD). */
export function ageOn(dob: string, onDate: string): number | null {
  if (!isValidLocalDate(dob) || !isValidLocalDate(onDate)) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age >= 0 ? age : null;
}

export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

export function isValidIso(s: string): boolean {
  return !Number.isNaN(Date.parse(s));
}
