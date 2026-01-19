import { describe, it, expect } from 'vitest';
import { getSafeHttpHref, getSafeMailtoHref } from '../src/utils/safeHref';

describe('getSafeHttpHref', () => {
    it('accepts http/https URLs', () => {
        expect(getSafeHttpHref('https://example.com')).toBe('https://example.com');
        expect(getSafeHttpHref('https://example.com/path')).toBe('https://example.com/path');
        expect(getSafeHttpHref('http://example.com')).toBe('http://example.com');
    });

    it('rejects unsafe protocols and relative URLs', () => {
        expect(getSafeHttpHref('javascript:alert(1)')).toBeNull();
        expect(getSafeHttpHref('data:text/html,<script>alert(1)</script>')).toBeNull();
        expect(getSafeHttpHref('vbscript:msgbox("XSS")')).toBeNull();
        expect(getSafeHttpHref('file:///etc/passwd')).toBeNull();
        expect(getSafeHttpHref('/evil')).toBeNull();
        expect(getSafeHttpHref('./evil')).toBeNull();
        expect(getSafeHttpHref('//evil.com')).toBeNull();
    });

    it('rejects credentials, whitespace, and control chars', () => {
        expect(getSafeHttpHref('https://user:pass@example.com')).toBeNull();
        expect(getSafeHttpHref('https://user@example.com')).toBeNull();
        expect(getSafeHttpHref('https://example.com/hello world')).toBeNull();
        expect(getSafeHttpHref('https://example.com/\npath')).toBeNull();
    });

    it('rejects malformed and overly long URLs', () => {
        expect(getSafeHttpHref('https://')).toBeNull();
        expect(getSafeHttpHref('http://')).toBeNull();
        expect(getSafeHttpHref('not a url')).toBeNull();
        const longUrl = `https://example.com/${'a'.repeat(3000)}`;
        expect(getSafeHttpHref(longUrl)).toBeNull();
    });
});

describe('getSafeMailtoHref', () => {
    it('accepts valid emails', () => {
        expect(getSafeMailtoHref('user@example.com')).toBe('mailto:user@example.com');
        expect(getSafeMailtoHref('test.email+tag@example.co.uk')).toBe('mailto:test.email+tag@example.co.uk');
        expect(getSafeMailtoHref('  user@example.com  ')).toBe('mailto:user@example.com');
    });

    it('rejects invalid emails and XSS payloads', () => {
        expect(getSafeMailtoHref('notanemail')).toBeNull();
        expect(getSafeMailtoHref('user@')).toBeNull();
        expect(getSafeMailtoHref('x@y.com" onmouseover="alert(1)')).toBeNull();
        expect(getSafeMailtoHref('x@y.com<script>alert(1)</script>')).toBeNull();
        expect(getSafeMailtoHref('x@y.com\nonmouseover=alert(1)')).toBeNull();
        expect(getSafeMailtoHref('x @y.com')).toBeNull();
    });
});
