import { useState, useCallback } from "react";
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
import type { Announcement } from "../types";
import "../../Admin.css";

// Mockup: in-memory list. Replace with API in Phase 2.
const MOCK_ANNOUNCEMENTS: Announcement[] = [
  {
    id: "whats-new-1",
    title: "What's New",
    summary:
      "What's new is What's New. This is where we'll highlight new features and link to the User Guide.",
    link: "/terms",
    publishedAt: "2025-02-01",
    sortOrder: 0,
  },
  {
    id: "whats-new-2",
    title: "Feature highlights",
    summary:
      "Each item will have a short summary and a Find Out More button linking to the User Guide.",
    link: "#",
    publishedAt: "2025-02-15",
    sortOrder: 1,
  },
];

function generateId(): string {
  return `announcement-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const emptyForm: Omit<Announcement, "id" | "createdAt" | "updatedAt"> = {
  title: "",
  summary: "",
  link: "",
  publishedAt: new Date().toISOString().slice(0, 10),
  sortOrder: 0,
};

export const WhatsNewAdmin = () => {
  const [items, setItems] = useState<Announcement[]>(() =>
    [...MOCK_ANNOUNCEMENTS].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

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

  const handleSave = useCallback(() => {
    if (!form.title.trim()) return;
    if (editingId) {
      setItems((prev) =>
        prev.map((it) =>
          it.id === editingId
            ? {
                ...it,
                ...form,
                updatedAt: new Date().toISOString(),
              }
            : it
        )
      );
    } else {
      setItems((prev) => [
        ...prev,
        {
          id: generateId(),
          ...form,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
    }
    closeModal();
  }, [editingId, form, closeModal]);

  const handleDelete = useCallback((id: string) => {
    if (window.confirm("Delete this announcement? (Mockup: only removes from this list.)")) {
      setItems((prev) => prev.filter((it) => it.id !== id));
      if (editingId === id) closeModal();
    }
  }, [editingId, closeModal]);

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
          <p className="admin-tos-modal-hint" style={{ marginBottom: "1rem" }}>
            <strong>Mockup:</strong> Data is not saved. Add, edit, and delete only affect this session. Backend and persistence coming soon.
          </p>
          <button type="button" className="admin-button" onClick={openCreate}>
            <FontAwesomeIcon icon={faPlus} /> Add announcement
          </button>

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
                  onClick={handleSave}
                  disabled={!form.title.trim()}
                >
                  <FontAwesomeIcon icon={faSave} /> {editingId ? "Save changes" : "Add announcement"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
