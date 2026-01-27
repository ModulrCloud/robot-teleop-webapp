import React, { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faHeart,
  faThumbsDown,
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
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { useAuthStatus } from "../hooks/useAuthStatus";
import { logger } from "../utils/logger";
import { recalculatePostCounts } from "../utils/postUpdateHelpers";
import { getRelativeTime, setupRelativeTimeUpdates } from "../utils/relativeTimeUpdater";
import { CommentModal } from "./CommentModal";
import "./PostCard.css";

const client = generateClient<Schema>();

type UserBadge = 'partner' | 'verified' | 'moderator';

interface PostCardProps {
  postId: string;
  username: string;
  userAvatar?: string;
  userBadge?: UserBadge;
  content: string;
  images?: string[];
  createdAt: string;
  likesCount: number;
  dislikesCount?: number;
  commentsCount: number;
  sharesCount: number;
  pollId?: string | null; // Poll ID if post contains a poll
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
  postId,
  username,
  userAvatar,
  userBadge,
  content,
  images = [],
  createdAt,
  likesCount: initialLikesCount,
  dislikesCount: initialDislikesCount = 0,
  commentsCount: initialCommentsCount,
  sharesCount,
  pollId: postPollId,
  onUsernameClick,
}: PostCardProps) {
  const { user } = useAuthStatus();
  const [copiedCodeBlocks, setCopiedCodeBlocks] = useState<Record<number, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [selectedPollOption, setSelectedPollOption] = useState<number | null>(null);
  const [pollData, setPollData] = useState<{ id: string; options: string[]; totalVotes: number } | null>(null);
  const [pollVotes, setPollVotes] = useState<Record<number, number>>({}); // optionIndex -> vote count
  const [userPollVote, setUserPollVote] = useState<number | null>(null); // optionIndex user voted for
  const [isVoting, setIsVoting] = useState(false);
  const [likesCount, setLikesCount] = useState(initialLikesCount);
  const [dislikesCount, setDislikesCount] = useState(initialDislikesCount);
  const [commentsCount, setCommentsCount] = useState(initialCommentsCount);
  const [userLikeStatus, setUserLikeStatus] = useState<'like' | 'dislike' | null>(null);
  const [isLiking, setIsLiking] = useState(false);
  const [relativeTime, setRelativeTime] = useState(getRelativeTime(createdAt));
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const holdProgressRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedCountsRef = useRef<{ likes: number; dislikes: number } | null>(null);
  const HOLD_DURATION_MS = 1500; // 1.5 seconds to trigger dislike

  // Fetch current user's like/dislike status for this post
  useEffect(() => {
    const fetchUserLikeStatus = async () => {
      if (!user?.username) {
        return;
      }

      try {
        const { data: userLikes } = await client.models.PostLike.list({
          filter: {
            postId: { eq: postId },
            userId: { eq: user.username },
          },
        });

        if (userLikes && userLikes.length > 0) {
          const like = userLikes[0];
          setUserLikeStatus(like.type || null);
        }
      } catch (error) {
        logger.error('Error fetching user like status:', error);
      }
    };

    fetchUserLikeStatus();
  }, [postId, user?.username]);

  // Fetch poll data and votes
  useEffect(() => {
    const fetchPollData = async () => {
      if (!postPollId) {
        // Check if content has poll syntax even if pollId is missing
        const pollMatch = content.match(/- \(\)\s+.+$/gm);
        if (pollMatch && pollMatch.length >= 2) {
          // Only create poll if user is authenticated
          if (!user?.username) {
            return;
          }
          
          // First, check if a poll already exists for this post (in case it was created but postId wasn't updated)
          try {
            const { data: existingPolls } = await client.models.PostPoll.list({
              filter: {
                postId: { eq: postId },
              },
            });
            
            if (existingPolls && existingPolls.length > 0) {
              const existingPoll = existingPolls[0];
              
              // Update the post with the existing pollId (in case it wasn't linked)
              try {
                await client.models.Post.update({
                  id: postId,
                  pollId: existingPoll.id,
                });
              } catch (updateError) {
                logger.error('Error linking post to existing poll:', updateError);
              }
              
              // Fetch the poll data and votes (same as when postPollId is provided)
              const pollOptions = (existingPoll.options || []).filter((opt): opt is string => opt !== null);
              setPollData({
                id: existingPoll.id!,
                options: pollOptions,
                totalVotes: existingPoll.totalVotes || 0,
              });
              
              // Fetch votes
              const { data: votes } = await client.models.PostPollVote.list({
                filter: {
                  pollId: { eq: existingPoll.id },
                },
              });
              
              // Count votes per option
              const voteCounts: Record<number, number> = {};
              pollOptions.forEach((_, index) => {
                voteCounts[index] = 0;
              });
              
              if (votes) {
                votes.forEach(vote => {
                  const optionIndex = vote.optionIndex ?? -1;
                  if (optionIndex >= 0) {
                    voteCounts[optionIndex] = (voteCounts[optionIndex] || 0) + 1;
                  }
                });
              }
              
              setPollVotes(voteCounts);
              
              // Check if user has voted
              if (user?.username && votes) {
                const userVote = votes.find(v => v.userId === user.username);
                if (userVote && userVote.optionIndex !== null && userVote.optionIndex !== undefined) {
                  setUserPollVote(userVote.optionIndex);
                  setSelectedPollOption(userVote.optionIndex);
                }
              }
              
              return; // Don't create a new poll
            }
          } catch (checkError) {
            logger.error('Error checking for existing poll:', checkError);
            // Continue to create new poll
          }
          
          // Extract poll options
          const pollOptions = pollMatch.map(match => {
            const optionText = match.replace(/^-\s*\(\)\s+/, '').trim();
            return optionText;
          });
          
          try {
            // Create the poll
            const pollResult = await client.models.PostPoll.create({
              postId: postId,
              options: pollOptions,
              totalVotes: 0,
              createdAt: new Date().toISOString(),
            });
            
            if (pollResult.errors && pollResult.errors.length > 0) {
              logger.error('Error creating poll for existing post:', pollResult.errors);
              return;
            }
            
            if (!pollResult.data) {
              logger.error('Poll creation returned no data:', pollResult);
              return;
            }
            
            const newPollId = pollResult.data?.id;
            
            // Update post with pollId
            try {
              await client.models.Post.update({
                id: postId,
                pollId: newPollId,
              });
              
              // Set poll data so we can use it immediately
              setPollData({
                id: newPollId!,
                options: pollOptions,
                totalVotes: 0,
              });
              
              // Fetch votes for the newly created poll
              try {
                const { data: votes, errors: voteErrors } = await client.models.PostPollVote.list({
                  filter: {
                    pollId: { eq: newPollId },
                  },
                });
                
                if (voteErrors && voteErrors.length > 0) {
                  logger.error('Error fetching votes:', voteErrors);
                } else {
                  // Count votes per option
                  const voteCounts: Record<number, number> = {};
                  pollOptions.forEach((_, index) => {
                    voteCounts[index] = 0;
                  });
                  
                  if (votes) {
                    votes.forEach(vote => {
                      const optionIndex = vote.optionIndex ?? -1;
                      if (optionIndex >= 0) {
                        voteCounts[optionIndex] = (voteCounts[optionIndex] || 0) + 1;
                      }
                    });
                  }
                  
                  setPollVotes(voteCounts);
                  
                  // Check if user has voted
                  if (user?.username && votes) {
                    const userVote = votes.find(v => v.userId === user.username);
                    if (userVote && userVote.optionIndex !== null && userVote.optionIndex !== undefined) {
                      setUserPollVote(userVote.optionIndex);
                      setSelectedPollOption(userVote.optionIndex);
                    }
                  }
                }
              } catch (voteFetchError) {
                logger.error('Error fetching votes for new poll:', voteFetchError);
                // Initialize empty vote counts as fallback
                const voteCounts: Record<number, number> = {};
                pollOptions.forEach((_, index) => {
                  voteCounts[index] = 0;
                });
                setPollVotes(voteCounts);
              }
            } catch (updateError) {
              logger.error('Error linking poll to post:', updateError);
            }
          } catch (pollError) {
            logger.error('Error creating poll for existing post:', pollError);
          }
        }
        return;
      }

      try {
        // Fetch poll
        const { data: poll, errors: pollErrors } = await client.models.PostPoll.get({ id: postPollId });
        
        if (pollErrors && pollErrors.length > 0) {
          logger.error('Error fetching poll:', pollErrors);
          return;
        }
        
        if (poll) {
          const pollOptions = (poll.options || []).filter((opt): opt is string => opt !== null);
          setPollData({
            id: poll.id!,
            options: pollOptions,
            totalVotes: poll.totalVotes || 0,
          });
        }

        // Fetch all votes for this poll
        const { data: votes, errors: voteErrors } = await client.models.PostPollVote.list({
          filter: {
            pollId: { eq: postPollId },
          },
        });
        
        if (voteErrors && voteErrors.length > 0) {
          logger.error('Error fetching votes:', voteErrors);
        }

        if (votes && poll) {
          // Count votes per option
          const voteCounts: Record<number, number> = {};
          poll.options?.forEach((_, index) => {
            voteCounts[index] = 0;
          });

          votes.forEach(vote => {
            const optionIndex = vote.optionIndex ?? -1;
            if (optionIndex >= 0) {
              voteCounts[optionIndex] = (voteCounts[optionIndex] || 0) + 1;
            }
          });

          setPollVotes(voteCounts);

          // Check if user has voted
          if (user?.username) {
            const userVote = votes.find(v => v.userId === user.username);
            if (userVote && userVote.optionIndex !== null && userVote.optionIndex !== undefined) {
              setUserPollVote(userVote.optionIndex);
              setSelectedPollOption(userVote.optionIndex);
            }
          }
        }
      } catch (error) {
        logger.error('Error fetching poll data:', error);
      }
    };

    fetchPollData();
  }, [postPollId, user?.username]); // Only depend on postPollId and user - don't include postId/content as they cause dependency array size changes

  // Refresh counts from database when postId changes
  useEffect(() => {
    const refreshCounts = async () => {
      try {
        // Recalculate counts from PostLike records (source of truth)
        const { data: allLikes } = await client.models.PostLike.list({
          filter: {
            postId: { eq: postId },
          },
        });

        if (allLikes) {
          const likes = allLikes.filter(like => like.type === 'like').length;
          const dislikes = allLikes.filter(like => like.type === 'dislike').length;
          
          setLikesCount(likes);
          setDislikesCount(dislikes);

          // Update Post record with accurate counts
          try {
            await client.models.Post.update({
              id: postId,
              likesCount: likes,
              dislikesCount: dislikes,
            });
          } catch (updateError) {
            logger.warn('Failed to sync post counts:', updateError);
            // Non-critical - counts are eventually consistent
          }
        }
      } catch (error) {
        logger.error('Error refreshing counts:', error);
      }
    };

    refreshCounts();
  }, [postId]);

  // Set up relative time updates (updates every minute for posts < 24 hours old)
  // This updates "2 minutes ago" → "3 minutes ago" without re-rendering the entire post
  // Only the timestamp text updates, ensuring smooth scrolling ("scrolls like butter")
  useEffect(() => {
    const cleanup = setupRelativeTimeUpdates(
      postId,
      createdAt,
      (newTime) => setRelativeTime(newTime)
    );
    return cleanup;
  }, [postId, createdAt]);

  // Update like/dislike counts every minute (same interval as time updates)
  // Only updates the count widgets, not the entire post - ensures smooth scrolling
  // Note: We use a ref to track the last checked values to avoid overwriting optimistic updates
  useEffect(() => {
    const updateCounts = async () => {
      try {
        const { data: allLikes } = await client.models.PostLike.list({
          filter: {
            postId: { eq: postId },
          },
        });

        if (allLikes) {
          const actualLikes = allLikes.filter(like => like.type === 'like').length;
          const actualDislikes = allLikes.filter(like => like.type === 'dislike').length;

          const lastChecked = lastCheckedCountsRef.current;
          if (!lastChecked || actualLikes !== lastChecked.likes || actualDislikes !== lastChecked.dislikes) {
            setLikesCount((currentLikes) =>
              actualLikes !== currentLikes ? actualLikes : currentLikes
            );
            setDislikesCount((currentDislikes) =>
              actualDislikes !== currentDislikes ? actualDislikes : currentDislikes
            );
            lastCheckedCountsRef.current = { likes: actualLikes, dislikes: actualDislikes };
          }
        }
      } catch (error) {
        logger.warn(`Failed to update counts for post ${postId}:`, error);
      }
    };

    updateCounts();
    const interval = setInterval(updateCounts, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, [postId]);

  // Update poll vote counts every minute (same interval as like counts)
  // Only updates the vote counts, not the entire post - ensures smooth scrolling
  useEffect(() => {
    if (!pollData?.id) return; // Only poll if poll exists

    const updatePollVotes = async () => {
      try {
        const { data: votes } = await client.models.PostPollVote.list({
          filter: {
            pollId: { eq: pollData.id },
          },
        });

        if (votes && pollData) {
          // Count votes per option
          const voteCounts: Record<number, number> = {};
          pollData.options.forEach((_, index) => {
            voteCounts[index] = 0;
          });

          votes.forEach(vote => {
            const optionIndex = vote.optionIndex ?? -1;
            if (optionIndex >= 0) {
              voteCounts[optionIndex] = (voteCounts[optionIndex] || 0) + 1;
            }
          });

          // Only update if counts changed (avoid unnecessary re-renders)
          setPollVotes(prev => {
            const hasChanged = Object.keys(voteCounts).some(
              key => voteCounts[Number(key)] !== prev[Number(key)]
            );
            return hasChanged ? voteCounts : prev;
          });
        }
      } catch (error) {
        logger.warn(`Failed to update poll votes for post ${postId}:`, error);
      }
    };

    updatePollVotes();
    const interval = setInterval(updatePollVotes, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, [pollData?.id, postId]);

  // Update comment counts every minute (same interval as like counts)
  useEffect(() => {
    const updateCommentCount = async () => {
      try {
        const { data: comments } = await client.models.PostComment.list({
          filter: {
            postId: { eq: postId },
            parentCommentId: { attributeExists: false }, // Only top-level comments
          },
        });

        if (comments) {
          const actualCount = comments.length;
          setCommentsCount(currentCount =>
            actualCount !== currentCount ? actualCount : currentCount
          );
        }
      } catch (error) {
        logger.warn(`Failed to update comment count for post ${postId}:`, error);
      }
    };

    updateCommentCount();
    const interval = setInterval(updateCommentCount, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, [postId]);

  // Handle like/dislike click
  const handleLikeDislike = async (type: 'like' | 'dislike') => {
    if (!user?.username || isLiking) {
      return;
    }

    // OPTIMISTIC UI UPDATE: Update UI immediately for instant feedback
    // Use flushSync to force immediate rendering so the button highlight appears instantly
    const previousLikeStatus = userLikeStatus;
    const previousLikesCount = likesCount;
    const previousDislikesCount = dislikesCount;

    flushSync(() => {
      if (userLikeStatus === type) {
        // Optimistically un-like/un-dislike
        if (type === 'like') {
          setLikesCount(prev => Math.max(0, prev - 1));
        } else {
          setDislikesCount(prev => Math.max(0, prev - 1));
        }
        setUserLikeStatus(null);
      } else {
        // Optimistically add like/dislike
        if (userLikeStatus && userLikeStatus !== type) {
          // Switching from like to dislike or vice versa
          if (userLikeStatus === 'like') {
            setLikesCount(prev => Math.max(0, prev - 1));
          } else {
            setDislikesCount(prev => Math.max(0, prev - 1));
          }
        }
        if (type === 'like') {
          setLikesCount(prev => prev + 1);
        } else {
          setDislikesCount(prev => prev + 1);
        }
        setUserLikeStatus(type);
      }
    });

    // Set isLiking AFTER optimistic update to prevent double-clicks
    // The visual state is already updated above, so this won't cause a delay
    setIsLiking(true);

    try {
      // If user already has this type of like, remove it (toggle off)
      if (previousLikeStatus === type) {
        // Find and delete the existing like
        const { data: existingLikes } = await client.models.PostLike.list({
          filter: {
            postId: { eq: postId },
            userId: { eq: user.username },
            type: { eq: type },
          },
        });

        if (existingLikes && existingLikes.length > 0) {
          const likeToDelete = existingLikes[0];
          
          // SECURITY: Verify ownership before deleting
          if (likeToDelete.userId !== user.username) {
            // ROLLBACK: Restore previous state on error
            setUserLikeStatus(previousLikeStatus);
            setLikesCount(previousLikesCount);
            setDislikesCount(previousDislikesCount);
            logger.error('SECURITY: Attempted to delete another user\'s like!', {
              recordUserId: likeToDelete.userId,
              currentUserId: user.username,
              likeId: likeToDelete.id
            });
            throw new Error('Unauthorized: You can only delete your own likes');
          }
          
          // Use Lambda resolver for server-side validation (X/Twitter-level security)
          const deleteResult = await client.mutations.deletePostLikeLambda({ id: likeToDelete.id! });
          
          if (deleteResult.errors && deleteResult.errors.length > 0) {
            const errorMessages = deleteResult.errors.map(e => e.message || JSON.stringify(e)).join(', ');
            logger.error('Failed to delete PostLike:', deleteResult.errors);
            throw new Error(`Failed to delete PostLike: ${errorMessages}`);
          }
          
          if (!deleteResult.data) {
            throw new Error('Delete operation returned no data');
          }
          
          // Recalculate counts from database (source of truth) using utility
          try {
            const { likesCount: actualLikes, dislikesCount: actualDislikes } = await recalculatePostCounts(postId);
            setLikesCount(actualLikes);
            setDislikesCount(actualDislikes);
          } catch (updateError) {
            logger.warn('Failed to sync post counts after un-like:', updateError);
            // Fallback: set to zero if recalculation fails
            setLikesCount(0);
            setDislikesCount(0);
          }
          
          setUserLikeStatus(null);
        } else {
          logger.warn('No existing like found to delete!', { 
            postId, 
            userId: user.username, 
            type,
            userLikeStatus,
            existingLikes 
          });
          logger.warn('Un-like: No existing like found to delete', { 
            postId, 
            userId: user.username, 
            type,
            userLikeStatus 
          });
        }
      } else {
        // If user has opposite type, delete it first
        if (userLikeStatus && userLikeStatus !== type) {
          const { data: existingLikes } = await client.models.PostLike.list({
            filter: {
              postId: { eq: postId },
              userId: { eq: user.username },
            },
          });

          if (existingLikes && existingLikes.length > 0) {
            const likeToDelete = existingLikes[0];
            
            // SECURITY: Verify ownership before deleting
            if (likeToDelete.userId !== user.username) {
              logger.error('SECURITY: Attempted to delete another user\'s like!', {
                recordUserId: likeToDelete.userId,
                currentUserId: user.username,
                likeId: likeToDelete.id
              });
              throw new Error('Unauthorized: You can only delete your own likes');
            }
            
            // Use Lambda resolver for server-side validation
            await client.mutations.deletePostLikeLambda({ id: likeToDelete.id! });
            
            // Update counts for the old type
            if (userLikeStatus === 'like') {
              setLikesCount(prev => Math.max(0, prev - 1));
            } else {
              setDislikesCount(prev => Math.max(0, prev - 1));
            }
          }
        }

        // Double-check that no duplicate exists before creating (defense in depth)
        // This prevents race conditions from rapid clicks or stale state
        // Uses the postUserTypeIndex for fast lookup
        const { data: duplicateCheck } = await client.models.PostLike.list({
          filter: {
            postId: { eq: postId },
            userId: { eq: user.username },
            type: { eq: type },
          },
        });

        if (duplicateCheck && duplicateCheck.length > 0) {
          // Duplicate found - should not happen, but handle gracefully
          // This can occur if:
          // 1. User clicked rapidly before state updated
          // 2. State was stale (e.g., from another tab/session)
          logger.warn('Duplicate like/dislike detected, skipping creation. Existing record:', duplicateCheck[0].id);
          // Update user status to match existing record
          setUserLikeStatus(type);
          // Recalculate counts to ensure accuracy
          const { data: allLikes } = await client.models.PostLike.list({
            filter: {
              postId: { eq: postId },
            },
          });
          if (allLikes) {
            const likes = allLikes.filter(like => like.type === 'like').length;
            const dislikes = allLikes.filter(like => like.type === 'dislike').length;
            setLikesCount(likes);
            setDislikesCount(dislikes);
          }
        } else {
          // Create new like/dislike
          const createResult = await client.models.PostLike.create({
            postId,
            userId: user.username,
            type,
            createdAt: new Date().toISOString(),
          });
          
          if (createResult.errors && createResult.errors.length > 0) {
            // ROLLBACK: Restore previous state on error
            setUserLikeStatus(previousLikeStatus);
            setLikesCount(previousLikesCount);
            setDislikesCount(previousDislikesCount);
            throw new Error(`Failed to create reaction: ${createResult.errors.map(e => e.message).join(', ')}`);
          }
          
          // Note: We already did optimistic update above, so don't increment again here
          // The server sync below will correct any discrepancies
        }
      }

      // Recalculate and update Post counts from PostLike records (source of truth)
      // This ensures accuracy even with concurrent updates
      try {
        const { likesCount: actualLikes, dislikesCount: actualDislikes } = await recalculatePostCounts(postId);
        
        // Update local state with actual counts (may differ slightly from optimistic update)
        setLikesCount(actualLikes);
        setDislikesCount(actualDislikes);
      } catch (updateError) {
        logger.warn('Failed to update post counts:', updateError);
        // Non-critical - counts are eventually consistent
        // Note: Optimistic UI already updated, so user sees immediate feedback
      }
    } catch (error) {
      // ROLLBACK: Restore previous state on any error
      setUserLikeStatus(previousLikeStatus);
      setLikesCount(previousLikesCount);
      setDislikesCount(previousDislikesCount);
      logger.error('Error handling like/dislike:', error);
      // Revert optimistic updates on error
      setLikesCount(initialLikesCount);
      setDislikesCount(initialDislikesCount);
    } finally {
      setIsLiking(false);
    }
  };

  // Handle poll voting with optimistic updates (same pattern as likes)
  const handlePollVote = async (optionIndex: number) => {
    if (!user?.username || !pollData || isVoting || userPollVote !== null) {
      return;
    }

    setIsVoting(true);

    // Optimistic update
    const previousVotes = { ...pollVotes };
    const previousTotalVotes = Object.values(pollVotes).reduce((sum, count) => sum + count, 0) || pollData.totalVotes;
    
    flushSync(() => {
      setPollVotes(prev => {
        const newVotes = { ...prev };
        newVotes[optionIndex] = (newVotes[optionIndex] || 0) + 1;
        return newVotes;
      });
      setSelectedPollOption(optionIndex);
      setUserPollVote(optionIndex);
    });

    try {
      const voteResult = await client.models.PostPollVote.create({
        pollId: pollData.id,
        postId: postId,
        userId: user.username,
        optionIndex: optionIndex,
        createdAt: new Date().toISOString(),
      });

      if (voteResult.errors && voteResult.errors.length > 0) {
        // Rollback on error
        setPollVotes(previousVotes);
        setSelectedPollOption(null);
        setUserPollVote(null);
        throw new Error(`Failed to vote: ${voteResult.errors.map(e => e.message).join(', ')}`);
      }

      // Update poll totalVotes
      try {
        await client.models.PostPoll.update({
          id: pollData.id,
          totalVotes: previousTotalVotes + 1,
        });
      } catch (updateError) {
        logger.warn('Failed to update poll totalVotes:', updateError);
        // Non-fatal - vote was created successfully
      }
    } catch (error) {
      logger.error('Error voting on poll:', error);
      // Rollback already handled above
    } finally {
      setIsVoting(false);
    }
  };

  // Cleanup hold timers on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
      }
      if (holdProgressRef.current) {
        clearInterval(holdProgressRef.current);
      }
    };
  }, []);

  // Handle mouse down on like button (start hold timer)
  const handleLikeMouseDown = () => {
    if (!user?.username || isLiking) {
      return;
    }
    setIsHolding(true);
    setHoldProgress(0);

    // Start progress animation
    const progressInterval = 50; // Update every 50ms
    const progressStep = (progressInterval / HOLD_DURATION_MS) * 100;
    
    holdProgressRef.current = setInterval(() => {
      setHoldProgress(prev => {
        const newProgress = prev + progressStep;
        if (newProgress >= 100) {
          return 100;
        }
        return newProgress;
      });
    }, progressInterval);

    // Set timer to trigger dislike after hold duration
    holdTimerRef.current = setTimeout(() => {
      // Trigger dislike
      handleLikeDislike('dislike');
      setIsHolding(false);
      setHoldProgress(0);
      
      // Clear progress interval
      if (holdProgressRef.current) {
        clearInterval(holdProgressRef.current);
        holdProgressRef.current = null;
      }
      
      // Clear timer reference
      holdTimerRef.current = null;
    }, HOLD_DURATION_MS);
  };

  // Handle mouse up on like button (cancel hold, trigger like)
  const handleLikeMouseUp = () => {
    const wasHolding = isHolding;
    const timerWasActive = holdTimerRef.current !== null;
    
    // Clear timers
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdProgressRef.current) {
      clearInterval(holdProgressRef.current);
      holdProgressRef.current = null;
    }

    if (wasHolding) {
      setIsHolding(false);
      setHoldProgress(0);
      
      // Only trigger like if the timer was still active (meaning hold was cancelled before completion)
      // If timer was null, it means the hold completed and dislike was already triggered
      if (timerWasActive) {
        // Hold was cancelled before completion, trigger normal like/unlike
        handleLikeDislike('like');
      }
    } else {
      // Quick click (mouseDown and mouseUp happened so fast that isHolding wasn't set)
      // This can happen with very fast clicks - trigger like/unlike directly
      handleLikeDislike('like');
    }
  };

  // Handle mouse leave (cancel hold)
  const handleLikeMouseLeave = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdProgressRef.current) {
      clearInterval(holdProgressRef.current);
      holdProgressRef.current = null;
    }
    setIsHolding(false);
    setHoldProgress(0);
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
      logger.error('Failed to copy code:', error);
    }
  };

  // Handle run code (future feature - Phase 3)
  const handleRunCode = (code: string, language?: string) => {
    // Future: Execute code in sandboxed environment
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
            {relativeTime}
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
                    const currentBlockIndex = codeBlockIndex++;
                    const isCopied = copiedCodeBlocks[currentBlockIndex];
                    return (
                      <div key={key} className="post-code-block">
                        <div className="post-code-header">
                          {part.language && (
                            <span className="post-code-language">
                              {part.language.charAt(0).toUpperCase() + part.language.slice(1).toLowerCase()}
                            </span>
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
            // Render poll - use database poll data if available, otherwise use parsed data
            const displayPoll = pollData || { options: (section.data as Poll).options.map((opt) => opt.text), totalVotes: 0 };
            const totalVotes = Object.values(pollVotes).reduce((sum, count) => sum + count, 0) || displayPoll.totalVotes;
            
            return (
              <div key={sectionIndex} className="post-poll">
                {displayPoll.options.map((optionText, optionIndex) => {
                  const voteCount = pollVotes[optionIndex] || 0;
                  const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
                  const isSelected = selectedPollOption === optionIndex;
                  const hasUserVoted = userPollVote !== null;
                  
                  return (
                    <label 
                      key={optionIndex} 
                      className={`post-poll-option ${isSelected ? 'selected' : ''} ${hasUserVoted ? 'voted' : ''}`}
                    >
                      <input
                        type="radio"
                        name={`poll-${postId}`}
                        checked={isSelected}
                        onChange={() => handlePollVote(optionIndex)}
                        disabled={isVoting || hasUserVoted}
                      />
                      {hasUserVoted && (
                        <div className="post-poll-option-bar" style={{ width: `${percentage}%` }} />
                      )}
                      <div className="post-poll-option-content">
                        <span className="post-poll-option-text">{optionText}</span>
                        {hasUserVoted && (
                          <span className="post-poll-option-stats">
                            {voteCount} vote{voteCount !== 1 ? 's' : ''} ({percentage}%)
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
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
        <button 
          className={`post-interaction-button like-button ${userLikeStatus === 'like' ? 'active' : ''} ${userLikeStatus === 'dislike' ? 'disliked' : ''} ${isHolding ? 'holding' : ''}`}
          onMouseDown={handleLikeMouseDown}
          onMouseUp={handleLikeMouseUp}
          onMouseLeave={handleLikeMouseLeave}
          onClick={(e) => {
            // Fallback for quick clicks that might not trigger mouseUp properly
            // Only handle if not already processing and not holding
            if (!isLiking && !isHolding && user?.username) {
              e.preventDefault();
              handleLikeDislike('like');
            }
          }}
          disabled={!user?.username}
          style={{ pointerEvents: isLiking ? 'none' : 'auto', cursor: isLiking ? 'wait' : 'pointer' }}
          title={user?.username 
            ? (userLikeStatus === 'dislike' 
                ? 'Click to like, hold to dislike' 
                : userLikeStatus === 'like' 
                  ? 'Click to unlike, hold to dislike' 
                  : 'Click to like, hold to dislike')
            : 'Sign in to like'}
        >
          <div className="like-button-content">
            {userLikeStatus === 'dislike' ? (
              <FontAwesomeIcon icon={faThumbsDown} />
            ) : (
              <FontAwesomeIcon icon={faHeart} />
            )}
            <span>{userLikeStatus === 'dislike' ? dislikesCount : likesCount}</span>
          </div>
          {isHolding && (
            <div className="like-button-hold-progress" style={{ width: `${holdProgress}%` }} />
          )}
        </button>
        <button 
          className="post-interaction-button comment-button" 
          title="View comments"
          onClick={() => setCommentModalOpen(true)}
        >
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

      {/* Comment Modal */}
      <CommentModal
        isOpen={commentModalOpen}
        onClose={() => setCommentModalOpen(false)}
        postId={postId}
        postUsername={username}
        onCommentAdded={() => {
          // Optimistically update comment count
          setCommentsCount(prev => prev + 1);
          // The auto-refresh will sync with server
        }}
      />

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
