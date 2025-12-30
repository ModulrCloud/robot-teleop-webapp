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

export function RobotRating({ robotId, sessionId, onRatingSubmitted }: RobotRatingProps) {
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [existingRating, setExistingRating] = useState<any>(null);

  // Check if user has already rated this robot
  useEffect(() => {
    const checkExistingRating = async () => {
      try {
        const result = await client.queries.listRobotRatingsLambda({
          robotId: robotId,
          limit: 100, // Get all ratings to find user's own
        });

        if (result.data) {
          // Note: We can't filter by userId on the client side since it's hidden for non-admins
          // The Lambda will return all ratings, but we can check if we have a rating by looking at the count
          // For now, we'll just allow users to update their rating if they submit again
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
            setSuccess(true);
            setExistingRating({ rating: selectedRating, comment: comment.trim() });
            if (onRatingSubmitted) {
              onRatingSubmitted();
            }
            // Reset form after a delay
            setTimeout(() => {
              setSuccess(false);
            }, 3000);
          } else {
            setError(body.error || 'Failed to submit rating');
          }
        } else {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setError(body.error || 'Failed to submit rating');
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
      <h3>Rate this Robot</h3>
      
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
          <FontAwesomeIcon icon={faRobot} /> Rating submitted successfully!
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

