import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileContract, faEdit, faSave, faTimes } from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import { TERMS_CONTENT_MARKDOWN } from "../../../content/terms-v1";
import "../../Admin.css";

const client = generateClient<Schema>();

const SETTING_KEYS = {
  content: "termsContentMarkdown",
  version: "termsVersion",
  lastUpdated: "termsLastUpdatedAt",
} as const;

function bumpVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)$/);
  if (match) {
    return `${match[1]}.${parseInt(match[2], 10) + 1}`;
  }
  return "1.1";
}

export const TermsOfServiceAdmin = () => {
  const { user } = useAuthStatus();
  const [modalOpen, setModalOpen] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [currentVersion, setCurrentVersion] = useState("1.0");
  const [currentLastUpdated, setCurrentLastUpdated] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const loadSettings = useCallback(async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) return;
    setLoading(true);
    try {
      const [contentRes, versionRes, updatedRes] = await Promise.all([
        client.models.PlatformSettings.list({
          filter: { settingKey: { eq: SETTING_KEYS.content } },
        }),
        client.models.PlatformSettings.list({
          filter: { settingKey: { eq: SETTING_KEYS.version } },
        }),
        client.models.PlatformSettings.list({
          filter: { settingKey: { eq: SETTING_KEYS.lastUpdated } },
        }),
      ]);
      const contentItem = contentRes.data?.find((s) => s.settingKey === SETTING_KEYS.content);
      const versionItem = versionRes.data?.find((s) => s.settingKey === SETTING_KEYS.version);
      const updatedItem = updatedRes.data?.find((s) => s.settingKey === SETTING_KEYS.lastUpdated);
      setMarkdown(contentItem?.settingValue?.trim() || TERMS_CONTENT_MARKDOWN);
      setCurrentVersion(versionItem?.settingValue || "1.0");
      setCurrentLastUpdated(updatedItem?.settingValue || "");
    } catch (err) {
      logger.error("Load TOS settings failed:", err);
      setMessage({ type: "error", text: "Failed to load terms settings." });
      setMarkdown(TERMS_CONTENT_MARKDOWN);
      setCurrentVersion("1.0");
      setCurrentLastUpdated("");
    } finally {
      setLoading(false);
    }
  }, [user?.email, user?.group]);

  useEffect(() => {
    if (modalOpen) loadSettings();
  }, [modalOpen, loadSettings]);

  const handlePublish = async () => {
    if (!user?.email || !hasAdminAccess(user.email, user?.group ? [user.group] : undefined)) return;
    setSaving(true);
    setMessage(null);
    const now = new Date().toISOString();
    const dateOnly = now.slice(0, 10);
    const newVersion = bumpVersion(currentVersion);
    const updatedBy = user.username || user.email || "admin";

    try {
      const contentSettings = await client.models.PlatformSettings.list({
        filter: { settingKey: { eq: SETTING_KEYS.content } },
      });
      const versionSettings = await client.models.PlatformSettings.list({
        filter: { settingKey: { eq: SETTING_KEYS.version } },
      });
      const updatedSettings = await client.models.PlatformSettings.list({
        filter: { settingKey: { eq: SETTING_KEYS.lastUpdated } },
      });

      const upsert = async (
        key: string,
        value: string,
        description: string,
        existing: { id: string | null } | null
      ) => {
        if (existing?.id) {
          await client.models.PlatformSettings.update({
            id: existing.id,
            settingValue: value,
            updatedBy,
            updatedAt: now,
          });
        } else {
          await client.models.PlatformSettings.create({
            settingKey: key,
            settingValue: value,
            description,
            updatedBy,
            updatedAt: now,
          });
        }
      };

      await upsert(
        SETTING_KEYS.content,
        markdown.trim() || TERMS_CONTENT_MARKDOWN,
        "Terms of Service body (markdown)",
        contentSettings.data?.[0] ?? null
      );
      await upsert(
        SETTING_KEYS.version,
        newVersion,
        "Current terms version (bumped on publish)",
        versionSettings.data?.[0] ?? null
      );
      await upsert(
        SETTING_KEYS.lastUpdated,
        dateOnly,
        "Terms last updated date (YYYY-MM-DD)",
        updatedSettings.data?.[0] ?? null
      );

      setCurrentVersion(newVersion);
      setCurrentLastUpdated(dateOnly);
      setMessage({ type: "success", text: `Published as version ${newVersion}. Users will be prompted to accept.` });
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      logger.error("Publish TOS failed:", err);
      setMessage({ type: "error", text: "Failed to publish. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="admin-section">
        <div className="section-header">
          <FontAwesomeIcon icon={faFileContract} className="section-icon" />
          <h2>Terms of Service</h2>
        </div>
        <div className="section-content">
          <p className="section-description">
            Edit and publish the Terms of Service. Content is stored as Markdown. Publishing bumps the version and prompts all users to accept the new terms.
          </p>
          <button
            type="button"
            className="admin-button"
            onClick={() => setModalOpen(true)}
            disabled={loading}
          >
            <FontAwesomeIcon icon={faEdit} /> Edit Terms of Service
          </button>
        </div>
      </div>

      {modalOpen &&
        createPortal(
          <div className="admin-tos-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="admin-tos-modal-title">
            <div className="admin-tos-modal">
              <div className="admin-tos-modal-header">
                <h2 id="admin-tos-modal-title">Edit Terms of Service</h2>
                <button
                  type="button"
                  className="admin-tos-modal-close"
                  onClick={() => setModalOpen(false)}
                  aria-label="Close"
                >
                  <FontAwesomeIcon icon={faTimes} />
                </button>
              </div>
              <p className="admin-tos-modal-meta">
                Current version: <strong>{currentVersion}</strong>
                {currentLastUpdated && ` · Last updated ${currentLastUpdated}`}
              </p>
              <p className="admin-tos-modal-hint">Content is in Markdown. Headings use <code>##</code>, links use <code>[text](url)</code>.</p>
              <textarea
                className="admin-tos-modal-textarea"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                placeholder="Markdown content..."
                spellCheck="false"
              />
              {message && (
                <p className={message.type === "error" ? "admin-tos-modal-error" : "admin-tos-modal-success"} role="alert">
                  {message.text}
                </p>
              )}
              <div className="admin-tos-modal-actions">
                <button type="button" className="admin-button admin-button-secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-button"
                  onClick={handlePublish}
                  disabled={saving}
                >
                  <FontAwesomeIcon icon={faSave} /> {saving ? "Publishing…" : "Publish new version"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
