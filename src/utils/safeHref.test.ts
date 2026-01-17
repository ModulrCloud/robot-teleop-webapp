import { describe, it, expect } from 'vitest';
import { getSafeHttpHref, getSafeMailtoHref } from './safeHref';

describe('getSafeHttpHref', () => {
  describe('valid URLs (should pass)', () => {
    it('accepts https:// URLs', () => {
      expect(getSafeHttpHref('https://example.com')).toBe('https://example.com');
      expect(getSafeHttpHref('https://example.com/path')).toBe('https://example.com/path');
      expect(getSafeHttpHref('https://example.com/path?query=value')).toBe('https://example.com/path?query=value');
      expect(getSafeHttpHref('https://example.com:8080/path')).toBe('https://example.com:8080/path');
    });

    it('accepts http:// URLs', () => {
      expect(getSafeHttpHref('http://example.com')).toBe('http://example.com');
      expect(getSafeHttpHref('http://example.com/path')).toBe('http://example.com/path');
    });

    it('preserves case in URL path', () => {
      expect(getSafeHttpHref('https://Example.com/Path')).toBe('https://Example.com/Path');
    });
  });

  describe('XSS attacks (should be blocked)', () => {
    it('blocks javascript: URLs', () => {
      expect(getSafeHttpHref('javascript:alert("XSS")')).toBeNull();
      expect(getSafeHttpHref('javascript:alert(\'XSS\')')).toBeNull();
      expect(getSafeHttpHref('javascript:void(0)')).toBeNull();
      expect(getSafeHttpHref('javascript:eval(atob("YWxlcnQoMSk="))')).toBeNull();
      expect(getSafeHttpHref('JAVASCRIPT:alert(1)')).toBeNull(); // case insensitive
    });

    it('blocks data: URLs', () => {
      expect(getSafeHttpHref('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(getSafeHttpHref('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBeNull();
    });

    it('blocks vbscript: URLs', () => {
      expect(getSafeHttpHref('vbscript:msgbox("XSS")')).toBeNull();
    });

    it('blocks file: URLs', () => {
      expect(getSafeHttpHref('file:///etc/passwd')).toBeNull();
      expect(getSafeHttpHref('file:///C:/Windows/System32')).toBeNull();
    });

    it('blocks other dangerous protocols', () => {
      expect(getSafeHttpHref('about:blank')).toBeNull();
      expect(getSafeHttpHref('chrome://settings')).toBeNull();
    });
  });

  describe('relative URLs (should be blocked)', () => {
    it('blocks relative paths', () => {
      expect(getSafeHttpHref('/evil')).toBeNull();
      expect(getSafeHttpHref('./evil')).toBeNull();
      expect(getSafeHttpHref('../evil')).toBeNull();
      expect(getSafeHttpHref('//evil.com')).toBeNull(); // protocol-relative
    });
  });

  describe('edge cases', () => {
    it('handles null and undefined', () => {
      expect(getSafeHttpHref(null)).toBeNull();
      expect(getSafeHttpHref(undefined)).toBeNull();
    });

    it('handles empty strings', () => {
      expect(getSafeHttpHref('')).toBeNull();
      expect(getSafeHttpHref('   ')).toBeNull(); // whitespace only
    });

    it('trims whitespace', () => {
      expect(getSafeHttpHref('  https://example.com  ')).toBe('https://example.com');
    });

    it('handles invalid URLs', () => {
      expect(getSafeHttpHref('not a url')).toBeNull();
      expect(getSafeHttpHref('ht tp://example.com')).toBeNull(); // space in protocol
      expect(getSafeHttpHref('https://')).toBeNull(); // incomplete URL
    });

    it('handles URLs that look safe but have issues', () => {
      // These start with http:// or https:// but might be malformed
      expect(getSafeHttpHref('https://')).toBeNull(); // no domain
      expect(getSafeHttpHref('http://')).toBeNull(); // no domain
    });
  });
});

describe('getSafeMailtoHref', () => {
  describe('valid emails (should pass)', () => {
    it('accepts standard email formats', () => {
      expect(getSafeMailtoHref('user@example.com')).toBe('mailto:user@example.com');
      expect(getSafeMailtoHref('contact@example.com')).toBe('mailto:contact@example.com');
      expect(getSafeMailtoHref('test.email+tag@example.co.uk')).toBe('mailto:test.email+tag@example.co.uk');
      expect(getSafeMailtoHref('user_name@example-domain.com')).toBe('mailto:user_name@example-domain.com');
    });

    it('trims whitespace', () => {
      expect(getSafeMailtoHref('  user@example.com  ')).toBe('mailto:user@example.com');
    });
  });

  describe('XSS attacks via attribute breakout (should be blocked)', () => {
    it('blocks emails with double quotes', () => {
      expect(getSafeMailtoHref('x@y.com" onmouseover="alert(1)')).toBeNull();
      expect(getSafeMailtoHref('x@y.com" onclick="alert(1)')).toBeNull();
      expect(getSafeMailtoHref('x@y.com" style="color:red')).toBeNull();
    });

    it('blocks emails with single quotes', () => {
      expect(getSafeMailtoHref("x@y.com' onmouseover='alert(1)")).toBeNull();
    });

    it('blocks emails with angle brackets', () => {
      expect(getSafeMailtoHref('x@y.com<script>alert(1)</script>')).toBeNull();
      expect(getSafeMailtoHref('<script>alert(1)</script>@example.com')).toBeNull();
    });

    it('blocks emails with newlines', () => {
      expect(getSafeMailtoHref('x@y.com\nonmouseover=alert(1)')).toBeNull();
      expect(getSafeMailtoHref('x@y.com\ronmouseover=alert(1)')).toBeNull();
    });

    it('blocks emails with spaces', () => {
      expect(getSafeMailtoHref('x@y.com onmouseover=alert(1)')).toBeNull();
      expect(getSafeMailtoHref('x @y.com')).toBeNull();
    });

    it('blocks emails with backslashes', () => {
      expect(getSafeMailtoHref('x@y.com\\onmouseover=alert(1)')).toBeNull();
    });

    it('blocks complex XSS attempts', () => {
      expect(getSafeMailtoHref('x@y.com" onmouseover="alert(document.cookie)')).toBeNull();
      expect(getSafeMailtoHref('x@y.com" onfocus="alert(1)" autofocus')).toBeNull();
    });
  });

  describe('invalid email formats (should be blocked)', () => {
    it('blocks emails without @', () => {
      expect(getSafeMailtoHref('notanemail')).toBeNull();
      expect(getSafeMailtoHref('user.example.com')).toBeNull();
    });

    it('blocks emails without domain', () => {
      expect(getSafeMailtoHref('user@')).toBeNull();
      expect(getSafeMailtoHref('@example.com')).toBeNull();
    });

    it('blocks emails without TLD', () => {
      expect(getSafeMailtoHref('user@example')).toBeNull();
    });

    it('blocks emails with invalid characters', () => {
      expect(getSafeMailtoHref('user name@example.com')).toBeNull(); // space
      expect(getSafeMailtoHref('user@exam ple.com')).toBeNull(); // space in domain
    });
  });

  describe('edge cases', () => {
    it('handles null and undefined', () => {
      expect(getSafeMailtoHref(null)).toBeNull();
      expect(getSafeMailtoHref(undefined)).toBeNull();
    });

    it('handles empty strings', () => {
      expect(getSafeMailtoHref('')).toBeNull();
      expect(getSafeMailtoHref('   ')).toBeNull(); // whitespace only
    });

    it('handles very long emails', () => {
      const longEmail = 'a'.repeat(100) + '@example.com';
      expect(getSafeMailtoHref(longEmail)).toBe(`mailto:${longEmail}`);
    });
  });
});

describe('real-world attack scenarios', () => {
  it('blocks common XSS payloads in URLs', () => {
    const attacks = [
      'javascript:alert(document.cookie)',
      'javascript:void(0);alert(1)',
      'javascript:eval(String.fromCharCode(97,108,101,114,116,40,49,41))',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox("XSS")',
    ];

    attacks.forEach(attack => {
      expect(getSafeHttpHref(attack)).toBeNull();
    });
  });

  it('blocks common XSS payloads in emails', () => {
    const attacks = [
      'x@y.com" onmouseover="alert(1)',
      'x@y.com\' onclick=\'alert(1)',
      'x@y.com<script>alert(1)</script>',
      'x@y.com" style="expression(alert(1))',
      'x@y.com" onfocus="alert(1)" autofocus',
    ];

    attacks.forEach(attack => {
      expect(getSafeMailtoHref(attack)).toBeNull();
    });
  });

  it('allows legitimate URLs that might look suspicious', () => {
    // These are valid URLs that should pass
    expect(getSafeHttpHref('https://example.com/alert(1)')).toBe('https://example.com/alert(1)');
    expect(getSafeHttpHref('https://example.com?javascript=test')).toBe('https://example.com?javascript=test');
    expect(getSafeHttpHref('https://javascript.com')).toBe('https://javascript.com'); // legitimate domain
  });
});
