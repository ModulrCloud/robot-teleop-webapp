import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBullhorn,
  faPlus,
  faEdit,
  faTrash,
  faSave,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import type { Announcement } from "../types";
import { logger } from "../../../utils/logger";
import "../../Admin.css";

const client = generateClient<Schema>();

const emptyForm: Omit<Announcement, "id" | "createdAt" | "updatedAt"> = {
  title: "",
  summary: "",
  link: "",
  publishedAt: new Date().toISOString().slice(0, 10),
  sortOrder: 0,
};

function parseListResponse(data: unknown): { success: boolean; items?: Announcement[] } {
  if (typeof data === "string") {
    try {
      const first = JSON.parse(data);
      return typeof first === "string" ? JSON.parse(first) : first;
    } catch {
      return { success: false };
    }
  }
  return (data as { success: boolean; items?: Announcement[] }) ?? { success: false };
}

function parseManageResponse(data: unknown): { success: boolean; data?: Announcement; message?: string } {
  if (typeof data === "string") {
    try {
      const first = JSON.parse(data);
      return typeof first === "string" ? JSON.parse(first) : first;
    } catch {
      return { success: false };
    }
  }
  return (data as { success: boolean; data?: Announcement; message?: string }) ?? { success: false };
}

export const WhatsNewAdmin = () => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      logger.log("🔍 [WHATS NEW] Loading list...");
      const result = await client.queries.listWhatsNewLambda({});
      logger.log("🔍 [WHATS NEW] listWhatsNewLambda raw result:", { hasData: !!result.data, hasErrors: !!result.errors, errors: result.errors });

      if (result.errors && result.errors.length > 0) {
        const errMsg = result.errors.map((e: { message?: string }) => e.message ?? String(e)).join(", ");
        logger.error("🔴 [WHATS NEW] GraphQL errors:", errMsg);
        setError(errMsg);
        setItems([]);
        return;
      }

      const parsed = parseListResponse(result.data);
      logger.log("🔍 [WHATS NEW] Parsed list response:", { success: parsed.success, itemCount: parsed.items?.length ?? 0, items: parsed.items });

      if (parsed.success && Array.isArray(parsed.items)) {
        const sorted = [...parsed.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        setItems(sorted);
        logger.log("✅ [WHATS NEW] Loaded", sorted.length, "item(s)");
      } else {
        logger.warn("⚠️ [WHATS NEW] List response missing items or success=false:", parsed);
        setItems([]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("🔴 [WHATS NEW] loadList failed:", message, err);
      setError(message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((item: Announcement) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      summary: item.summary,
      link: item.link,
      publishedAt: item.publishedAt ?? new Date().toISOString().slice(0, 10),
      sortOrder: item.sortOrder ?? 0,
    });
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const itemData = {
        title: form.title.trim(),
        summary: form.summary.trim(),
        link: form.link.trim(),
        publishedAt: form.publishedAt || new Date().toISOString().slice(0, 10),
        sortOrder: typeof form.sortOrder === "number" ? form.sortOrder : 0,
      };

      if (editingId) {
        logger.log("🔍 [WHATS NEW] Updating item:", editingId, itemData);
        const result = await client.mutations.manageWhatsNewLambda({
          action: "update",
          itemId: editingId,
          itemData: JSON.stringify(itemData),
        });
        logger.log("🔍 [WHATS NEW] manageWhatsNewLambda (update) raw result:", { hasData: !!result.data, hasErrors: !!result.errors, errors: result.errors });

        if (result.errors && result.errors.length > 0) {
          const errMsg = result.errors.map((e: { message?: string }) => e.message ?? String(e)).join(", ");
          logger.error("🔴 [WHATS NEW] Update GraphQL errors:", errMsg);
          setError(errMsg);
          return;
        }

        const parsed = parseManageResponse(result.data);
        logger.log("🔍 [WHATS NEW] Update parsed:", parsed);
        if (parsed.success) {
          closeModal();
          await loadList();
        } else {
          setError(parsed.message ?? "Update failed");
        }
      } else {
        logger.log("🔍 [WHATS NEW] Creating item:", itemData);
        const result = await client.mutations.manageWhatsNewLambda({
          action: "create",
          itemData: JSON.stringify(itemData),
        });
        logger.log("🔍 [WHATS NEW] manageWhatsNewLambda (create) raw result:", { hasData: !!result.data, hasErrors: !!result.errors, errors: result.errors });

        if (result.errors && result.errors.length > 0) {
          const errMsg = result.errors.map((e: { message?: string }) => e.message ?? String(e)).join(", ");
          logger.error("🔴 [WHATS NEW] Create GraphQL errors:", errMsg);
          setError(errMsg);
          return;
        }

        const parsed = parseManageResponse(result.data);
        logger.log("🔍 [WHATS NEW] Create parsed:", parsed);
        if (parsed.success) {
          closeModal();
          await loadList();
        } else {
          setError(parsed.message ?? "Create failed");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("🔴 [WHATS NEW] handleSave failed:", message, err);
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [editingId, form, closeModal, loadList]);

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm("Delete this announcement?")) return;
    setSaving(true);
    setError(null);
    try {
      logger.log("🔍 [WHATS NEW] Deleting item:", id);
      const result = await client.mutations.manageWhatsNewLambda({
        action: "delete",
        itemId: id,
      });
      logger.log("🔍 [WHATS NEW] manageWhatsNewLambda (delete) raw result:", { hasData: !!result.data, hasErrors: !!result.errors, errors: result.errors });

      if (result.errors && result.errors.length > 0) {
        const errMsg = result.errors.map((e: { message?: string }) => e.message ?? String(e)).join(", ");
        logger.error("🔴 [WHATS NEW] Delete GraphQL errors:", errMsg);
        setError(errMsg);
        return;
      }

      const parsed = parseManageResponse(result.data);
      logger.log("🔍 [WHATS NEW] Delete parsed:", parsed);
      if (parsed.success) {
        if (editingId === id) closeModal();
        await loadList();
      } else {
        setError(parsed.message ?? "Delete failed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("🔴 [WHATS NEW] handleDelete failed:", message, err);
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [editingId, closeModal, loadList]);

  return (
    <>
      <div className="admin-section">
        <div className="section-header">
          <FontAwesomeIcon icon={faBullhorn} className="section-icon" />
          <h2>What&apos;s New (Announcements)</h2>
        </div>
        <div className="section-content">
          <p className="section-description">
            Manage announcements shown in the navbar &quot;What&apos;s New&quot; panel. Each item has a title, summary, and link (e.g. User Guide). Read state is tracked per user by announcement ID so items don&apos;t keep showing as new after they&apos;ve been seen.
          </p>
          {error && (
            <div className="admin-alert admin-alert-error" style={{ marginBottom: "1rem" }}>
              {error}
            </div>
          )}
          <button type="button" className="admin-button" onClick={openCreate} disabled={loading || saving}>
            <FontAwesomeIcon icon={faPlus} /> Add announcement
          </button>

          {loading ? (
            <p style={{ marginTop: "1rem" }}>Loading announcements...</p>
          ) : (
          <table className="admin-table" style={{ marginTop: "1rem" }}>
            <thead>
              <tr>
                <th>Order</th>
                <th>Title</th>
                <th>Summary</th>
                <th>Link</th>
                <th>Published</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.sortOrder ?? 0}</td>
                  <td>{item.title}</td>
                  <td style={{ maxWidth: 280 }}>{item.summary.slice(0, 80)}{item.summary.length > 80 ? "…" : ""}</td>
                  <td>
                    <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ color: "rgba(255, 193, 7, 0.9)" }}>
                      {item.link.slice(0, 30)}{item.link.length > 30 ? "…" : ""}
                    </a>
                  </td>
                  <td>{item.publishedAt ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-button admin-button-secondary"
                      style={{ marginRight: "0.5rem" }}
                      onClick={() => openEdit(item)}
                    >
                      <FontAwesomeIcon icon={faEdit} />
                    </button>
                    <button
                      type="button"
                      className="admin-button admin-button-danger"
                      onClick={() => handleDelete(item.id)}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>

      {modalOpen &&
        createPortal(
          <div className="admin-tos-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="whats-new-modal-title">
            <div className="admin-tos-modal">
              <div className="admin-tos-modal-header">
                <h2 id="whats-new-modal-title">{editingId ? "Edit announcement" : "Add announcement"}</h2>
                <button
                  type="button"
                  className="admin-tos-modal-close"
                  onClick={closeModal}
                  aria-label="Close"
                >
                  <FontAwesomeIcon icon={faTimes} />
                </button>
              </div>

              <label className="admin-tos-modal-hint" style={{ display: "block", marginTop: 0 }}>
                Title
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. What's New"
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  marginBottom: "1rem",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: "1rem",
                }}
              />

              <label className="admin-tos-modal-hint" style={{ display: "block" }}>
                Summary
              </label>
              <textarea
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                placeholder="Short summary for the dropdown..."
                rows={3}
                className="admin-tos-modal-textarea"
                style={{ minHeight: 80 }}
              />

              <label className="admin-tos-modal-hint" style={{ display: "block" }}>
                Link (Find Out More)
              </label>
              <input
                type="text"
                value={form.link}
                onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
                placeholder="/terms or https://..."
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  marginBottom: "1rem",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: "1rem",
                }}
              />

              <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
                  <label className="admin-tos-modal-hint" style={{ display: "block" }}>
                    Published date
                  </label>
                  <input
                    type="date"
                    value={form.publishedAt}
                    onChange={(e) => setForm((f) => ({ ...f, publishedAt: e.target.value }))}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 8,
                      color: "#fff",
                      fontSize: "1rem",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="admin-tos-modal-hint" style={{ display: "block" }}>
                    Order
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.sortOrder}
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value, 10) || 0 }))}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 8,
                      color: "#fff",
                      fontSize: "1rem",
                    }}
                  />
                </div>
              </div>

              <div className="admin-tos-modal-actions">
                <button type="button" className="admin-button admin-button-secondary" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-button"
                  onClick={() => void handleSave()}
                  disabled={!form.title.trim() || saving}
                >
                  <FontAwesomeIcon icon={faSave} /> {saving ? "Saving…" : editingId ? "Save changes" : "Add announcement"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
