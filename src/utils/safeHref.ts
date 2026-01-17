/**
 * Safe href helpers to prevent XSS via javascript: or attribute breakout.
 * Use these whenever an href is built from user- or partner-controlled data.
 *
 * @see explanations/xss-audit-and-complete-sign-out.md
 */

const SAFE_URL_PROTOCOLS = ['http:', 'https:'] as const;

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
  
  // Must start with http:// or https:// (absolute URL only)
  if (!s.toLowerCase().startsWith('http://') && !s.toLowerCase().startsWith('https://')) {
    return null;
  }
  
  try {
    const u = new URL(s);
    if (isSafeProtocol(u.protocol)) {
      return s;
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

/** Chars that could break out of an HTML attribute or inject script. */
const UNSAFE_IN_MAILTO = /["'<> \n\r\\]/;

/** Loose email-like pattern; we also reject UNSAFE_IN_MAILTO. */
const BASIC_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Returns a safe mailto: href, or null if invalid/unsafe.
 * Prevents attribute breakout (e.g. " onmouseover="...) and script injection.
 */
export function getSafeMailtoHref(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null;
  const s = email.trim();
  if (!s || UNSAFE_IN_MAILTO.test(s) || !BASIC_EMAIL.test(s)) return null;
  return `mailto:${s}`;
}
