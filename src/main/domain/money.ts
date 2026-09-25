/**
 * Safe monetary arithmetic. All money is stored and computed as integer
 * minor units (BDT poisha). Floats are never used for financial math.
 */
import { AppError, ERR } from '@shared/types';

export type Paisa = number;

const AMOUNT_RE = /^-?\d{1,15}(\.\d{1,2})?$/;

/** Parse a user-provided amount ("1234.56", 1234.56, "0.10") into integer paisa. */
export function parseMoney(input: string | number, field = 'amount'): Paisa {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new AppError(ERR.VALIDATION, `${field} must be a finite number.`);
    // Re-express via string to avoid binary float contamination.
    input = String(input);
  }
  const trimmed = input.trim();
  if (!AMOUNT_RE.test(trimmed)) {
    throw new AppError(ERR.VALIDATION, `${field} must be a valid amount with at most 2 decimal places.`);
  }
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw, fracRaw = ''] = body.split('.');
  const whole = parseInt(wholeRaw, 10);
  const frac = parseInt((fracRaw + '00').slice(0, 2), 10);
  const paisa = whole * 100 + frac;
  return negative ? -paisa : paisa;
}

/** Non-negative money (prices, payments). */
export function parseNonNegativeMoney(input: string | number, field = 'amount'): Paisa {
  const v = parseMoney(input, field);
  if (v < 0) throw new AppError(ERR.VALIDATION, `${field} cannot be negative.`);
  return v;
}

/** Strictly positive money (payments must move money). */
export function parsePositiveMoney(input: string | number, field = 'amount'): Paisa {
  const v = parseMoney(input, field);
  if (v <= 0) throw new AppError(ERR.VALIDATION, `${field} must be greater than zero.`);
  return v;
}

export function assertPaisa(v: number, field = 'amount'): Paisa {
  if (!Number.isSafeInteger(v)) {
    throw new AppError(ERR.VALIDATION, `${field} must be an integer number of minor units.`);
  }
  return v;
}

export function add(a: Paisa, b: Paisa): Paisa {
  return a + b;
}
export function sub(a: Paisa, b: Paisa): Paisa {
  return a - b;
}
export function mul(a: Paisa, qty: number): Paisa {
  if (!Number.isSafeInteger(qty)) throw new AppError(ERR.VALIDATION, 'quantity must be an integer.');
  return a * qty;
}

/** Percentage with round-half-up on integer base: percent = 5 → 5%. */
export function percentOf(base: Paisa, percent: number): Paisa {
  if (!Number.isFinite(percent) || percent < 0 || percent > 1000) {
    throw new AppError(ERR.VALIDATION, 'percent must be between 0 and 1000.');
  }
  // integer math: base * percent / 100, round half up
  const bp = Math.round(percent * 100); // percent in basis points exactly
  return Math.round((base * bp) / 10000);
}

export function formatPaisa(p: Paisa, symbol = ''): string {
  const negative = p < 0;
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const core = `${grouped}.${String(frac).padStart(2, '0')}`;
  return `${negative ? '-' : ''}${symbol}${core}`;
}

/** Compare helper for reconciliation checks. */
export function sumPaisa(values: Paisa[]): Paisa {
  return values.reduce((a, b) => a + b, 0);
}
