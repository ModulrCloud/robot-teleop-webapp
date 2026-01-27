/**
 * Shared parsing utilities for post content
 * Used by both PostCard and CreatePostModal preview
 */

export type ContentPart =
  | string
  | { type: "hashtag" | "mention" | "codeblock" | "inlinecode" | "bold" | "italic"; text: string; language?: string };

/**
 * Parse content to extract code blocks, inline code, hashtags, and mentions
 */
export function parseContent(text: string): ContentPart[] {
  const parts: ContentPart[] = [];

  // First, extract code blocks (```language\ncode\n```)
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add text before code block
    const beforeText = text.substring(lastIndex, match.index);
    if (beforeText) {
      parts.push(...parseTextForHashtagsMentionsAndInlineCode(beforeText));
    }

    // Add code block
    parts.push({
      type: "codeblock",
      text: match[2],
      language: match[1] || undefined,
    });

    lastIndex = codeBlockRegex.lastIndex;
  }

  // Add remaining text after last code block
  const remainingText = text.substring(lastIndex);
  if (remainingText) {
    parts.push(...parseTextForHashtagsMentionsAndInlineCode(remainingText));
  }

  return parts;
}

/**
 * Helper function to parse hashtags, mentions, and inline code from text
 */
function parseTextForHashtagsMentionsAndInlineCode(text: string): ContentPart[] {
  const parts: ContentPart[] = [];
  
  // First, extract inline code (single backticks, not triple)
  // Match `code` but not ```code```
  const inlineCodeRegex = /(?<!`)`([^`\n]+)`(?!`)/g;
  let lastIndex = 0;
  let match;

  while ((match = inlineCodeRegex.exec(text)) !== null) {
    // Add text before inline code
    const beforeText = text.substring(lastIndex, match.index);
    if (beforeText) {
      parts.push(...parseHashtagsAndMentions(beforeText));
    }

    // Add inline code
    parts.push({
      type: "inlinecode",
      text: match[1],
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last inline code
  const remainingText = text.substring(lastIndex);
  if (remainingText) {
    parts.push(...parseHashtagsAndMentions(remainingText));
  }

  return parts;
}

/**
 * Helper function to parse bold, italic, hashtags, and mentions
 */
function parseHashtagsAndMentions(text: string): ContentPart[] {
  const parts: ContentPart[] = [];
  
  // First, extract bold (**text**) and italic (*text*)
  // Priority: bold before italic (to avoid conflicts)
  // Match **text** but not ***text*** (which should be bold, not bold+italic)
  // Match *text* but not **text** (which is bold) or `*text*` (which is inline code)
  let lastIndex = 0;
  
  // Extract bold (**text**) first
  // Match **text** but ensure it's not part of ***text*** (which would be bold with * inside)
  const boldRegex = /\*\*([^*]+?)\*\*/g;
  const boldMatches: Array<{ start: number; end: number; text: string }> = [];
  let boldMatch;
  
  while ((boldMatch = boldRegex.exec(text)) !== null) {
    // Skip if this is actually ***text*** (triple asterisks - treat as bold with * inside)
    const before = text[boldMatch.index - 1];
    const after = text[boldMatch.index + boldMatch[0].length];
    if (before === '*' || after === '*') {
      // This is part of ***text***, skip it
      continue;
    }
    
    boldMatches.push({
      start: boldMatch.index,
      end: boldMatch.index + boldMatch[0].length,
      text: boldMatch[1],
    });
  }
  
  // Extract italic (*text*) but not inside bold or code
  // Use negative lookbehind/lookahead to avoid matching **text** or `*text*`
  const italicRegex = /(?<!\*)\*(?![*`])([^*\n`]+?)(?<![*`])\*(?![*`])/g;
  const italicMatches: Array<{ start: number; end: number; text: string }> = [];
  let italicMatch: RegExpExecArray | null;
  
  while ((italicMatch = italicRegex.exec(text)) !== null) {
    // Check if this italic is inside a bold match
    const insideBold = boldMatches.some(bm => 
      italicMatch!.index >= bm.start && italicMatch!.index < bm.end
    );
    
    if (!insideBold) {
      italicMatches.push({
        start: italicMatch.index,
        end: italicMatch.index + italicMatch[0].length,
        text: italicMatch[1],
      });
    }
  }
  
  // Combine all matches and sort by position
  interface FormatMatch {
    start: number;
    end: number;
    text: string;
    type: 'bold' | 'italic';
  }
  
  const allMatches: FormatMatch[] = [
    ...boldMatches.map(m => ({ ...m, type: 'bold' as const })),
    ...italicMatches.map(m => ({ ...m, type: 'italic' as const })),
  ].sort((a, b) => a.start - b.start);
  
  // Remove overlapping matches (keep first one)
  const nonOverlappingMatches: FormatMatch[] = [];
  let lastEnd = 0;
  
  for (const match of allMatches) {
    if (match.start >= lastEnd) {
      nonOverlappingMatches.push(match);
      lastEnd = match.end;
    }
  }
  
  // Build parts array
  for (const match of nonOverlappingMatches) {
    // Add text before this match
    if (match.start > lastIndex) {
      const beforeText = text.substring(lastIndex, match.start);
      parts.push(...parseHashtagsAndMentionsOnly(beforeText));
    }
    
    // Add the formatted text (keep as single string for now - hashtags/mentions inside won't be parsed)
    // This simplifies things and bold/italic text is usually short anyway
    parts.push({ type: match.type, text: match.text });
    
    lastIndex = match.end;
  }
  
  // Add remaining text after last match
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    parts.push(...parseHashtagsAndMentionsOnly(remainingText));
  }
  
  return parts.length > 0 ? parts : parseHashtagsAndMentionsOnly(text);
}

/**
 * Helper function to parse just hashtags and mentions (no bold/italic)
 */
function parseHashtagsAndMentionsOnly(text: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const words = text.split(/(\s+)/);

  words.forEach((word) => {
    if (word.startsWith("#")) {
      const tag = word.replace(/[^\w-]/g, "");
      if (tag) {
        parts.push({ type: "hashtag", text: word });
      } else {
        parts.push(word);
      }
    } else if (word.startsWith("@")) {
      const mention = word.replace(/[^\w-]/g, "");
      if (mention) {
        parts.push({ type: "mention", text: word });
      } else {
        parts.push(word);
      }
    } else {
      parts.push(word);
    }
  });

  return parts;
}
