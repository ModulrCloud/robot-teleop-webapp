import React, { useRef, useState } from 'react';
import { parseContent } from '../utils/postContentParser';
import { useTwemoji } from '../utils/emojiRenderer';
import './PostCard.css'; // Reuse PostCard styles

interface PollOption {
  id: number;
  text: string;
}

interface Poll {
  options: PollOption[];
}

interface MarkdownImage {
  url: string;
  alt: string;
  startIndex: number;
  endIndex: number;
}

interface PostContentPreviewProps {
  content: string;
}

export function PostContentPreview({ content }: PostContentPreviewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectedPollOption, setSelectedPollOption] = useState<number | null>(null);
  useTwemoji(contentRef as React.RefObject<HTMLElement>, [content]);

  // Trusted image hosting domains for security (same as PostCard)
  const isTrustedImageUrl = (url: string): boolean => {
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
        hostname === domain || hostname.endsWith('.' + domain) || hostname.includes('.s3.amazonaws.com')
      );
    } catch {
      return false;
    }
  };

  // Parse poll from content (same logic as PostCard)
  const parsePoll = (text: string): Poll | null => {
    const pollRegex = /- \(\)\s+(.+)$/gm;
    const matches = [...text.matchAll(pollRegex)];
    
    if (matches.length >= 2) {
      // Found a poll (need at least 2 options)
      const options: PollOption[] = matches.map((match, index) => ({
        id: index,
        text: match[1].trim(),
      }));
      
      return { options };
    }
    
    return null;
  };

  // Parse markdown images from content: ![alt](url) (same logic as PostCard)
  const parseMarkdownImages = (text: string): MarkdownImage[] => {
    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const images: MarkdownImage[] = [];
    let match;

    while ((match = markdownImageRegex.exec(text)) !== null) {
      const alt = match[1] || '';
      const url = match[2].trim();
      
      // Only include if URL is from trusted source
      if (isTrustedImageUrl(url)) {
        images.push({
          url,
          alt,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      }
    }

    return images;
  };

  // Sequential parsing approach: Find all special elements (images and polls) in order
  const markdownImages = parseMarkdownImages(content);
  const poll = parsePoll(content);
  
  // Create a sorted list of all special elements with their positions
  interface SpecialElement {
    type: 'image' | 'poll';
    startIndex: number;
    endIndex: number;
    data: MarkdownImage | Poll;
  }
  
  const specialElements: SpecialElement[] = [];
  
  // Add images
  markdownImages.forEach(img => {
    specialElements.push({
      type: 'image',
      startIndex: img.startIndex,
      endIndex: img.endIndex,
      data: img,
    });
  });
  
  // Add poll if found
  if (poll) {
    const pollStartRegex = /(\r?\n)?- \(\)\s+/;
    const pollStartMatch = content.search(pollStartRegex);
    if (pollStartMatch !== -1) {
      const pollLines = content.match(/^\s*- \(\)\s+.+$/gm);
      if (pollLines) {
        const lastPollLine = pollLines[pollLines.length - 1];
        const lastPollLineIndex = content.lastIndexOf(lastPollLine);
        const pollEndIndex = lastPollLineIndex + lastPollLine.length;
        
        specialElements.push({
          type: 'poll',
          startIndex: pollStartMatch,
          endIndex: pollEndIndex,
          data: poll,
        });
      }
    }
  }
  
  // Sort by position in content
  specialElements.sort((a, b) => a.startIndex - b.startIndex);
  
  // Extract content sections in order
  const contentSections: Array<{ type: 'text' | 'image' | 'poll'; content?: string; data?: MarkdownImage | Poll }> = [];
  let lastIndex = 0;
  
  specialElements.forEach((element) => {
    // Add text before this element
    if (element.startIndex > lastIndex) {
      const textBefore = content.substring(lastIndex, element.startIndex).trim();
      if (textBefore) {
        contentSections.push({ type: 'text', content: textBefore });
      }
    }
    
    // Add the special element
    if (element.type === 'image') {
      contentSections.push({ type: 'image', data: element.data });
    } else if (element.type === 'poll') {
      contentSections.push({ type: 'poll', data: element.data });
    }
    
    lastIndex = element.endIndex;
  });
  
  // Add remaining text after last element (only if we had special elements)
  if (specialElements.length > 0 && lastIndex < content.length) {
    const textAfter = content.substring(lastIndex).trim();
    if (textAfter) {
      contentSections.push({ type: 'text', content: textAfter });
    }
  }
  
  // If no special elements, just add all content as text
  if (specialElements.length === 0) {
    contentSections.push({ type: 'text', content: content });
  }
  

  // Helper function to detect if an image URL is a GIF (same as PostCard)
  const isGif = (url: string): boolean => {
    return url.toLowerCase().endsWith('.gif') || 
           url.includes('giphy.com') ||
           url.includes('media.giphy.com') ||
           url.includes('tenor.com') ||
           url.includes('media.tenor.com');
  };

  return (
    <div className="post-content" ref={contentRef}>
      {/* Render content sections in order (sequential parsing approach) */}
      {contentSections.map((section, sectionIndex) => {
        if (section.type === 'text' && section.content) {
          // Parse and render text content
          const textParts = parseContent(section.content);
          return (
            <React.Fragment key={sectionIndex}>
              {textParts.map((part, partIndex) => {
                const key = `${sectionIndex}-${partIndex}`;
                if (typeof part === "string") {
                  return <span key={key}>{part}</span>;
                } else if (part.type === "hashtag") {
                  return (
                    <span key={key} className="post-hashtag">
                      {part.text}
                    </span>
                  );
                } else if (part.type === "mention") {
                  return (
                    <span key={key} className="post-mention">
                      {part.text}
                    </span>
                  );
                } else if (part.type === "inlinecode") {
                  return (
                    <code key={key} className="post-inline-code">
                      {part.text}
                    </code>
                  );
                } else if (part.type === "bold") {
                  return (
                    <strong key={key} className="post-bold">
                      {part.text}
                    </strong>
                  );
                } else if (part.type === "italic") {
                  return (
                    <em key={key} className="post-italic">
                      {part.text}
                    </em>
                  );
                } else if (part.type === "codeblock") {
                  return (
                    <div key={key} className="post-code-block">
                      <div className="post-code-header">
                        {part.language && (
                          <span className="post-code-language">
                            {part.language.charAt(0).toUpperCase() + part.language.slice(1).toLowerCase()}
                          </span>
                        )}
                        <div className="post-code-actions">
                          <span className="post-code-language" style={{ opacity: 0.5 }}>
                            Preview
                          </span>
                        </div>
                      </div>
                      <pre className="post-code-content">
                        <code>{part.text}</code>
                      </pre>
                    </div>
                  );
                }
                return null;
              })}
            </React.Fragment>
          );
        } else if (section.type === 'image' && section.data) {
          // Group consecutive images together
          // Check if previous section was also an image - if so, skip (already rendered)
          if (sectionIndex > 0 && contentSections[sectionIndex - 1].type === 'image') {
            return null; // Skip - already rendered in previous image group
          }
          
          // Collect all consecutive images starting from this one
          const imageGroup: MarkdownImage[] = [];
          for (let i = sectionIndex; i < contentSections.length; i++) {
            if (contentSections[i].type === 'image' && contentSections[i].data) {
              imageGroup.push(contentSections[i].data as MarkdownImage);
            } else {
              break;
            }
          }
          
          const imageUrls = imageGroup.map(img => img.url);
          return (
            <div key={sectionIndex} className="post-images">
              <div className={`post-image-grid ${imageUrls.length === 1 ? 'single' : imageUrls.length === 2 ? 'two-col' : 'four-col'}`}>
                {imageUrls.slice(0, 4).map((imageUrl, imgIndex) => {
                  const isLastVisible = imgIndex === 3 && imageUrls.length > 4;
                  const extraCount = imageUrls.length - 4;
                  return (
                    <div
                      key={imgIndex}
                      className="post-image-item"
                    >
                      {isGif(imageUrl) ? (
                        <div className="post-image-gif-container">
                          <img src={imageUrl} alt={`Post GIF ${imgIndex + 1}`} loading="lazy" />
                          <div className="post-gif-badge">GIF</div>
                        </div>
                      ) : (
                        <img src={imageUrl} alt={`Post image ${imgIndex + 1}`} loading="lazy" />
                      )}
                      {isLastVisible && (
                        <div className="post-image-overlay">
                          +{extraCount}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        } else if (section.type === 'poll' && section.data) {
          // Render poll
          const pollData = section.data as Poll;
          return (
            <div key={sectionIndex} className="post-poll">
              {pollData.options.map((option) => (
                <label key={option.id} className="post-poll-option">
                  <input
                    type="radio"
                    name={`poll-preview`}
                    checked={selectedPollOption === option.id}
                    onChange={() => setSelectedPollOption(option.id)}
                  />
                  <span className="post-poll-option-text">{option.text}</span>
                </label>
              ))}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
