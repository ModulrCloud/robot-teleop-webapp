import { useState, useEffect } from "react";
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { usePageTitle } from "../hooks/usePageTitle";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUsers,
  faCompass,
  faStar,
  faInfoCircle,
  faPlus,
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";
import { PostCard } from "../components/PostCard";
import { CreatePostModal } from "../components/CreatePostModal";
import { logger } from "../utils/logger";
import { recalculatePostCounts } from "../utils/postUpdateHelpers";
import "./Social.css";

const client = generateClient<Schema>();

interface Post {
  id: string;
  username: string;
  userAvatar?: string | null;
  content: string;
  postType: 'text' | 'image' | 'code' | 'gif' | 'poll' | null;
  imageUrls?: string[] | null;
  gifUrl?: string | null;
  createdAt: string;
  likesCount: number;
  dislikesCount?: number;
  commentsCount: number;
  sharesCount: number;
  pollId?: string | null;
}

export const Social = () => {
  usePageTitle();
  const [activeTab, setActiveTab] = useState<'discovery' | 'curated'>('discovery');
  const [isCreatePostModalOpen, setIsCreatePostModalOpen] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch posts from database
  const loadPosts = async () => {
    setLoading(true);
    setError(null);

    try {
      logger.log('📥 Loading posts from database...');
      
      // Query posts by createdAt index (latest first)
      // Note: Amplify Data doesn't support sortDirection directly in list()
      // We'll need to query by createdAt index and sort client-side, or use a query with filter
      const result = await client.models.Post.list({
        limit: 50,
      });

      if (result.errors && result.errors.length > 0) {
        const errorMessage = result.errors.map(e => e.message || JSON.stringify(e)).join(', ');
        logger.error('❌ Error loading posts:', result.errors);
        setError(`Failed to load posts: ${errorMessage}`);
        setPosts([]);
        return;
      }

      // Filter out deleted posts
      const validPosts = (result.data || [])
        .filter(post => post.id && !post.isDeleted && (post.visibility === 'public' || !post.visibility));

      // Recalculate counts from PostLike records for accuracy
      const postsWithAccurateCounts = await Promise.all(
        validPosts.map(async (post) => {
          try {
            // Fetch all likes/dislikes for this post
            const { data: allLikes } = await client.models.PostLike.list({
              filter: {
                postId: { eq: post.id! },
              },
            });

            // Calculate actual counts
            const actualLikes = allLikes?.filter(like => like.type === 'like').length || 0;
            const actualDislikes = allLikes?.filter(like => like.type === 'dislike').length || 0;

            // Update Post record if counts differ (sync in background)
            if (post.likesCount !== actualLikes || post.dislikesCount !== actualDislikes) {
              recalculatePostCounts(post.id!).catch(updateError => {
                logger.warn(`Failed to sync counts for post ${post.id}:`, updateError);
              });
            }

            return {
              id: post.id!,
              username: post.username,
              userAvatar: post.userAvatar,
              content: post.content,
              postType: post.postType,
              imageUrls: post.imageUrls?.filter((url): url is string => url !== null) || null,
              gifUrl: post.gifUrl,
              createdAt: post.createdAt,
              likesCount: actualLikes,
              dislikesCount: actualDislikes,
              commentsCount: post.commentsCount || 0,
              sharesCount: post.sharesCount || 0,
              pollId: post.pollId || null,
            };
          } catch (error) {
            logger.warn(`Error calculating counts for post ${post.id}:`, error);
            // Fallback to stored counts if calculation fails
            return {
              id: post.id!,
              username: post.username,
              userAvatar: post.userAvatar,
              content: post.content,
              postType: post.postType,
              imageUrls: post.imageUrls?.filter((url): url is string => url !== null) || null,
              gifUrl: post.gifUrl,
              createdAt: post.createdAt,
              likesCount: post.likesCount || 0,
              dislikesCount: post.dislikesCount || 0,
              commentsCount: post.commentsCount || 0,
              sharesCount: post.sharesCount || 0,
            };
          }
        })
      );

      // Sort by createdAt descending (latest first)
      const sortedPosts = postsWithAccurateCounts.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });

      logger.log(`✅ Loaded ${sortedPosts.length} posts`);
      setPosts(sortedPosts);
    } catch (err) {
      logger.error('❌ Error loading posts:', err);
      setError(err instanceof Error ? err.message : 'Failed to load posts. Please try again.');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  // Load posts on mount and when tab changes
  useEffect(() => {
    if (activeTab === 'discovery') {
      loadPosts();
    }
  }, [activeTab]);

  // Polling disabled - was causing full page refresh/blink
  // For future: Implement GraphQL subscriptions for real-time updates without polling

  // Reload posts when a new post is created
  const handlePostCreated = () => {
    loadPosts();
  };

  return (
    <div className="social-page">
      <div className="social-header">
        <div className="social-title-section">
          <FontAwesomeIcon icon={faUsers} className="social-icon" />
          <h1>Modulr.Social</h1>
        </div>
        <p className="social-description">
          Connect with the robotics community. Share ideas, discover projects, and stay updated with the latest in robotics development.
        </p>
      </div>

      <div className="social-tabs">
        <button
          className={`social-tab ${activeTab === 'discovery' ? 'active' : ''}`}
          onClick={() => setActiveTab('discovery')}
        >
          <FontAwesomeIcon icon={faCompass} />
          <span>Discovery</span>
        </button>
        <button
          className={`social-tab ${activeTab === 'curated' ? 'active' : ''}`}
          onClick={() => setActiveTab('curated')}
        >
          <FontAwesomeIcon icon={faStar} />
          <span>Curated</span>
        </button>
      </div>

      <div className="social-content">
        {activeTab === 'discovery' ? (
          <div className="social-feed discovery-feed">
            {loading ? (
              <div className="posts-loading" style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center', 
                padding: '3rem',
                color: '#999'
              }}>
                <FontAwesomeIcon icon={faSpinner} spin style={{ marginRight: '0.5rem' }} />
                <span>Loading posts...</span>
              </div>
            ) : error ? (
              <div className="posts-error" style={{ 
                padding: '2rem', 
                textAlign: 'center',
                color: '#ff6b6b'
              }}>
                <p>{error}</p>
                <button 
                  onClick={loadPosts}
                  style={{
                    marginTop: '1rem',
                    padding: '0.5rem 1rem',
                    backgroundColor: '#ffb700',
                    color: '#000',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Try Again
                </button>
              </div>
            ) : posts.length === 0 ? (
              <div className="posts-empty" style={{ 
                padding: '3rem', 
                textAlign: 'center',
                color: '#999'
              }}>
                <FontAwesomeIcon icon={faInfoCircle} style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }} />
                <p style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No posts yet</p>
                <p>Be the first to share something with the robotics community!</p>
              </div>
            ) : (
              posts.map((post) => {
                // Extract images from markdown if not already in imageUrls
                // For now, PostCard will handle markdown image parsing
                const images = post.imageUrls || [];
                
                // If there's a GIF URL, add it to images array
                if (post.gifUrl && !images.includes(post.gifUrl)) {
                  images.push(post.gifUrl);
                }

                return (
                  <PostCard
                    key={post.id}
                    postId={post.id}
                    username={post.username}
                    userAvatar={post.userAvatar || undefined}
                    content={post.content}
                    images={images.length > 0 ? images : undefined}
                    createdAt={post.createdAt}
                    likesCount={post.likesCount}
                    dislikesCount={post.dislikesCount || 0}
                    commentsCount={post.commentsCount}
                    sharesCount={post.sharesCount}
                    pollId={post.pollId || undefined}
                    onUsernameClick={(username) => {
                      // Future: Navigate to user profile
                      logger.log(`Clicked on user: ${username}`);
                    }}
                  />
                );
              })
            )}
          </div>
        ) : (
          <div className="social-feed curated-feed">
            <div className="placeholder-content">
              <FontAwesomeIcon icon={faStar} className="placeholder-icon" />
              <h2>Curated Feed</h2>
              <p>
                This will be a personalized feed tuned to your interests, activity, and preferences.
                Content will be algorithmically selected to show you the most relevant robotics content.
              </p>
              <div className="placeholder-info">
                <FontAwesomeIcon icon={faInfoCircle} />
                <span>Coming soon - Personalization algorithm in development</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Action Button - Create Post */}
      <button
        className="social-fab"
        onClick={() => setIsCreatePostModalOpen(true)}
        title="Create a new post"
      >
        <FontAwesomeIcon icon={faPlus} />
      </button>

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={isCreatePostModalOpen}
        onClose={() => setIsCreatePostModalOpen(false)}
        onPostCreated={handlePostCreated}
      />
    </div>
  );
};

