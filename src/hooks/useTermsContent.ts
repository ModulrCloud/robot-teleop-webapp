import { useState, useEffect, useCallback } from "react";
import { marked } from "marked";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import {
  TERMS_CONTENT,
  TERMS_VERSION_DEFAULT,
  TERMS_LAST_UPDATED_DEFAULT,
} from "../content/terms-v1";

const client = generateClient<Schema>();

const SETTING_KEYS = {
  content: "termsContentMarkdown",
  version: "termsVersion",
  lastUpdated: "termsLastUpdatedAt",
} as const;

export interface TermsContentResult {
  contentHtml: string;
  version: string;
  lastUpdatedAt: string;
  /** True when content came from DB; false when using static fallback */
  fromDb: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Fetches current terms content from PlatformSettings (if set by admin) or falls back to static content.
 * Converts markdown to HTML when content is stored in DB.
 */
export function useTermsContent(): TermsContentResult {
  const [contentMarkdown, setContentMarkdown] = useState<string | null>(null);
  const [version, setVersion] = useState<string>(TERMS_VERSION_DEFAULT);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>(TERMS_LAST_UPDATED_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
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

      if (contentItem?.settingValue) {
        setContentMarkdown(contentItem.settingValue);
      } else {
        setContentMarkdown(null);
      }
      if (versionItem?.settingValue) setVersion(versionItem.settingValue);
      if (updatedItem?.settingValue) setLastUpdatedAt(updatedItem.settingValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load terms");
      setContentMarkdown(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const contentHtml =
    contentMarkdown != null && contentMarkdown.trim() !== ""
      ? marked.parse(contentMarkdown, { async: false })
      : TERMS_CONTENT;
  const fromDb = contentMarkdown != null && contentMarkdown.trim() !== "";

  return {
    contentHtml,
    version,
    lastUpdatedAt,
    fromDb,
    loading,
    error,
    refetch: fetchSettings,
  };
}
