import React, { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faHeart,
  faComment,
  faShare,
  faFlag,
  faUser,
  faClock,
  faCopy,
  faPlay,
  faCheck,
  faChevronLeft,
  faChevronRight,
  faTimes,
  faCheckCircle,
} from "@fortawesome/free-solid-svg-icons";
import { useTwemoji } from "../utils/emojiRenderer";
import { parseContent } from "../utils/postContentParser";
import "./PostCard.css";

type UserBadge = 'partner' | 'verified' | 'moderator';

interface PostCardProps {
  username: string;
  userAvatar?: string;
  userBadge?: UserBadge;
  content: string;
  images?: string[];
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  onUsernameClick?: (username: string) => void;
}

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

export function PostCard({
  username,
  userAvatar,
  userBadge,
  content,
  images = [],
  createdAt,
  likesCount,
  commentsCount,
  sharesCount,
  onUsernameClick,
}: PostCardProps) {
  const [copiedCodeBlocks, setCopiedCodeBlocks] = useState<Record<number, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [selectedPollOption, setSelectedPollOption] = useState<number | null>(null);
  // Format relative time (simple version)
  const formatTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  // Parse poll from content (detect lines starting with "- ()")
  // Trusted image hosting domains for security
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

  // Parse markdown images from content: ![alt](url)
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
  
  // Extract image URLs for rendering
  const extractedImageUrls: string[] = markdownImages.map(img => img.url);

  // Copy code block to clipboard
  const handleCopyCode = async (code: string, blockIndex: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeBlocks(prev => ({ ...prev, [blockIndex]: true }));
      setTimeout(() => {
        setCopiedCodeBlocks(prev => {
          const updated = { ...prev };
          delete updated[blockIndex];
          return updated;
        });
      }, 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  // Handle run code (future feature - Phase 3)
  const handleRunCode = (code: string, language?: string) => {
    // Future: Execute code in sandboxed environment
    console.log(`Would run ${language || 'code'}:`, code);
    // For now, just show a message
    alert(`Code execution coming soon in Phase 3! 🚀\n\nWould execute ${language || 'code'}:\n${code.substring(0, 50)}...`);
  };

  // Get badge info
  const getBadgeInfo = (badge?: UserBadge): { label: string; icon: string | IconDefinition; color: string; useIcon: boolean } | null => {
    switch (badge) {
      case 'partner':
        return { label: 'Partner', icon: '🤝', color: '#ffc107', useIcon: false };
      case 'verified':
        return { label: 'Verified', icon: faCheckCircle, color: '#ffc107', useIcon: true };
      case 'moderator':
        return { label: 'Moderator', icon: '🛡️', color: '#2196f3', useIcon: false };
      default:
        return null;
    }
  };

  const badgeInfo = getBadgeInfo(userBadge);

  // Track code block index for copy/run buttons
  let codeBlockIndex = 0;

  // Ref for post content to apply Twemoji
  const postContentRef = useRef<HTMLDivElement>(null);
  useTwemoji(postContentRef as React.RefObject<HTMLElement>, [content]);

  // Helper function to detect if an image URL is a GIF
  const isGif = (url: string): boolean => {
    return url.toLowerCase().endsWith('.gif') || 
           url.includes('giphy.com') ||
           url.includes('media.giphy.com') ||
           url.includes('tenor.com') ||
           url.includes('media.tenor.com');
  };

  // Combine provided images with extracted markdown images
  const allImages = [...images, ...extractedImageUrls];

  return (
    <div className="post-card">
      {/* Post Header */}
      <div className="post-header">
        <div className="post-avatar-container">
          <div className="post-avatar">
            {userAvatar ? (
              <img src={userAvatar} alt={username} />
            ) : (
              <FontAwesomeIcon icon={faUser} className="avatar-icon" />
            )}
          </div>
          {badgeInfo && (
            <div 
              className="post-avatar-badge" 
              title={badgeInfo.label}
              style={{ backgroundColor: badgeInfo.color }}
            >
              {badgeInfo.useIcon ? (
                <FontAwesomeIcon icon={badgeInfo.icon as IconDefinition} className="badge-icon" />
              ) : (
                badgeInfo.icon as string
              )}
            </div>
          )}
        </div>
        <div className="post-header-info">
          <button
            className="post-username-button"
            onClick={() => onUsernameClick?.(username)}
            title={`View ${username}'s profile`}
          >
            {username}
          </button>
          <span className="post-separator">•</span>
          <span className="post-timestamp">
            <FontAwesomeIcon icon={faClock} className="timestamp-icon" />
            {formatTime(createdAt)}
          </span>
        </div>
      </div>

      {/* Post Content */}
      <div className="post-content" ref={postContentRef}>
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
                  } else if (part.type === "codeblock") {
                    const currentBlockIndex = codeBlockIndex++;
                    const isCopied = copiedCodeBlocks[currentBlockIndex];
                    return (
                      <div key={key} className="post-code-block">
                        <div className="post-code-header">
                          {part.language && (
                            <span className="post-code-language">{part.language}</span>
                          )}
                          <div className="post-code-actions">
                            <button
                              className="post-code-button copy-button"
                              onClick={() => handleCopyCode(part.text, currentBlockIndex)}
                              title="Copy code"
                            >
                              <FontAwesomeIcon icon={isCopied ? faCheck : faCopy} />
                              <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                            </button>
                            <button
                              className="post-code-button run-button"
                              onClick={() => handleRunCode(part.text, part.language)}
                              title="Run code (Phase 3)"
                            >
                              <FontAwesomeIcon icon={faPlay} />
                              <span>Run</span>
                            </button>
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
                        onClick={() => {
                          const allImagesIndex = allImages.indexOf(imageUrl);
                          setLightboxIndex(allImagesIndex >= 0 ? allImagesIndex : imgIndex);
                          setLightboxOpen(true);
                        }}
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
                      name={`poll-${username}-${createdAt}`}
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

      {/* Image Gallery - Only show if images were provided via props (not extracted from markdown) */}
      {images.length > 0 && extractedImageUrls.length === 0 && (
        <div className="post-images">
          <div className={`post-image-grid ${images.length === 1 ? 'single' : images.length === 2 ? 'two-col' : 'four-col'}`}>
            {images.slice(0, 4).map((image, index) => {
              const isLastVisible = index === 3 && images.length > 4;
              const extraCount = images.length - 4;
              return (
                <div
                  key={index}
                  className="post-image-item"
                  onClick={() => {
                    setLightboxIndex(index);
                    setLightboxOpen(true);
                  }}
                >
                  {isGif(image) ? (
                    <div className="post-image-gif-container">
                      <img src={image} alt={`Post GIF ${index + 1}`} loading="lazy" />
                      <div className="post-gif-badge">GIF</div>
                    </div>
                  ) : (
                    <img src={image} alt={`Post image ${index + 1}`} loading="lazy" />
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
      )}

      {/* Interaction Bar */}
      <div className="post-interactions">
        <button className="post-interaction-button like-button" title="Click & hold to dislike">
          <FontAwesomeIcon icon={faHeart} />
          <span>{likesCount}</span>
        </button>
        <button className="post-interaction-button comment-button" title="View comments">
          <FontAwesomeIcon icon={faComment} />
          <span>{commentsCount}</span>
        </button>
        <button className="post-interaction-button share-button" title="Share post">
          <FontAwesomeIcon icon={faShare} />
          <span>{sharesCount}</span>
        </button>
        <button className="post-interaction-button flag-button" title="Report post">
          <FontAwesomeIcon icon={faFlag} />
        </button>
      </div>

      {/* Lightbox Modal */}
      {lightboxOpen && allImages.length > 0 && (
        <ImageLightbox
          images={allImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
          onNavigate={(newIndex) => setLightboxIndex(newIndex)}
        />
      )}

    </div>
  );
}

// Image Lightbox Component
interface ImageLightboxProps {
  images: string[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

function ImageLightbox({ images, currentIndex, onClose, onNavigate }: ImageLightboxProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        onNavigate(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < images.length - 1) {
        onNavigate(currentIndex + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden'; // Prevent body scroll

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [currentIndex, images.length, onClose, onNavigate]);

  return (
    <div className="post-lightbox" onClick={onClose}>
      <button className="post-lightbox-close" onClick={onClose} title="Close (ESC)">
        <FontAwesomeIcon icon={faTimes} />
      </button>
      {currentIndex > 0 && (
        <button
          className="post-lightbox-nav post-lightbox-prev"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex - 1);
          }}
          title="Previous (←)"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
      )}
      <div className="post-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={images[currentIndex]} alt={`Lightbox image ${currentIndex + 1}`} />
        <div className="post-lightbox-counter">
          {currentIndex + 1} / {images.length}
        </div>
      </div>
      {currentIndex < images.length - 1 && (
        <button
          className="post-lightbox-nav post-lightbox-next"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex + 1);
          }}
          title="Next (→)"
        >
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      )}
    </div>
  );
}
