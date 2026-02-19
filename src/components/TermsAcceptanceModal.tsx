import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExternalLinkAlt } from "@fortawesome/free-solid-svg-icons";
import { TERMS_TITLE, TERMS_CONTENT } from "../content/terms-v1";
import "./TermsAcceptanceModal.css";

interface TermsAcceptanceModalProps {
  isOpen: boolean;
  currentVersion: string;
  currentLastUpdatedAt: string;
  /** HTML content to show; when not provided, static TERMS_CONTENT is used */
  contentHtml?: string;
  onAccept: () => Promise<void>;
  onDecline: () => void;
  accepting: boolean;
  errorMessage?: string | null;
}

export function TermsAcceptanceModal({
  isOpen,
  currentVersion,
  currentLastUpdatedAt,
  contentHtml = TERMS_CONTENT,
  onAccept,
  onDecline,
  accepting,
  errorMessage,
}: TermsAcceptanceModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) e.preventDefault();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="terms-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="terms-modal-title">
      <div className="terms-modal">
        <h2 id="terms-modal-title" className="terms-modal-title">
          {TERMS_TITLE}
        </h2>
        <p className="terms-modal-meta">
          Version {currentVersion} · Last updated {currentLastUpdatedAt}
        </p>
        <div ref={scrollRef} className="terms-modal-scroll">
          <div
            className="terms-modal-body"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        </div>
        <div className="terms-modal-footer">
          <p className="terms-modal-disclaimer">
            These terms are subject to change without notice. The current version is always available at{" "}
            <Link to="/terms" className="terms-modal-link" target="_blank" rel="noopener noreferrer">
              Terms of Service <FontAwesomeIcon icon={faExternalLinkAlt} />
            </Link>{" "}
            in the app. By clicking Continue, you confirm that you have read and accept this agreement.
          </p>
          {errorMessage && (
            <p className="terms-modal-error" role="alert">
              {errorMessage}
            </p>
          )}
          <div className="terms-modal-actions">
            <button
              type="button"
              className="terms-modal-decline"
              onClick={onDecline}
              disabled={accepting}
            >
              Decline & sign out
            </button>
            <button
              type="button"
              className="terms-modal-accept"
              onClick={onAccept}
              disabled={accepting}
            >
              {accepting ? "Accepting…" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
