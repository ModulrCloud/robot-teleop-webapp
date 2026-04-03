import { useState } from "react";
import "./ModulrApprovedBadge.css";

export type ModulrApprovedBadgeSize = "small" | "medium";

interface ModulrApprovedBadgeProps {
  size?: ModulrApprovedBadgeSize;
  /** Path to badge image (e.g. /badges/resize%202.svg). Falls back to text pill if image fails. */
  badgeUrl?: string;
  className?: string;
}

/**
 * Badge shown when a robot is Ctrlr Approved (certified).
 * Uses the badge image when available; falls back to "Ctrlr Approved" text pill if the image fails to load.
 */
export function ModulrApprovedBadge({
  size = "small",
  badgeUrl = "/badges/resize%202.svg",
  className = "",
}: ModulrApprovedBadgeProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const showImage = badgeUrl && imageLoaded && !imageError;
  const showText = !badgeUrl || imageError;

  return (
    <span
      className={`modulr-approved-badge modulr-approved-badge--${size} ${showImage ? "modulr-approved-badge--image-only" : ""} ${className}`.trim()}
      role="img"
      aria-label="Ctrlr Approved"
    >
      {badgeUrl && !imageError && (
        <img
          src={badgeUrl}
          alt="Ctrlr Approved"
          className="modulr-approved-badge__img"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />
      )}
      {showText && (
        <span className="modulr-approved-badge__text">Ctrlr Approved</span>
      )}
    </span>
  );
}
