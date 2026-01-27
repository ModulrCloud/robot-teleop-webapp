/**
 * Admin utilities for Modulr employees
 * Only users with @modulr.cloud email addresses can access admin features
 */

/**
 * Checks if a user is a Modulr employee based on their email domain
 * @param email - User's email address
 * @returns true if email ends with @modulr.cloud, false otherwise
 */
export function isModulrEmployee(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  
  // Normalize email to lowercase and trim whitespace
  const normalizedEmail = email.toLowerCase().trim();
  
  // Check if email ends with @modulr.cloud
  return normalizedEmail.endsWith('@modulr.cloud');
}

/**
 * Checks if a user has admin access
 * Currently, this is based on email domain (@modulr.cloud)
 * In the future, this could also check Cognito groups
 * @param email - User's email address
 * @param groups - Optional Cognito groups array
 * @returns true if user has admin access
 */
export function hasAdminAccess(
  email: string | null | undefined,
  groups?: string[] | null
): boolean {
  // Check email domain first
  if (isModulrEmployee(email)) {
    return true;
  }
  
  // Also check if user is in ADMINS Cognito group (for flexibility)
  if (groups && groups.length > 0) {
    const normalizedGroups = groups.map(g => g.toUpperCase());
    return normalizedGroups.includes('ADMINS') || normalizedGroups.includes('ADMIN');
  }
  
  return false;
}

/**
 * Checks if a user can assign admin status to others
 * Only super admin (chris@modulr.cloud) or ADMINS group members can assign admins
 * @param email - User's email address
 * @param group - Optional Cognito group (single value, e.g., "ADMINS")
 * @returns true if user can assign admins
 */
export function canAssignAdmin(
  email: string | null | undefined,
  group?: string | null
): boolean {
  // Super admin: chris@modulr.cloud can always assign admins
  const SUPER_ADMIN_EMAIL = 'chris@modulr.cloud';
  if (email && email.toLowerCase().trim() === SUPER_ADMIN_EMAIL) {
    return true;
  }
  
  // ADMINS group members can assign admins
  if (group && (group.toUpperCase() === 'ADMINS' || group.toUpperCase() === 'ADMIN')) {
    return true;
  }
  
  return false;
}

