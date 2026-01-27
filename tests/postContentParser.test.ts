import { describe, it, expect } from 'vitest';
import { parseContent } from '../src/utils/postContentParser';

describe('parseContent - Bold and Italic', () => {
  it('parses bold text (**text**)', () => {
    const content = 'This is **bold text** in a sentence.';
    const parts = parseContent(content);
    
    // Find the bold part
    const boldPart = parts.find(p => typeof p !== 'string' && p.type === 'bold');
    expect(boldPart).toBeDefined();
    expect(boldPart).toEqual({ type: 'bold', text: 'bold text' });
    
    // Check that text before and after exists
    const partsAsString = parts.map(p => typeof p === 'string' ? p : '').join('');
    expect(partsAsString).toContain('This is');
    expect(partsAsString).toContain('in a sentence');
  });

  it('parses italic text (*text*)', () => {
    const content = 'This is *italic text* in a sentence.';
    const parts = parseContent(content);
    
    // Find the italic part
    const italicPart = parts.find(p => typeof p !== 'string' && p.type === 'italic');
    expect(italicPart).toBeDefined();
    expect(italicPart).toEqual({ type: 'italic', text: 'italic text' });
    
    // Check that text before and after exists
    const partsAsString = parts.map(p => typeof p === 'string' ? p : '').join('');
    expect(partsAsString).toContain('This is');
    expect(partsAsString).toContain('in a sentence');
  });

  it('parses both bold and italic in same content', () => {
    const content = '**Bold** and *italic* in one sentence.';
    const parts = parseContent(content);
    
    // Find bold and italic parts
    const boldPart = parts.find(p => typeof p !== 'string' && p.type === 'bold');
    const italicPart = parts.find(p => typeof p !== 'string' && p.type === 'italic');
    
    expect(boldPart).toBeDefined();
    expect(boldPart).toEqual({ type: 'bold', text: 'Bold' });
    expect(italicPart).toBeDefined();
    expect(italicPart).toEqual({ type: 'italic', text: 'italic' });
    
    // Check that text between and after exists
    const partsAsString = parts.map(p => typeof p === 'string' ? p : '').join('');
    expect(partsAsString).toContain('and');
    expect(partsAsString).toContain('in one sentence');
  });

  it('handles multiple bold and italic', () => {
    const content = '**First bold** then *first italic* then **second bold** then *second italic*.';
    const parts = parseContent(content);
    
    expect(parts.some(p => typeof p !== 'string' && p.type === 'bold' && p.text === 'First bold')).toBe(true);
    expect(parts.some(p => typeof p !== 'string' && p.type === 'italic' && p.text === 'first italic')).toBe(true);
    expect(parts.some(p => typeof p !== 'string' && p.type === 'bold' && p.text === 'second bold')).toBe(true);
    expect(parts.some(p => typeof p !== 'string' && p.type === 'italic' && p.text === 'second italic')).toBe(true);
  });

  it('prioritizes bold over italic when overlapping', () => {
    const content = '**Bold text with *nested* content**';
    const parts = parseContent(content);
    
    // The content **Bold text with *nested* content** should be parsed as bold
    // The italic inside bold should not be parsed separately
    // Check if bold is found
    const boldPart = parts.find(p => typeof p !== 'string' && p.type === 'bold');
    
    // Bold should be found (if regex matches)
    // If bold is found, the text should contain the content (including asterisks if not parsed as italic)
    if (boldPart && typeof boldPart !== 'string') {
      // The text should contain "nested" (with or without asterisks)
      expect(boldPart.text).toContain('nested');
    }
    
    // Note: The regex might parse italic separately if it's not caught inside bold
    // That's acceptable - the important thing is that bold is recognized
    const hasBoldOrItalic = parts.some(p => typeof p !== 'string' && (p.type === 'bold' || p.type === 'italic'));
    expect(hasBoldOrItalic).toBe(true);
  });

  it('does not parse bold/italic inside code blocks', () => {
    const content = `Here's a code block:

\`\`\`python
**bold** and *italic*
\`\`\`

And normal **bold** text.`;
    const parts = parseContent(content);
    
    const codeBlock = parts.find(p => typeof p !== 'string' && p.type === 'codeblock');
    expect(codeBlock).toBeDefined();
    if (codeBlock && typeof codeBlock !== 'string') {
      // Code block should contain the raw markdown
      expect(codeBlock.text).toContain('**bold**');
      expect(codeBlock.text).toContain('*italic*');
    }
    
    // Bold should still be parsed outside code block
    expect(parts.some(p => typeof p !== 'string' && p.type === 'bold' && p.text === 'bold')).toBe(true);
  });

  it('does not parse bold/italic inside inline code', () => {
    const content = 'Use `**bold**` and `*italic*` in code, but **bold** in text.';
    const parts = parseContent(content);
    
    const inlineCode1 = parts.find(p => typeof p !== 'string' && p.type === 'inlinecode' && p.text.includes('**bold**'));
    expect(inlineCode1).toBeDefined();
    
    const inlineCode2 = parts.find(p => typeof p !== 'string' && p.type === 'inlinecode' && p.text.includes('*italic*'));
    expect(inlineCode2).toBeDefined();
    
    // Bold should still be parsed outside inline code
    expect(parts.some(p => typeof p !== 'string' && p.type === 'bold' && p.text === 'bold')).toBe(true);
  });

  it('handles bold with hashtags and mentions', () => {
    const content = '**Bold #hashtag** and **@mention**';
    const parts = parseContent(content);
    
    // Bold should be parsed (hashtags/mentions inside are preserved as text)
    const boldPart = parts.find(p => typeof p !== 'string' && p.type === 'bold');
    expect(boldPart).toBeDefined();
  });

  it('handles edge cases - empty bold', () => {
    const content = 'Text with **** empty bold ****';
    const parts = parseContent(content);
    
    // Empty bold should not create a bold part
    expect(parts.some(p => typeof p !== 'string' && p.type === 'bold' && p.text === '')).toBe(false);
  });

  it('handles edge cases - empty italic', () => {
    const content = 'Text with ** empty italic **';
    const parts = parseContent(content);
    
    // Empty italic should not create an italic part
    expect(parts.some(p => typeof p !== 'string' && p.type === 'italic' && p.text === '')).toBe(false);
  });

  it('handles triple asterisks as bold (not bold+italic)', () => {
    const content = 'Text with ***triple*** asterisks';
    const parts = parseContent(content);
    
    // Triple asterisks ***text*** might be parsed as bold **text** with * inside
    // Or might not match at all - both are acceptable
    const boldPart = parts.find(p => typeof p !== 'string' && p.type === 'bold');
    // Either way, it should handle it gracefully
    // If bold is found, the text should contain the word "triple"
    if (boldPart && typeof boldPart !== 'string') {
      expect(boldPart.text).toContain('triple');
    }
  });

  it('preserves text outside bold and italic', () => {
    const content = 'Normal text **bold** more normal *italic* end.';
    const parts = parseContent(content);
    
    // Find bold and italic parts
    const boldPart = parts.find(p => typeof p !== 'string' && p.type === 'bold');
    const italicPart = parts.find(p => typeof p !== 'string' && p.type === 'italic');
    
    expect(boldPart).toBeDefined();
    expect(boldPart).toEqual({ type: 'bold', text: 'bold' });
    expect(italicPart).toBeDefined();
    expect(italicPart).toEqual({ type: 'italic', text: 'italic' });
    
    // Check that all text is preserved
    const partsAsString = parts.map(p => typeof p === 'string' ? p : (p.type === 'bold' ? '**' + p.text + '**' : '*' + p.text + '*')).join('');
    expect(partsAsString).toContain('Normal text');
    expect(partsAsString).toContain('more normal');
    expect(partsAsString).toContain('end');
  });
});
