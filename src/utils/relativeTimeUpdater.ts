/**
 * Utility for updating relative time displays without full page reload
 * 
 * Updates post timestamps (e.g., "2 minutes ago" → "3 minutes ago")
 * without causing page re-renders or breaking scroll position.
 * 
 * Uses the same optimistic update pattern as other post elements.
 */

/**
 * Calculate relative time string (e.g., "2 minutes ago", "1 hour ago")
 */
export function getRelativeTime(createdAt: string): string {
  const now = new Date();
  const postDate = new Date(createdAt);
  const diffMs = now.getTime() - postDate.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    // For older posts, show date
    return postDate.toLocaleDateString();
  }
}

/**
 * Update relative time for visible posts
 * 
 * This updates the time display (e.g., "2 minutes ago" → "3 minutes ago")
 * without causing a full post re-render, ensuring smooth scrolling.
 * 
 * @param postId - Post ID to update
 * @param createdAt - Post creation timestamp
 * @param updateTimeElement - Function to update the time display element
 */
export function updateRelativeTime(
  _postId: string,
  createdAt: string,
  updateTimeElement: (newTime: string) => void
): void {
  const newTime = getRelativeTime(createdAt);
  updateTimeElement(newTime);
}

/**
 * Set up automatic relative time updates for a post
 * 
 * Updates the time display every minute for posts less than 24 hours old.
 * Stops updating when post is older than 24 hours (shows date instead).
 * 
 * @param postId - Post ID
 * @param createdAt - Post creation timestamp
 * @param updateTimeElement - Function to update the time display
 * @returns Cleanup function to stop updates
 */
export function setupRelativeTimeUpdates(
  postId: string,
  createdAt: string,
  updateTimeElement: (newTime: string) => void
): () => void {
  const postDate = new Date(createdAt);
  const now = new Date();
  const ageMs = now.getTime() - postDate.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  // Don't update if post is older than 24 hours (shows date instead)
  if (ageHours >= 24) {
    return () => {}; // No-op cleanup
  }

  // Update every minute
  const interval = setInterval(() => {
    const newTime = getRelativeTime(createdAt);
    updateTimeElement(newTime);

    // Check if post is now older than 24 hours and stop updating
    const currentAge = (Date.now() - postDate.getTime()) / (1000 * 60 * 60);
    if (currentAge >= 24) {
      clearInterval(interval);
    }
  }, 60000); // 60 seconds

  return () => clearInterval(interval);
}
