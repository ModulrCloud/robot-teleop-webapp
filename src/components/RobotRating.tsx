import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '@fortawesome/free-solid-svg-icons';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { logger } from '../utils/logger';
import './RobotRating.css';

const client = generateClient<Schema>();

interface RobotRatingProps {
  robotId: string;
  sessionId?: string | null; // Optional session ID for validation
  onRatingSubmitted?: () => void; // Callback when rating is submitted
}

interface ExistingRatingState {
  rating?: number;
  comment?: string;
  isOwnRating?: boolean;
}

interface LambdaRatingBody {
  success?: boolean;
  error?: string;
  details?: string;
  ratings?: Array<{ rating?: number; comment?: string; isOwnRating?: boolean }>;
}

interface LambdaRatingResponse {
  statusCode: number;
  body?: string | LambdaRatingBody;
}

export function RobotRating({ robotId, sessionId, onRatingSubmitted }: RobotRatingProps) {
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [existingRating, setExistingRating] = useState<ExistingRatingState | null>(null);

  // Check if user has already rated this robot
  useEffect(() => {
    const checkExistingRating = async () => {
      try {
        const result = await client.queries.listRobotRatingsLambda({
          robotId: robotId,
          limit: 100,
        });

        if (result.data) {
          let parsed = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
          
          if (parsed.statusCode === 200) {
            const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
            const ownRating = body.ratings?.find((r: ExistingRatingState) => r.isOwnRating) as ExistingRatingState | undefined;
            if (ownRating) {
              setExistingRating(ownRating);
              setSelectedRating(ownRating.rating || 0);
              setComment(ownRating.comment || '');
            }
          }
        }
      } catch (err) {
        logger.warn('Could not check existing rating:', err);
      }
    };

    checkExistingRating();
  }, [robotId]);

  const handleSubmit = async () => {
    if (selectedRating === 0) {
      setError('Please select a rating (1-5 robots)');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await client.mutations.createOrUpdateRatingLambda({
        robotId: robotId,
        rating: selectedRating,
        comment: comment.trim() || null,
        sessionId: sessionId || null,
      });

      if (result.data) {
        let parsed: LambdaRatingResponse | string;
        if (typeof result.data === 'string') {
          parsed = JSON.parse(result.data) as LambdaRatingResponse | string;
        } else {
          parsed = result.data as LambdaRatingResponse;
        }
        if (typeof parsed === 'string') {
          parsed = JSON.parse(parsed) as LambdaRatingResponse;
        }
        if (parsed.statusCode === 200) {
          const body: LambdaRatingBody = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : (parsed.body ?? {});
          if (body.success) {
            setSuccess(true);
            setExistingRating({ rating: selectedRating, comment: comment.trim() });
            if (onRatingSubmitted) {
              onRatingSubmitted();
            }
            setTimeout(() => {
              setSuccess(false);
            }, 3000);
          } else {
            setError(body.error || body.details || 'Failed to submit rating');
          }
        } else {
          const body: LambdaRatingBody = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : (parsed.body ?? {});
          setError(body.error || body.details || 'Failed to submit rating');
        }
      } else if (result.errors) {
        setError(result.errors[0]?.message || 'Failed to submit rating');
      }
    } catch (err) {
      logger.error('Error submitting rating:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit rating');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRobotClick = (rating: number) => {
    setSelectedRating(rating);
    setHoveredRating(0); // Clear hover state when selecting
    setError(null);
  };

  const handleRobotHover = (rating: number) => {
    setHoveredRating(rating);
  };

  const handleRobotLeave = () => {
    setHoveredRating(0);
  };

  return (
    <div className="robot-rating-component">
      <h3>{existingRating ? 'Edit Your Rating' : 'Rate this Robot'}</h3>
      
      <div 
        className="robot-rating-selector"
        onMouseLeave={handleRobotLeave}
      >
        {[1, 2, 3, 4, 5].map((rating) => {
          // If a rating is selected, only show selected robots as highlighted
          // If nothing is selected, show hover preview
          const isSelected = selectedRating > 0 && selectedRating >= rating;
          const isHovered = selectedRating === 0 && hoveredRating > 0 && hoveredRating >= rating;
          // Only highlight if it's part of the selection OR it's being hovered (when nothing is selected)
          const shouldHighlight = isSelected || isHovered;

          return (
            <button
              key={rating}
              type="button"
              className="robot-rating-button"
              onClick={() => handleRobotClick(rating)}
              onMouseEnter={() => {
                if (selectedRating === 0) {
                  handleRobotHover(rating);
                }
              }}
              disabled={isSubmitting}
              aria-label={`Rate ${rating} out of 5`}
            >
              <FontAwesomeIcon 
                icon={faRobot} 
                className={shouldHighlight ? 'robot-icon highlighted' : 'robot-icon'}
              />
            </button>
          );
        })}
      </div>


      <div className="rating-comment-section">
        <label htmlFor="rating-comment">Your Review (Optional)</label>
        <textarea
          id="rating-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Share your experience with this robot..."
          rows={4}
          maxLength={1000}
          disabled={isSubmitting}
        />
        <span className="char-count">{comment.length}/1000</span>
      </div>

      {error && (
        <div className="rating-error">
          <FontAwesomeIcon icon={faRobot} /> {error}
        </div>
      )}

      {success && (
        <div className="rating-success">
          <FontAwesomeIcon icon={faRobot} /> {existingRating ? 'Rating updated successfully!' : 'Rating submitted successfully!'}
        </div>
      )}

      <button
        type="button"
        className="submit-rating-button"
        onClick={handleSubmit}
        disabled={isSubmitting || selectedRating === 0}
      >
        {isSubmitting ? 'Submitting...' : existingRating ? 'Update Rating' : 'Submit Rating'}
      </button>
    </div>
  );
}

