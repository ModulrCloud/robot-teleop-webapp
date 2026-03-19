import { currencyToCreditsSync, type CurrencyCode } from './credits';

/** Format a currency amount for the hourly field (≤2 decimal places) after credits→currency. */
export function formatHourlyDisplayAmount(n: number): string {
  if (!Number.isFinite(n)) return '';
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(2);
}

/** Shown when the string is not a whole number or ≤2 decimal places. */
export const HOURLY_CURRENCY_FORMAT_ERROR =
  'Use a whole number (e.g. 25) or up to two decimal places (e.g. 25.50).';

/** Strip invalid characters; keep digits and a single decimal point (no letters/symbols/SQL). */
export function sanitizeHourlyCurrencyTyping(raw: string): string {
  const withDot = raw.replace(/,/g, '.');
  let out = '';
  let dotSeen = false;
  for (const ch of withDot) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (ch === '.' && !dotSeen) {
      out += ch;
      dotSeen = true;
    }
  }
  return out;
}

export function normalizeHourlyCurrencyForValidation(raw: string): string {
  let t = raw.trim().replace(/,/g, '.');
  if (t.endsWith('.')) t = t.slice(0, -1);
  return t;
}

/** Whole number, or integer part + 1–2 fractional digits (e.g. 0, 12, 0.5, 12.34). */
export function isAcceptableHourlyCurrencyNormalized(t: string): boolean {
  if (t === '') return false;
  return /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(t);
}

export function hourlyCurrencyToCredits(
  raw: string,
  code: CurrencyCode,
  rates: Record<string, number> | undefined,
): { ok: true; credits: number } | { ok: false; message: string } {
  const t = normalizeHourlyCurrencyForValidation(raw);
  if (t === '') {
    return { ok: false, message: 'Enter an hourly rate (use 0 for free)' };
  }
  if (!isAcceptableHourlyCurrencyNormalized(t)) {
    return { ok: false, message: HOURLY_CURRENCY_FORMAT_ERROR };
  }
  const n = parseFloat(t);
  if (Number.isNaN(n) || n < 0) {
    return { ok: false, message: HOURLY_CURRENCY_FORMAT_ERROR };
  }
  if (!rates) {
    return { ok: false, message: 'Exchange rates not loaded; wait a moment and try again.' };
  }
  const credits = currencyToCreditsSync(n, code, rates);
  if (Number.isNaN(credits) || credits < 0) {
    return { ok: false, message: HOURLY_CURRENCY_FORMAT_ERROR };
  }
  return { ok: true, credits };
}
