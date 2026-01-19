/**
 * Shared parsing utilities for post content
 * Used by both PostCard and CreatePostModal preview
 */

export type ContentPart =
  | string
  | { type: "hashtag" | "mention" | "codeblock" | "inlinecode"; text: string; language?: string };

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
 * Helper function to parse just hashtags and mentions
 */
function parseHashtagsAndMentions(text: string): ContentPart[] {
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
