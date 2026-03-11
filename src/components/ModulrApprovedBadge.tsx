import "./ModulrApprovedBadge.css";

export type ModulrApprovedBadgeSize = "small" | "medium";

interface ModulrApprovedBadgeProps {
  size?: ModulrApprovedBadgeSize;
  /** Optional: path to custom badge image (e.g. /badges/modulr-approved.svg). Falls back to text if missing. */
  badgeUrl?: string;
  className?: string;
}

/**
 * Badge shown when a robot is Modulr Approved (certified).
 * Renders text "Modulr Approved" in a pill; if badgeUrl is set and the image loads, shows the image instead.
 */
export function ModulrApprovedBadge({
  size = "small",
  badgeUrl = "/badges/modulr-approved.svg",
  className = "",
}: ModulrApprovedBadgeProps) {
  return (
    <span
      className={`modulr-approved-badge modulr-approved-badge--${size} ${className}`.trim()}
      role="img"
      aria-label="Modulr Approved"
    >
      {badgeUrl ? (
        <img
          src={badgeUrl}
          alt="Modulr Approved"
          className="modulr-approved-badge__img"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            const fallback = e.currentTarget.nextElementSibling;
            if (fallback) (fallback as HTMLElement).style.display = "inline";
          }}
        />
      ) : null}
      <span className="modulr-approved-badge__text" style={badgeUrl ? { display: "none" } : undefined}>
        Modulr Approved
      </span>
    </span>
  );
}
