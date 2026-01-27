/**
 * Post content extraction utilities for database storage
 * Extracts hashtags, mentions, images, polls, and linked robots from post content
 * Used when creating/updating posts in the database
 */

export interface ExtractedImage {
  url: string;
  alt: string;
}

export interface ExtractedPoll {
  options: string[];
}

/**
 * Check if an image URL is from a trusted source
 * Only allows Giphy, Tenor (future), and AWS S3
 */
export function isTrustedImageUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const trustedDomains = [
      'giphy.com',
      'media.giphy.com',
      'tenor.com',
      'media.tenor.com',
      's3.amazonaws.com',
    ];
    
    return trustedDomains.some(domain => 
      hostname === domain || 
      hostname.endsWith('.' + domain) || 
      hostname.includes('.s3.amazonaws.com')
    );
  } catch {
    return false;
  }
}

/**
 * Extract hashtags from post content
 * Returns array of unique hashtags (without the # symbol)
 * Format: #hashtag or #robot-robotId
 */
export function extractHashtags(content: string): string[] {
  const hashtagRegex = /#([\w-]+)/g;
  const matches = [...content.matchAll(hashtagRegex)];
  const hashtags = new Set<string>();
  
  matches.forEach(match => {
    const tag = match[1];
    if (tag) {
      hashtags.add(tag.toLowerCase());
    }
  });
  
  return Array.from(hashtags);
}

/**
 * Extract mentions from post content
 * Returns array of unique mentions (without the @ symbol)
 * Format: @username
 */
export function extractMentions(content: string): string[] {
  const mentionRegex = /@([\w-]+)/g;
  const matches = [...content.matchAll(mentionRegex)];
  const mentions = new Set<string>();
  
  matches.forEach(match => {
    const mention = match[1];
    if (mention) {
      mentions.add(mention.toLowerCase());
    }
  });
  
  return Array.from(mentions);
}

/**
 * Extract markdown images from post content
 * Format: ![alt text](url)
 * Only includes images from trusted sources
 */
export function extractMarkdownImages(content: string): ExtractedImage[] {
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images: ExtractedImage[] = [];
  let match;

  while ((match = markdownImageRegex.exec(content)) !== null) {
    const alt = match[1] || '';
    const url = match[2].trim();
    
    // Only include if URL is from trusted source
    if (isTrustedImageUrl(url)) {
      images.push({ url, alt });
    }
  }

  return images;
}

/**
 * Extract poll from post content
 * Format: Lines starting with "- ()" (at least 2 options required)
 * Returns null if no poll found
 */
export function extractPoll(content: string): ExtractedPoll | null {
  const pollRegex = /- \(\)\s+(.+)$/gm;
  const matches = [...content.matchAll(pollRegex)];
  
  if (matches.length >= 2) {
    // Found a poll (need at least 2 options)
    const options = matches.map(match => match[1].trim());
    return { options };
  }
  
  return null;
}

/**
 * Extract linked robot ID from hashtags
 * Format: #robot-robotId (e.g., #robot-abc123)
 * Returns the robotId part, or null if not found
 */
export function extractLinkedRobotId(content: string): string | null {
  const hashtags = extractHashtags(content);
  
  // Look for hashtag starting with "robot-"
  const robotHashtag = hashtags.find(tag => tag.startsWith('robot-'));
  if (robotHashtag) {
    // Extract the robotId part (everything after "robot-")
    const robotId = robotHashtag.replace(/^robot-/, '');
    return robotId || null;
  }
  
  return null;
}

/**
 * Determine post type from content
 * Returns 'poll', 'gif', 'image', 'code', or 'text'
 */
export function determinePostType(content: string): 'poll' | 'gif' | 'image' | 'code' | 'text' {
  // Check for poll first
  if (extractPoll(content)) {
    return 'poll';
  }
  
  // Check for images/GIFs
  const images = extractMarkdownImages(content);
  if (images.length > 0) {
    // Check if any image is a GIF (by URL or file extension)
    const hasGif = images.some(img => {
      const url = img.url.toLowerCase();
      return url.includes('.gif') || url.includes('giphy') || url.includes('tenor');
    });
    return hasGif ? 'gif' : 'image';
  }
  
  // Check for code blocks
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  if (codeBlockRegex.test(content)) {
    return 'code';
  }
  
  // Default to text
  return 'text';
}

/**
 * Extract all post metadata from content for database storage
 * Returns an object with all extracted fields
 */
export function extractPostMetadata(content: string): {
  hashtags: string[];
  mentions: string[];
  images: ExtractedImage[];
  poll: ExtractedPoll | null;
  linkedRobotId: string | null;
  postType: 'poll' | 'gif' | 'image' | 'code' | 'text';
} {
  return {
    hashtags: extractHashtags(content),
    mentions: extractMentions(content),
    images: extractMarkdownImages(content),
    poll: extractPoll(content),
    linkedRobotId: extractLinkedRobotId(content),
    postType: determinePostType(content),
  };
}
