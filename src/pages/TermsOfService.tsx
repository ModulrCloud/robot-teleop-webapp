import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useTermsContent } from "../hooks/useTermsContent";
import { TERMS_TITLE } from "../content/terms-v1";
import "./TermsOfService.css";

export function TermsOfService() {
  usePageTitle();
  const { contentHtml, version, lastUpdatedAt, loading, error } = useTermsContent();

  return (
    <div className="terms-page">
      <div className="terms-container">
        <h1 className="terms-title">{TERMS_TITLE}</h1>
        <p className="terms-meta">
          Version {version} · Last updated {lastUpdatedAt}
        </p>
        {error && <p className="terms-error" role="alert">{error}</p>}
        {loading ? (
          <p className="terms-loading">Loading terms…</p>
        ) : (
          <div
            className="terms-body"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        )}
        <p className="terms-disclaimer">
          These terms are subject to change. The current version is always available on this page
          within the app. By using the Service, you agree to the terms in effect at the time of use.
        </p>
        <p className="terms-back">
          <Link to="/">← Back to Dashboard</Link>
        </p>
      </div>
    </div>
  );
}
