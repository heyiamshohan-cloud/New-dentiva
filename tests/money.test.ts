import { describe, it, expect } from 'vitest';
import { parseMoney, parsePositiveMoney, formatPaisa, percentOf } from '@main/domain/money';
import { AppError } from '@shared/types';

describe('money engine', () => {
  it('parses whole and decimal amounts into integer paisa', () => {
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('1')).toBe(100);
    expect(parseMoney('1234.56')).toBe(123456);
    expect(parseMoney('0.10')).toBe(10);
    expect(parseMoney('0.01')).toBe(1);
    expect(parseMoney(99.99)).toBe(9999);
    expect(parseMoney('-5.25')).toBe(-525);
    expect(parseMoney('1000000.00')).toBe(100000000);
  });

  it('rejects invalid or unsafe amounts', () => {
    expect(() => parseMoney('')).toThrow(AppError);
    expect(() => parseMoney('abc')).toThrow(AppError);
    expect(() => parseMoney('1.234')).toThrow(AppError); // >2dp
    expect(() => parseMoney('1,000.00')).toThrow(AppError); // commas not accepted
    expect(() => parseMoney(Number.NaN)).toThrow(AppError);
    expect(() => parseMoney(Infinity)).toThrow(AppError);
  });

  it('positive amounts must be > 0', () => {
    expect(() => parsePositiveMoney('0')).toThrow(AppError);
    expect(() => parsePositiveMoney('-1')).toThrow(AppError);
    expect(parsePositiveMoney('0.01')).toBe(1);
  });

  it('formats paisa with grouping and sign', () => {
    expect(formatPaisa(123456)).toBe('1,234.56');
    expect(formatPaisa(-5000)).toBe('-50.00');
    expect(formatPaisa(0, '৳')).toBe('৳0.00');
    expect(formatPaisa(100000000, '৳')).toBe('৳1,000,000.00');
  });

  it('percentages are exact integer arithmetic', () => {
    expect(percentOf(10000, 5)).toBe(500);
    expect(percentOf(9999, 5)).toBe(500); // 499.95 → round half up 500
    expect(percentOf(333, 33.33)).toBe(111);
    expect(percentOf(0, 10)).toBe(0);
  });
});
