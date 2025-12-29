import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faUser, faClock } from '@fortawesome/free-solid-svg-icons';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { logger } from '../utils/logger';
import { useAuthStatus } from '../hooks/useAuthStatus';
import './ReviewsDisplay.css';

const client = generateClient<Schema>();

interface Rating {
  id: string;
  rating: number;
  comment?: string | null;
  userDisplayName: string;
  userId?: string; // Only visible to modulr.cloud employees
  userEmail?: string; // Only visible to modulr.cloud employees
  createdAt: string;
  updatedAt?: string | null;
  responses?: Response[];
}

interface Response {
  id: string;
  response: string;
  partnerDisplayName: string;
  partnerId?: string; // Only visible to modulr.cloud employees
  partnerEmail?: string; // Only visible to modulr.cloud employees
  createdAt: string;
  updatedAt?: string | null;
}

interface ReviewsDisplayProps {
  robotId: string;
  isPartner?: boolean; // If true, show response form for partners
  partnerId?: string; // Partner's ID if they own this robot
  onResponseSubmitted?: () => void; // Callback when response is submitted
}

export function ReviewsDisplay({ robotId, isPartner, partnerId, onResponseSubmitted }: ReviewsDisplayProps) {
  const { user } = useAuthStatus();
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [respondingToRatingId, setRespondingToRatingId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState<string>('');
  const [isSubmittingResponse, setIsSubmittingResponse] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);

  const loadRatings = async (token?: string | null) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await client.queries.listRobotRatingsLambda({
        robotId: robotId,
        limit: 10,
        nextToken: token || undefined,
      });

      if (result.data) {
        const parsed = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
        
        if (parsed.statusCode === 200) {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          
          if (body.success) {
            if (token) {
              // Append to existing ratings (for pagination)
              setRatings(prev => [...prev, ...body.ratings]);
            } else {
              // Replace ratings (initial load or refresh)
              setRatings(body.ratings || []);
            }
            setNextToken(body.nextToken || null);
            setHasMore(!!body.nextToken);
          } else {
            setError(body.error || 'Failed to load ratings');
          }
        } else {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setError(body.error || 'Failed to load ratings');
        }
      } else if (result.errors) {
        setError(result.errors[0]?.message || 'Failed to load ratings');
      }
    } catch (err) {
      logger.error('Error loading ratings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load ratings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRatings();
  }, [robotId]);

  const handleLoadMore = () => {
    if (nextToken && !isLoading) {
      loadRatings(nextToken);
    }
  };

  const handleSubmitResponse = async (ratingId: string) => {
    if (!responseText.trim()) {
      setResponseError('Response cannot be empty');
      return;
    }

    setIsSubmittingResponse(true);
    setResponseError(null);

    try {
      const result = await client.mutations.createRatingResponseLambda({
        ratingId: ratingId,
        response: responseText.trim(),
      });

      if (result.data) {
        let parsed: any;
        if (typeof result.data === 'string') {
          parsed = JSON.parse(result.data);
        } else {
          parsed = result.data;
        }
        
        // Handle double-encoded JSON
        if (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }
        
        if (parsed.statusCode === 200) {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          if (body.success) {
            setResponseText('');
            setRespondingToRatingId(null);
            if (onResponseSubmitted) {
              onResponseSubmitted();
            }
            // Reload ratings to show the new response
            loadRatings();
          } else {
            setResponseError(body.error || 'Failed to submit response');
          }
        } else {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setResponseError(body.error || 'Failed to submit response');
        }
      } else if (result.errors) {
        setResponseError(result.errors[0]?.message || 'Failed to submit response');
      }
    } catch (err) {
      logger.error('Error submitting response:', err);
      setResponseError(err instanceof Error ? err.message : 'Failed to submit response');
    } finally {
      setIsSubmittingResponse(false);
    }
  };

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const renderRobots = (rating: number) => {
    return (
      <div className="rating-robots-display">
        {[1, 2, 3, 4, 5].map((r) => (
          <FontAwesomeIcon
            key={r}
            icon={faRobot}
            className={`robot-rating-icon ${r <= rating ? 'active' : ''}`}
          />
        ))}
      </div>
    );
  };

  if (isLoading && ratings.length === 0) {
    return (
      <div className="reviews-display">
        <p>Loading reviews...</p>
      </div>
    );
  }

  if (error && ratings.length === 0) {
    return (
      <div className="reviews-display">
        <div className="reviews-error">
          <FontAwesomeIcon icon={faRobot} /> {error}
        </div>
      </div>
    );
  }

  return (
    <div className="reviews-display">
      {ratings.length === 0 ? (
        <div className="no-reviews">
          <p>No reviews yet. Be the first to rate this robot!</p>
        </div>
      ) : (
        <>
          {ratings.map((rating) => (
            <div key={rating.id} className="review-item">
              <div className="review-header">
                <div className="review-author">
                  <FontAwesomeIcon icon={faUser} className="author-icon" />
                  <span className="author-name">{rating.userDisplayName || 'Anonymous'}</span>
                  {/* Show real identity only to modulr.cloud employees */}
                  {user?.email?.toLowerCase().endsWith('@modulr.cloud') && rating.userEmail && (
                    <span className="author-email-mod">({rating.userEmail})</span>
                  )}
                </div>
                <div className="review-meta">
                  <FontAwesomeIcon icon={faClock} className="meta-icon" />
                  <span className="review-date">{formatDate(rating.createdAt)}</span>
                  {rating.updatedAt && rating.updatedAt !== rating.createdAt && (
                    <span className="review-updated">(edited)</span>
                  )}
                </div>
              </div>

              <div className="review-rating">
                {renderRobots(rating.rating)}
              </div>

              {rating.comment && (
                <div className="review-comment">
                  <p>{rating.comment}</p>
                </div>
              )}

              {/* Partner Responses */}
              {rating.responses && rating.responses.length > 0 && (
                <div className="review-responses">
                  {rating.responses.map((response) => (
                    <div key={response.id} className="response-item">
                      <div className="response-header">
                        <div className="response-author">
                          <FontAwesomeIcon icon={faUser} className="author-icon" />
                          <span className="author-name">{response.partnerDisplayName || 'Anonymous'}</span>
                          <span className="response-label">Partner Response</span>
                          {/* Show real identity only to modulr.cloud employees */}
                          {user?.email?.toLowerCase().endsWith('@modulr.cloud') && response.partnerEmail && (
                            <span className="author-email-mod">({response.partnerEmail})</span>
                          )}
                        </div>
                        <div className="response-meta">
                          <FontAwesomeIcon icon={faClock} className="meta-icon" />
                          <span className="response-date">{formatDate(response.createdAt)}</span>
                          {response.updatedAt && response.updatedAt !== response.createdAt && (
                            <span className="response-updated">(edited)</span>
                          )}
                        </div>
                      </div>
                      <div className="response-text">
                        <p>{response.response}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Partner Response Form */}
              {isPartner && partnerId && (
                <div className="response-form-section">
                  {respondingToRatingId === rating.id ? (
                    <div className="response-form">
                      <textarea
                        value={responseText}
                        onChange={(e) => setResponseText(e.target.value)}
                        placeholder="Respond to this review..."
                        rows={3}
                        maxLength={500}
                        disabled={isSubmittingResponse}
                      />
                      <div className="response-form-actions">
                        <span className="char-count">{responseText.length}/500</span>
                        <div className="response-buttons">
                          <button
                            onClick={() => {
                              setRespondingToRatingId(null);
                              setResponseText('');
                              setResponseError(null);
                            }}
                            disabled={isSubmittingResponse}
                            className="cancel-response-button"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSubmitResponse(rating.id)}
                            disabled={isSubmittingResponse || !responseText.trim()}
                            className="submit-response-button"
                          >
                            {isSubmittingResponse ? 'Submitting...' : 'Submit Response'}
                          </button>
                        </div>
                      </div>
                      {responseError && (
                        <div className="response-error">{responseError}</div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => setRespondingToRatingId(rating.id)}
                      className="respond-button"
                    >
                      Respond to Review
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {hasMore && (
            <div className="reviews-pagination">
              <button
                onClick={handleLoadMore}
                disabled={isLoading}
                className="load-more-button"
              >
                {isLoading ? 'Loading...' : 'Load More Reviews'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

