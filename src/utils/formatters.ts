export function formatGroupName(group?: string | null): string {
  if (!group) return "N/A";

  const groupMap: Record<string, string> = {
    PARTNERS: "Partner",
    CLIENTS: "Client",
    ADMINS: "Admin",
  };

  return groupMap[group] ?? group;
}