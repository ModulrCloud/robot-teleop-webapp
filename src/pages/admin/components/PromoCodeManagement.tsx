import { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTag,
  faPlus,
  faEdit,
  faTrash,
  faCheck,
  faTimes,
  faSave,
  faSpinner,
  faInfoCircle,
  faCalendarAlt,
  faUsers,
  faPercent,
  faGift,
} from "@fortawesome/free-solid-svg-icons";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../../../amplify/data/resource";
import { useAuthStatus } from "../../../hooks/useAuthStatus";
import { hasAdminAccess } from "../../../utils/admin";
import { logger } from "../../../utils/logger";
import { DateTimePicker } from "../../../components/DateTimePicker";
import "../../Admin.css";

const client = generateClient<Schema>();

interface PromoCode {
  id: string;
  code: string;
  usernameDiscountPercent: number | null;
  trialMonths: number | null;
  maxUses: number | null;
  usedCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export const PromoCodeManagement = () => {
  const { user } = useAuthStatus();
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    code: '',
    usernameDiscountPercent: 0,
    trialMonths: 0,
    maxUses: null as number | null,
    startsAt: '',
    expiresAt: '',
    isActive: true,
    source: '',
  });

  const loadPromoCodes = useCallback(async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (import.meta.env?.DEV) {
        logger.log("🔍 [PROMO CODES] Loading promo codes...");
        logger.log("🔍 [PROMO CODES] User:", { email: user.email, group: user?.group });
        logger.log("🔍 [PROMO CODES] Client models:", Object.keys(client.models || {}));
      }
      
      // Check if PromoCode model is available
      if (!client.models || !('PromoCode' in client.models)) {
        const errorMsg = "PromoCode model not available. The schema needs to be regenerated. Please run 'npx ampx sandbox' or deploy the backend to generate the model.";
        logger.error("❌ [PROMO CODES]", errorMsg);
        logger.error("❌ [PROMO CODES] Available models:", Object.keys(client.models || {}));
        setError(errorMsg);
        return;
      }
      
      const result = await client.models.PromoCode.list();
      
      if (import.meta.env?.DEV) {
        logger.log("🔍 [PROMO CODES] Raw result:", JSON.stringify(result, null, 2));
      }
      
      // Check for GraphQL errors
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: any) => {
          if (import.meta.env?.DEV) {
            logger.error("❌ [PROMO CODES] Individual error:", e);
          }
          return e.message || e.errorType || JSON.stringify(e);
        }).join(', ');
        logger.error("❌ [PROMO CODES] GraphQL errors:", result.errors);
        
        // Check if it's an authorization error
        const isAuthError = errorMessages.toLowerCase().includes('unauthorized') || 
                           errorMessages.toLowerCase().includes('not authorized') ||
                           errorMessages.toLowerCase().includes('access denied') ||
                           errorMessages.toLowerCase().includes('forbidden');
        
        if (isAuthError) {
          setError(`Access denied. You must be in the ADMINS Cognito group to manage promo codes. Current group: ${user?.group || 'none'}`);
        } else {
          setError(`GraphQL Error: ${errorMessages}`);
        }
        return;
      }

      if (!result.data) {
        logger.warn("⚠️ [PROMO CODES] No data returned");
        setPromoCodes([]);
        return;
      }

      const codes = result.data.map(code => ({
        id: code.id,
        code: code.code,
        usernameDiscountPercent: code.usernameDiscountPercent ?? null,
        trialMonths: code.trialMonths ?? null,
        maxUses: code.maxUses ?? null,
        usedCount: code.usedCount ?? 0,
        startsAt: code.startsAt ?? null,
        expiresAt: code.expiresAt ?? null,
        isActive: code.isActive ?? true,
        source: code.source ?? null,
        createdAt: code.createdAt ?? null,
        updatedAt: code.updatedAt ?? null,
      }));
      
      setPromoCodes(codes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
      
      if (import.meta.env?.DEV) {
        logger.log(`✅ [PROMO CODES] Loaded ${codes.length} promo code(s)`);
      }
    } catch (err) {
      logger.error("❌ [PROMO CODES] Error loading promo codes:", err);
      
      // Provide more detailed error information
      let errorMessage = 'Unknown error';
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null) {
        // Try to extract error message from GraphQL error
        const errObj = err as any;
        if (errObj.errors && Array.isArray(errObj.errors)) {
          errorMessage = errObj.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        } else if (errObj.message) {
          errorMessage = errObj.message;
        } else {
          errorMessage = JSON.stringify(err);
        }
      }
      
      // Check if it's an authorization error
      if (errorMessage.toLowerCase().includes('unauthorized') || 
          errorMessage.toLowerCase().includes('not authorized') ||
          errorMessage.toLowerCase().includes('access denied')) {
        setError(`Access denied. You must be in the ADMINS Cognito group to manage promo codes. Current group: ${user?.group || 'none'}`);
      } else {
        setError(`Failed to load promo codes: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    loadPromoCodes();
  }, [loadPromoCodes]);

  const resetForm = () => {
    setFormData({
      code: '',
      usernameDiscountPercent: 0,
      trialMonths: 0,
      maxUses: null,
      startsAt: '',
      expiresAt: '',
      isActive: true,
      source: '',
    });
    setEditingId(null);
    setIsCreating(false);
  };

  const handleEdit = (code: PromoCode) => {
    setFormData({
      code: code.code,
      usernameDiscountPercent: code.usernameDiscountPercent ?? 0,
      trialMonths: code.trialMonths ?? 0,
      maxUses: code.maxUses,
      startsAt: code.startsAt ? new Date(code.startsAt).toISOString().slice(0, 16) : '',
      expiresAt: code.expiresAt ? new Date(code.expiresAt).toISOString().slice(0, 16) : '',
      isActive: code.isActive,
      source: code.source ?? '',
    });
    setEditingId(code.id);
    setIsCreating(false);
  };

  const handleCreate = () => {
    resetForm();
    setIsCreating(true);
  };

  const handleSave = async () => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      setError("Unauthorized: Admin access required");
      return;
    }

    if (!formData.code.trim()) {
      setError("Code is required");
      return;
    }

    if (formData.usernameDiscountPercent < 0 || formData.usernameDiscountPercent > 100) {
      setError("Discount percentage must be between 0 and 100");
      return;
    }

    if (formData.trialMonths < 0) {
      setError("Trial months cannot be negative");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const now = new Date().toISOString();
      const codeData = {
        code: formData.code.trim().toUpperCase(),
        usernameDiscountPercent: formData.usernameDiscountPercent > 0 ? formData.usernameDiscountPercent : null,
        trialMonths: formData.trialMonths > 0 ? formData.trialMonths : null,
        maxUses: formData.maxUses && formData.maxUses > 0 ? formData.maxUses : null,
        startsAt: formData.startsAt ? new Date(formData.startsAt).toISOString() : null,
        expiresAt: formData.expiresAt ? new Date(formData.expiresAt).toISOString() : null,
        isActive: formData.isActive,
        source: formData.source.trim() || null,
        createdAt: now,
        updatedAt: now,
      };

      let result;
      if (editingId) {
        // Update existing
        result = await client.models.PromoCode.update({
          id: editingId,
          ...codeData,
        });
      } else {
        // Create new
        result = await client.models.PromoCode.create(codeData);
      }

      // Check for GraphQL errors
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        logger.error("❌ [PROMO CODES] GraphQL errors:", result.errors);
        setError(`GraphQL Error: ${errorMessages}`);
        return;
      }

      if (editingId) {
        setSuccess("Promo code updated successfully");
      } else {
        setSuccess("Promo code created successfully");
      }

      resetForm();
      await loadPromoCodes();
    } catch (err) {
      logger.error("Error saving promo code:", err);
      setError(err instanceof Error ? err.message : "Failed to save promo code");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      setError("Unauthorized: Admin access required");
      return;
    }

    if (!confirm("Are you sure you want to delete this promo code? This action cannot be undone.")) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await client.models.PromoCode.delete({ id });
      
      // Check for GraphQL errors
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        logger.error("❌ [PROMO CODES] GraphQL errors:", result.errors);
        setError(`GraphQL Error: ${errorMessages}`);
        return;
      }

      setSuccess("Promo code deleted successfully");
      await loadPromoCodes();
    } catch (err) {
      logger.error("❌ [PROMO CODES] Error deleting promo code:", err);
      setError(err instanceof Error ? err.message : "Failed to delete promo code");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (code: PromoCode) => {
    if (!user?.email || !hasAdminAccess(user.email)) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await client.models.PromoCode.update({
        id: code.id,
        isActive: !code.isActive,
        updatedAt: new Date().toISOString(),
      });

      // Check for GraphQL errors
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        logger.error("❌ [PROMO CODES] GraphQL errors:", result.errors);
        setError(`GraphQL Error: ${errorMessages}`);
        return;
      }

      await loadPromoCodes();
    } catch (err) {
      logger.error("❌ [PROMO CODES] Error toggling promo code:", err);
      setError(err instanceof Error ? err.message : "Failed to update promo code");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const isCodeActive = (code: PromoCode) => {
    if (!code.isActive) return false;
    const now = new Date();
    if (code.startsAt && new Date(code.startsAt) > now) return false;
    if (code.expiresAt && new Date(code.expiresAt) < now) return false;
    if (code.maxUses && code.usedCount >= code.maxUses) return false;
    return true;
  };

  return (
    <div className="admin-section">
      <div className="section-header">
        <FontAwesomeIcon icon={faTag} className="section-icon" />
        <h2>Promo Code Management</h2>
      </div>

      {error && (
        <div className="admin-alert admin-alert-error">
          <FontAwesomeIcon icon={faTimes} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="admin-alert admin-alert-success">
          <FontAwesomeIcon icon={faCheck} />
          <span>{success}</span>
        </div>
      )}

      <div className="section-content">
        {/* Create/Edit Form */}
        {(isCreating || editingId) && (
          <div className="promo-code-form">
            <h3>{editingId ? 'Edit Promo Code' : 'Create New Promo Code'}</h3>
            
            <div className="form-grid">
              <div className="form-group">
                <label>Code *</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="MODULRX"
                  maxLength={20}
                  disabled={saving || !!editingId}
                />
                <small>Code will be stored in uppercase</small>
              </div>

              <div className="form-group">
                <label>
                  <FontAwesomeIcon icon={faPercent} /> Discount %
                </label>
                <input
                  type="number"
                  value={formData.usernameDiscountPercent}
                  onChange={(e) => setFormData({ ...formData, usernameDiscountPercent: parseInt(e.target.value) || 0 })}
                  min="0"
                  max="100"
                  placeholder="50"
                />
                <small>Percentage discount on username purchase (0-100)</small>
              </div>

              <div className="form-group">
                <label>
                  <FontAwesomeIcon icon={faGift} /> Bonus Trial Months
                </label>
                <input
                  type="number"
                  value={formData.trialMonths}
                  onChange={(e) => setFormData({ ...formData, trialMonths: parseInt(e.target.value) || 0 })}
                  min="0"
                  placeholder="3"
                />
                <small>Additional trial months beyond the 3-month base trial</small>
              </div>

              <div className="form-group">
                <label>Max Uses</label>
                <input
                  type="number"
                  value={formData.maxUses || ''}
                  onChange={(e) => setFormData({ ...formData, maxUses: e.target.value ? parseInt(e.target.value) : null })}
                  min="1"
                  placeholder="Unlimited"
                />
                <small>Leave empty for unlimited uses</small>
              </div>

              <div className="form-group">
                <DateTimePicker
                  label="Start Date"
                  value={formData.startsAt || ''}
                  onChange={(value) => setFormData({ ...formData, startsAt: value || '' })}
                />
                <small>Leave empty to activate immediately</small>
              </div>

              <div className="form-group">
                <DateTimePicker
                  label="Expiry Date"
                  value={formData.expiresAt || ''}
                  onChange={(value) => setFormData({ ...formData, expiresAt: value || '' })}
                  min={formData.startsAt || undefined}
                />
                <small>Leave empty for no expiration</small>
              </div>

              <div className="form-group">
                <label>Source/Campaign</label>
                <input
                  type="text"
                  value={formData.source}
                  onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                  placeholder="x_launch_campaign"
                />
                <small>Optional tracking identifier</small>
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  />
                  Active
                </label>
                <small>Inactive codes cannot be used</small>
              </div>
            </div>

            <div className="form-actions">
              <button
                className="admin-button admin-button-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin />
                    Saving...
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faSave} />
                    Save
                  </>
                )}
              </button>
              <button
                className="admin-button admin-button-secondary"
                onClick={resetForm}
                disabled={saving}
              >
                <FontAwesomeIcon icon={faTimes} />
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Create Button */}
        {!isCreating && !editingId && (
          <div className="section-actions">
            <button className="admin-button admin-button-primary" onClick={handleCreate}>
              <FontAwesomeIcon icon={faPlus} />
              Create Promo Code
            </button>
          </div>
        )}

        {/* Promo Codes List */}
        {loading ? (
          <div className="loading-state">
            <FontAwesomeIcon icon={faSpinner} spin />
            <p>Loading promo codes...</p>
          </div>
        ) : promoCodes.length === 0 ? (
          <div className="empty-state">
            <FontAwesomeIcon icon={faTag} />
            <p>No promo codes found. Create your first one!</p>
          </div>
        ) : (
          <div className="promo-codes-table">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Bonus Trial</th>
                  <th>Usage</th>
                  <th>Validity</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {promoCodes.map((code) => {
                  const active = isCodeActive(code);
                  return (
                    <tr key={code.id} className={!code.isActive ? 'inactive' : active ? 'active' : 'expired'}>
                      <td>
                        <strong>{code.code}</strong>
                        {code.source && (
                          <small className="code-source">{code.source}</small>
                        )}
                      </td>
                      <td>
                        {code.usernameDiscountPercent ? (
                          <span className="badge badge-discount">
                            {code.usernameDiscountPercent}%
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {code.trialMonths ? (
                          <span className="badge badge-trial">
                            +{code.trialMonths}mo
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {code.maxUses ? (
                          <span>
                            {code.usedCount} / {code.maxUses}
                          </span>
                        ) : (
                          <span>{code.usedCount} uses</span>
                        )}
                      </td>
                      <td>
                        <div className="date-info">
                          <small>
                            <strong>Start:</strong> {formatDate(code.startsAt)}
                          </small>
                          <small>
                            <strong>End:</strong> {formatDate(code.expiresAt)}
                          </small>
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${active ? 'active' : 'inactive'}`}>
                          {active ? 'Active' : code.isActive ? 'Inactive' : 'Disabled'}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button
                            className="btn-icon"
                            onClick={() => handleToggleActive(code)}
                            title={code.isActive ? 'Deactivate' : 'Activate'}
                            disabled={saving}
                          >
                            <FontAwesomeIcon icon={code.isActive ? faTimes : faCheck} />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => handleEdit(code)}
                            title="Edit"
                            disabled={saving}
                          >
                            <FontAwesomeIcon icon={faEdit} />
                          </button>
                          <button
                            className="btn-icon btn-danger"
                            onClick={() => handleDelete(code.id)}
                            title="Delete"
                            disabled={saving}
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
