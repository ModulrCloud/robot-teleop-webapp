/**
 * Safe href helpers to prevent XSS via javascript: or attribute breakout.
 * Use these whenever an href is built from user- or partner-controlled data.
 *
 * @see explanations/xss-audit-and-complete-sign-out.md
 */

const SAFE_URL_PROTOCOLS = ['http:', 'https:'] as const;
const MAX_URL_LENGTH = 2048;

const hasUnsafeHttpChars = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 31 || code === 127 || code === 32) {
      return true;
    }
  }
  return false;
};

type SafeUrlProtocol = (typeof SAFE_URL_PROTOCOLS)[number];

/**
 * Type guard to check if a protocol is safe.
 */
function isSafeProtocol(protocol: string): protocol is SafeUrlProtocol {
  return SAFE_URL_PROTOCOLS.includes(protocol as SafeUrlProtocol);
}

/**
 * Returns a safe href for http/https URLs, or null if invalid/unsafe.
 * Rejects javascript:, data:, vbscript:, relative URLs, etc.
 * Only accepts absolute URLs starting with http:// or https://
 */
export function getSafeHttpHref(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  if (!s) return null;
  if (s.length > MAX_URL_LENGTH) return null;
  if (hasUnsafeHttpChars(s)) return null;

  // Must start with http:// or https:// (absolute URL only)
  if (!s.toLowerCase().startsWith('http://') && !s.toLowerCase().startsWith('https://')) {
    return null;
  }

  try {
    const u = new URL(s);
    if (
      isSafeProtocol(u.protocol) &&
      u.hostname &&
      !u.username &&
      !u.password
    ) {
      return s;
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

const UNSAFE_IN_MAILTO = /["'<> \n\r\\]/;

const BASIC_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function getSafeMailtoHref(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null;
  const s = email.trim();
  if (!s || UNSAFE_IN_MAILTO.test(s) || !BASIC_EMAIL.test(s)) return null;
  return `mailto:${s}`;
}
