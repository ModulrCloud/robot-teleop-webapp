import { useState, useEffect, useCallback } from "react";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { useAuthStatus } from "./useAuthStatus";

const client = generateClient<Schema>();

const STORAGE_KEY_PREFIX = "whatsNewRead_";

export interface WhatsNewItem {
  id: string;
  title: string;
  summary: string;
  link: string;
  publishedAt?: string;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

function parseListResponse(data: unknown): { success: boolean; items?: WhatsNewItem[] } {
  if (typeof data === "string") {
    try {
      const first = JSON.parse(data);
      return typeof first === "string" ? JSON.parse(first) : first;
    } catch {
      return { success: false };
    }
  }
  return (data as { success: boolean; items?: WhatsNewItem[] }) ?? { success: false };
}

function loadReadIdsFromStorage(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveReadIdsToStorage(userId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

export interface UseWhatsNewResult {
  items: WhatsNewItem[];
  readIds: Set<string>;
  unreadCount: number;
  loading: boolean;
  error: string | null;
  markRead: (id: string) => void;
  markAllRead: () => void;
  refresh: () => Promise<void>;
}

/**
 * Fetches What's New announcements from the API and manages per-user read state in localStorage.
 * Only fetches when the user is logged in.
 */
export function useWhatsNew(): UseWhatsNewResult {
  const { user, isLoggedIn } = useAuthStatus();
  const [items, setItems] = useState<WhatsNewItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const userId = user?.username ?? "";

  const fetchList = useCallback(async () => {
    if (!isLoggedIn) {
      setLoading(false);
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await client.queries.listWhatsNewLambda({});
      if (result.errors && result.errors.length > 0) {
        const errMsg = result.errors
          .map((e: { message?: string }) => e.message ?? String(e))
          .join(", ");
        setError(errMsg);
        setItems([]);
        return;
      }
      const parsed = parseListResponse(result.data);
      if (parsed.success && Array.isArray(parsed.items)) {
        setItems(parsed.items);
      } else {
        setItems([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (!userId) {
      setReadIds(new Set());
      return;
    }
    setReadIds(loadReadIdsFromStorage(userId));
  }, [userId]);

  const markRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        const next = new Set(prev).add(id);
        saveReadIdsToStorage(userId, next);
        return next;
      });
    },
    [userId]
  );

  const markAllRead = useCallback(() => {
    setItems((current) => {
      setReadIds((prev) => {
        const next = new Set(prev);
        current.forEach((item) => next.add(item.id));
        saveReadIdsToStorage(userId, next);
        return next;
      });
      return current;
    });
  }, [userId]);

  const unreadCount = items.filter((item) => !readIds.has(item.id)).length;

  return {
    items,
    readIds,
    unreadCount,
    loading,
    error,
    markRead,
    markAllRead,
    refresh: fetchList,
  };
}
