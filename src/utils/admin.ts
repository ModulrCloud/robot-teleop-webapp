/**
 * Admin utilities for admin access control
 * Access is granted to: (1) @modulr.cloud email, or (2) ADMINS/ADMIN Cognito group
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
 * Access granted if: (1) email ends with @modulr.cloud, OR (2) user is in ADMINS/ADMIN Cognito group
 * Callers should pass both email and groups for correct behavior (e.g. official Admins with non-@modulr email)
 * @param email - User's email address
 * @param groups - Optional Cognito groups array (e.g. user.group ? [user.group] : undefined)
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

