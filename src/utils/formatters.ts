export function formatGroupName(group?: string | null): string {
  if (!group) return "N/A";

  const groupMap: Record<string, string> = {
    PARTNERS: "Partner",
    CLIENTS: "Client",
    ADMINS: "Admin",
  };

  return groupMap[group] ?? group;
}

/**
 * Capitalizes the first letter of a name/username
 * Handles both single words and multi-word names (e.g., "john doe" -> "John Doe")
 * @param name - The name to capitalize
 * @returns The name with first letter of each word capitalized, or empty string if name is falsy
 */
export function capitalizeName(name?: string | null): string {
  if (!name) return "";
  // Split by spaces, capitalize first letter of each word, then join
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}