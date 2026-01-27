import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faComment, faUser, faSmile, faSearch } from '@fortawesome/free-solid-svg-icons';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { useSocialProfile } from '../hooks/useSocialProfile';
import { parseContent } from '../utils/postContentParser';
import { TwemojiText } from '../utils/emojiRenderer';
import { getRelativeTime } from '../utils/relativeTimeUpdater';
import { extractMarkdownImages, isTrustedImageUrl } from '../utils/postContentExtractor';
import { UsernameRegistrationModal } from './UsernameRegistrationModal';
import { logger } from '../utils/logger';
import './CommentModal.css';

const client = generateClient<Schema>();

// Giphy GIF type based on their API response
interface GiphyGif {
  id: string;
  title: string;
  images: {
    original: {
      url: string;
    };
    preview_gif: {
      url: string;
    };
  };
}

// Giphy API key from environment variable
const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY || '';

interface CommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  postUsername: string;
  onCommentAdded?: () => void; // Callback when comment is added
}

interface Comment {
  id: string;
  userId: string;
  username: string;
  userAvatar?: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
}

export function CommentModal({ isOpen, onClose, postId, postUsername, onCommentAdded }: CommentModalProps) {
  const { user } = useAuthStatus();
  const { username: socialUsername, hasUsername, refetch: refetchProfile } = useSocialProfile();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearchQuery, setGifSearchQuery] = useState('');
  const [gifResults, setGifResults] = useState<GiphyGif[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const gifPickerRef = useRef<HTMLDivElement>(null);

  const MAX_COMMENT_LENGTH = 512;

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Load comments when modal opens
  useEffect(() => {
    if (isOpen) {
      loadComments();
      setNewComment('');
      setCharCount(0);
      setShowEmojiPicker(false);
      setShowGifPicker(false);
      setGifSearchQuery('');
      setGifResults([]);
    }
  }, [isOpen, postId]);

  // Close emoji/gif pickers when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (gifPickerRef.current && !gifPickerRef.current.contains(event.target as Node)) {
        setShowGifPicker(false);
      }
    };

    if (showEmojiPicker || showGifPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEmojiPicker, showGifPicker]);

  // Scroll to bottom when comments change
  useEffect(() => {
    if (comments.length > 0 && commentsEndRef.current) {
      commentsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [comments.length]);

  // Auto-focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current && user?.username) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, user?.username]);

  const loadComments = async () => {
    setIsLoading(true);
    try {
      const { data, errors } = await client.models.PostComment.list({
        filter: {
          postId: { eq: postId },
          parentCommentId: { attributeExists: false }, // Only top-level comments for now
        },
      });

      if (errors && errors.length > 0) {
        logger.error('Error loading comments:', errors);
        return;
      }

      if (data) {
        // Sort by createdAt (newest first)
        const sortedComments = [...data]
          .filter((c): c is Comment => c !== null)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setComments(sortedComments);
      }
    } catch (error) {
      logger.error('Error loading comments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setNewComment('');
    setCharCount(0);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user?.username || !newComment.trim() || isSubmitting) {
      return;
    }

    if (charCount > MAX_COMMENT_LENGTH) {
      return;
    }

    // Gate: Require username registration before commenting
    if (!hasUsername || !socialUsername) {
      logger.log('[CommentModal] User does not have a username, showing registration modal');
      setShowUsernameModal(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const commentContent = newComment.trim();
      
      // Use the registered @username for display
      const displayUsername = `@${socialUsername}`;
      
      // Optimistic update
      const optimisticComment: Comment = {
        id: `temp-${Date.now()}`,
        userId: user.username,
        username: displayUsername, // Use @username
        content: commentContent,
        createdAt: new Date().toISOString(),
      };

      setComments(prev => [optimisticComment, ...prev]);
      setNewComment('');
      setCharCount(0);

      // Create comment
      const result = await client.models.PostComment.create({
        postId,
        userId: user.username,
        username: displayUsername, // Use @username
        content: commentContent,
        createdAt: new Date().toISOString(),
      });

      if (result.errors && result.errors.length > 0) {
        // Rollback optimistic update
        setComments(prev => prev.filter(c => c.id !== optimisticComment.id));
        setNewComment(commentContent);
        setCharCount(commentContent.length);
        logger.error('Error creating comment:', result.errors);
        throw new Error(`Failed to create comment: ${result.errors.map(e => e.message).join(', ')}`);
      }

      if (result.data) {
        // Replace optimistic comment with real one
        setComments(prev => prev.map(c => 
          c.id === optimisticComment.id ? {
            id: result.data!.id!,
            userId: result.data!.userId!,
            username: result.data!.username!,
            userAvatar: result.data!.userAvatar || undefined,
            content: result.data!.content!,
            createdAt: result.data!.createdAt!,
            updatedAt: result.data!.updatedAt || undefined,
            editedAt: result.data!.editedAt || undefined,
          } : c
        ));

        // Update post commentsCount
        try {
          const { data: post } = await client.models.Post.get({ id: postId });
          if (post) {
            await client.models.Post.update({
              id: postId,
              commentsCount: (post.commentsCount || 0) + 1,
            });
          }
        } catch (updateError) {
          logger.warn('Failed to update post commentsCount:', updateError);
          // Non-fatal - comment was created successfully
        }

        onCommentAdded?.();
      }
    } catch (error) {
      logger.error('Error creating comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= MAX_COMMENT_LENGTH) {
      setNewComment(value);
      setCharCount(value.length);
    }
  };

  const insertAtCursor = (text: string) => {
    if (!textareaRef.current) return;

    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const before = newComment.substring(0, start);
    const after = newComment.substring(end);
    const newText = before + text + after;
    
    if (newText.length <= MAX_COMMENT_LENGTH) {
      setNewComment(newText);
      setCharCount(newText.length);

      // Restore cursor position
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(start + text.length, start + text.length);
      }, 0);
    }
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    insertAtCursor(emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const searchGifs = async (query: string) => {
    if (!query.trim()) {
      setGifResults([]);
      return;
    }

    if (!GIPHY_API_KEY) {
      alert('Giphy API key not configured. You can paste GIF URLs directly into your comment.');
      setGifResults([]);
      return;
    }

    setGifLoading(true);
    try {
      const response = await fetch(
        `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=12&rating=g`
      );
      
      if (!response.ok) {
        throw new Error(`Giphy API error: ${response.status}`);
      }
      
      const data = await response.json() as { data: GiphyGif[] };
      setGifResults(data.data || []);
    } catch (error) {
      logger.error('Error searching GIFs:', error);
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  };

  const handleGifSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setGifSearchQuery(query);
    if (query.trim()) {
      searchGifs(query);
    } else {
      setGifResults([]);
    }
  };

  const insertGifUrl = (gifUrl: string) => {
    insertAtCursor(`\n\n![GIF](${gifUrl})\n\n`);
    setShowGifPicker(false);
    setGifSearchQuery('');
    setGifResults([]);
  };

  // Handle username registration success
  const handleUsernameRegistered = (newUsername: string) => {
    logger.log('[CommentModal] Username registered:', newUsername);
    setShowUsernameModal(false);
    refetchProfile(); // Refresh the social profile
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Username Registration Modal */}
      <UsernameRegistrationModal
        isOpen={showUsernameModal}
        onClose={() => setShowUsernameModal(false)}
        onSuccess={handleUsernameRegistered}
      />
      
      {/* Comment Modal */}
      {createPortal(
    <div className="comment-modal-overlay" onClick={handleClose}>
      <div className="comment-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="comment-modal-header">
          <div className="comment-modal-header-left">
            <FontAwesomeIcon icon={faComment} className="comment-modal-icon" />
            <div>
              <h2>Comments</h2>
              <p className="comment-modal-subtitle">on @{postUsername}'s post</p>
            </div>
          </div>
          <button className="comment-modal-close" onClick={handleClose} aria-label="Close">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {/* Comments List */}
        <div className="comment-modal-body">
          {isLoading ? (
            <div className="comment-loading">Loading comments...</div>
          ) : comments.length === 0 ? (
            <div className="comment-empty">
              <FontAwesomeIcon icon={faComment} />
              <p>No comments yet. Be the first to comment!</p>
            </div>
          ) : (
            <div className="comments-list">
              {comments.map((comment) => (
                <CommentItem key={comment.id} comment={comment} />
              ))}
              <div ref={commentsEndRef} />
            </div>
          )}
        </div>

        {/* Comment Form */}
        {user?.username && (
          <div className="comment-modal-footer">
            <form onSubmit={handleSubmit} className="comment-form">
              <div className="comment-input-container">
                <div className="comment-input-wrapper">
                  <textarea
                    ref={textareaRef}
                    id="comment-content"
                    className="comment-input"
                    placeholder="Write a comment..."
                    value={newComment}
                    onChange={handleCommentChange}
                    rows={3}
                    maxLength={MAX_COMMENT_LENGTH}
                    disabled={isSubmitting}
                  />
                  <div className="comment-input-toolbar">
                    <div className="comment-toolbar-buttons">
                      <button
                        type="button"
                        className="comment-toolbar-button"
                        onClick={() => {
                          setShowEmojiPicker(!showEmojiPicker);
                          setShowGifPicker(false);
                        }}
                        title="Add emoji"
                      >
                        <FontAwesomeIcon icon={faSmile} />
                      </button>
                      <button
                        type="button"
                        className="comment-toolbar-button"
                        onClick={() => {
                          setShowGifPicker(!showGifPicker);
                          setShowEmojiPicker(false);
                        }}
                        title="Add GIF"
                      >
                        <FontAwesomeIcon icon={faSearch} />
                        <span>GIF</span>
                      </button>
                    </div>
                    {showEmojiPicker && (
                      <div ref={emojiPickerRef} className="comment-emoji-picker">
                        <EmojiPicker
                          onEmojiClick={onEmojiClick}
                          theme={Theme.DARK}
                          width="100%"
                        />
                      </div>
                    )}
                    {showGifPicker && (
                      <div ref={gifPickerRef} className="comment-gif-picker">
                        <div className="comment-gif-search">
                          <input
                            type="text"
                            placeholder="Search GIFs..."
                            value={gifSearchQuery}
                            onChange={handleGifSearch}
                            className="comment-gif-search-input"
                          />
                        </div>
                        {gifLoading && (
                          <div className="comment-gif-loading">Loading GIFs...</div>
                        )}
                        {!gifLoading && gifResults.length > 0 && (
                          <div className="comment-gif-results">
                            {gifResults.map((gif) => (
                              <div
                                key={gif.id}
                                className="comment-gif-item"
                                onClick={() => insertGifUrl(gif.images.original.url)}
                              >
                                <img
                                  src={gif.images.preview_gif.url}
                                  alt={gif.title}
                                  loading="lazy"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        {!gifLoading && gifSearchQuery && gifResults.length === 0 && (
                          <div className="comment-gif-empty">No GIFs found. Try a different search.</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="comment-input-footer">
                  <span className="comment-char-count">
                    {charCount}/{MAX_COMMENT_LENGTH}
                  </span>
                  <button
                    type="submit"
                    className="comment-submit-button"
                    disabled={!newComment.trim() || isSubmitting || charCount > MAX_COMMENT_LENGTH}
                  >
                    {isSubmitting ? 'Posting...' : 'Post'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {!user?.username && (
          <div className="comment-modal-footer">
            <div className="comment-login-prompt">
              <FontAwesomeIcon icon={faUser} />
              <p>Sign in to comment</p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
      )}
    </>
  );
}

function CommentItem({ comment }: { comment: Comment }) {
  const relativeTime = getRelativeTime(comment.createdAt);
  const images = extractMarkdownImages(comment.content).filter(img => isTrustedImageUrl(img.url));
  const isGif = (url: string) => url.includes('giphy.com') || url.includes('tenor.com') || url.toLowerCase().endsWith('.gif');
  
  // Strip markdown image syntax from content before parsing
  // This prevents showing both the markdown text and the rendered image
  const contentWithoutImages = comment.content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();
  const contentParts = parseContent(contentWithoutImages);

  return (
    <div className="comment-item">
      <div className="comment-avatar">
        {comment.userAvatar ? (
          <img src={comment.userAvatar} alt={comment.username} />
        ) : (
          <FontAwesomeIcon icon={faUser} />
        )}
      </div>
      <div className="comment-content">
        <div className="comment-header">
          <span className="comment-username">{comment.username}</span>
          <span className="comment-time">{relativeTime}</span>
          {comment.editedAt && (
            <span className="comment-edited">(edited)</span>
          )}
        </div>
        <div className="comment-text">
          {contentParts.map((part, index) => {
            if (typeof part === 'string') {
              return <TwemojiText key={index} text={part} />;
            } else if (part.type === 'hashtag') {
              return (
                <span key={index} className="comment-hashtag">
                  #{part.text}
                </span>
              );
            } else if (part.type === 'mention') {
              return (
                <span key={index} className="comment-mention">
                  @{part.text}
                </span>
              );
            } else if (part.type === 'inlinecode') {
              return (
                <code key={index} className="comment-code">
                  {part.text}
                </code>
              );
            } else if (part.type === 'codeblock') {
              return (
                <div key={index} className="comment-code-block">
                  {part.language && (
                    <span className="comment-code-language">
                      {part.language.charAt(0).toUpperCase() + part.language.slice(1).toLowerCase()}
                    </span>
                  )}
                  <pre className="comment-code-content">
                    <code>{part.text}</code>
                  </pre>
                </div>
              );
            } else if (part.type === 'bold') {
              return (
                <strong key={index} className="comment-bold">
                  {part.text}
                </strong>
              );
            } else if (part.type === 'italic') {
              return (
                <em key={index} className="comment-italic">
                  {part.text}
                </em>
              );
            }
            return null;
          })}
        </div>
        {images.length > 0 && (
          <div className="comment-images">
            {images.map((image, imgIndex) => (
              <div key={imgIndex} className="comment-image-item">
                {isGif(image.url) ? (
                  <div className="comment-gif-container">
                    <img src={image.url} alt={image.alt || 'GIF'} loading="lazy" />
                    <div className="comment-gif-badge">GIF</div>
                  </div>
                ) : (
                  <img src={image.url} alt={image.alt || 'Image'} loading="lazy" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
