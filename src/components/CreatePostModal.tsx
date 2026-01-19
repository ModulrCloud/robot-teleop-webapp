import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTimes,
  faPlus,
  faCode,
  faImage,
  faPoll,
  faSmile,
  faSearch,
} from '@fortawesome/free-solid-svg-icons';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { PostContentPreview } from './PostContentPreview';
import './CreatePostModal.css';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (content: string) => void;
}

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
// Beta keys are free but rate-limited. Production keys require upgrade.
// Get your key at: https://developers.giphy.com
const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY || '';

export function CreatePostModal({ isOpen, onClose, onSubmit }: CreatePostModalProps) {
  const [content, setContent] = useState('');
  const [charCount, setCharCount] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearchQuery, setGifSearchQuery] = useState('');
  const [gifResults, setGifResults] = useState<GiphyGif[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const gifPickerRef = useRef<HTMLDivElement>(null);

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

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setContent('');
      setCharCount(0);
      setShowEmojiPicker(false);
      setShowGifPicker(false);
      setGifSearchQuery('');
      setGifResults([]);
    }
  }, [isOpen]);

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

  const handleClose = () => {
    setContent('');
    setCharCount(0);
    onClose();
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setCharCount(newContent.length);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim() && onSubmit) {
      onSubmit(content.trim());
      handleClose();
    }
  };

  const insertAtCursor = (text: string) => {
    const textarea = document.getElementById('post-content') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = content.substring(0, start);
    const after = content.substring(end);
    const newContent = before + text + after;
    
    setContent(newContent);
    setCharCount(newContent.length);

    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  };

  const insertCodeBlock = () => {
    insertAtCursor('```python\n# Your code here\n```');
  };

  const insertPoll = () => {
    insertAtCursor('\n\nWhich option do you prefer?\n\n- () Option 1\n- () Option 2\n- () Option 3\n\nVote below!\n\n');
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
      alert('Giphy API key not configured. Please add VITE_GIPHY_API_KEY to your .env file. For now, you can paste GIF URLs directly into your post.');
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
      console.error('Error searching GIFs:', error);
      setGifResults([]);
      alert('Failed to search GIFs. Please check your API key or try again later. You can also paste GIF URLs directly.');
    } finally {
      setGifLoading(false);
    }
  };

  const insertGifUrl = (gifUrl: string) => {
    insertAtCursor(`\n\n${gifUrl}\n\n`);
    setShowGifPicker(false);
    setGifSearchQuery('');
    setGifResults([]);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content create-post-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-left">
            <FontAwesomeIcon icon={faPlus} className="modal-icon" />
            <div>
              <h2>Create Post</h2>
              <p className="modal-subtitle">Share your thoughts with the robotics community</p>
            </div>
          </div>
          <button className="modal-close" onClick={handleClose} aria-label="Close">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="post-form-toolbar">
            <button
              type="button"
              className="toolbar-button"
              onClick={insertCodeBlock}
              title="Insert code block"
            >
              <FontAwesomeIcon icon={faCode} />
              <span>Code</span>
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => alert('Image upload coming soon!')}
              title="Upload images (coming soon)"
            >
              <FontAwesomeIcon icon={faImage} />
              <span>Images</span>
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => {
                setShowGifPicker(!showGifPicker);
                setShowEmojiPicker(false);
              }}
              title="Add GIF"
            >
              <FontAwesomeIcon icon={faImage} />
              <span>GIF</span>
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowGifPicker(false);
              }}
              title="Add emoji"
            >
              <FontAwesomeIcon icon={faSmile} />
              <span>Emoji</span>
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={insertPoll}
              title="Insert poll"
            >
              <FontAwesomeIcon icon={faPoll} />
              <span>Poll</span>
            </button>
          </div>

          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div ref={emojiPickerRef} className="emoji-picker-container">
              <EmojiPicker
                onEmojiClick={onEmojiClick}
                width="100%"
                height={350}
                theme={Theme.DARK}
                previewConfig={{
                  showPreview: false
                }}
              />
            </div>
          )}

          {/* GIF Picker */}
          {showGifPicker && (
            <div ref={gifPickerRef} className="gif-picker">
              <div className="gif-picker-header">
                <div className="gif-search-container">
                  <FontAwesomeIcon icon={faSearch} className="gif-search-icon" />
                  <input
                    type="text"
                    className="gif-search-input"
                    placeholder="Search for GIFs..."
                    value={gifSearchQuery}
                    onChange={(e) => {
                      setGifSearchQuery(e.target.value);
                      searchGifs(e.target.value);
                    }}
                  />
                </div>
              </div>
              <div className="gif-picker-content">
                {gifLoading ? (
                  <div className="gif-loading">Searching...</div>
                ) : gifResults.length > 0 ? (
                  <div className="gif-grid">
                    {gifResults.map((gif) => (
                      <button
                        key={gif.id}
                        type="button"
                        className="gif-item"
                        onClick={() => insertGifUrl(gif.images.original.url)}
                      >
                        <img src={gif.images.preview_gif.url} alt={gif.title} />
                      </button>
                    ))}
                  </div>
                ) : gifSearchQuery ? (
                  <div className="gif-placeholder">
                    <p>No GIFs found. Try a different search term.</p>
                    <p className="gif-placeholder-hint">
                      You can also paste GIF URLs directly into your post.
                    </p>
                  </div>
                ) : (
                  <div className="gif-placeholder">
                    <p>Search for GIFs using the search bar above</p>
                    <p className="gif-placeholder-hint">
                      {GIPHY_API_KEY 
                        ? 'Powered by GIPHY'
                        : 'Giphy API key not configured. Add VITE_GIPHY_API_KEY to your .env file. You can also paste GIF URLs directly.'}
                    </p>
                  </div>
                )}
              </div>
              {gifResults.length > 0 && (
                <div className="gif-attribution">
                  <span>Powered by GIPHY</span>
                </div>
              )}
            </div>
          )}

          <div className="post-form-content">
            <textarea
              id="post-content"
              className="post-content-textarea"
              value={content}
              onChange={handleContentChange}
              placeholder="What's on your mind? Use #hashtags and @mentions to engage with the community..."
              rows={12}
              maxLength={1024}
            />
            {content && (
              <div className="post-preview">
                <div className="post-preview-label">Preview:</div>
                <div className="post-preview-content">
                  <PostContentPreview content={content} />
                </div>
              </div>
            )}
            <div className="post-form-footer">
              <div className="post-form-hints">
                <span>💡 Tip: Use markdown for formatting</span>
                <span>• Code blocks: ```language</span>
                <span>• Polls: - () Option</span>
                <span>• Hashtags: #tag</span>
              </div>
              <div className="char-count">{charCount}/1024</div>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="modal-button-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="modal-button-primary"
              disabled={!content.trim() || content.length > 1024}
            >
              Post
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
