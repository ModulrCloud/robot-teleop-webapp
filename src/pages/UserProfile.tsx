import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { useState, useEffect } from "react";
import { useAuthStatus } from "../hooks/useAuthStatus";
import './UserProfile.css';
import { usePageTitle } from "../hooks/usePageTitle";
import { LoadingWheel } from "../components/LoadingWheel";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faEdit, faSave, faTimes } from '@fortawesome/free-solid-svg-icons';
import { formatGroupName, capitalizeName } from "../utils/formatters";
import { logger } from '../utils/logger';

const client = generateClient<Schema>();

interface PartnerData {
  id: string;
  name: string;
  description: string;
  displayName?: string | null;
  averageRating?: number | null;
  reliabilityScore?: number | null;
  publicKey?: string | null;
}

interface ClientData {
  id: string;
  displayName?: string | null;
  averageRating?: number | null;
  reliabilityScore?: number | null;
  publicKey?: string | null;
  preferredCurrency?: string | null;
}

export function UserProfile() {
  usePageTitle();
  const { user } = useAuthStatus();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  const [partnerData, setPartnerData] = useState<PartnerData | null>(null);
  const [clientData, setClientData] = useState<ClientData | null>(null);
  
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    displayName: "",
  });
  
  const [displayNameForm, setDisplayNameForm] = useState({
    displayName: "",
  });
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  
  const [currencyForm, setCurrencyForm] = useState({
    preferredCurrency: "USD",
  });
  const [isEditingCurrency, setIsEditingCurrency] = useState(false);

  const isPartner = user?.group === "PARTNERS";
  const isClient = user?.group === "CLIENTS";

  useEffect(() => {
    loadProfileData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadProfileData = async () => {
    if (!user?.username) return;
    
    setLoading(true);
    try {
      if (isPartner) {
        const { data: partners } = await client.models.Partner.list({
          filter: { cognitoUsername: { eq: user.username } }
        });
        
        if (partners && partners.length > 0) {
          const partner = partners[0];
          setPartnerData({
            id: partner.id || "",
            name: partner.name || "",
            description: partner.description || "",
            displayName: partner.displayName || null,
            averageRating: partner.averageRating,
            reliabilityScore: partner.reliabilityScore,
            publicKey: partner.publicKey,
          });
          setEditForm({
            name: partner.name || "",
            description: partner.description || "",
            displayName: partner.displayName || "",
          });
          setDisplayNameForm({
            displayName: partner.displayName || "",
          });
        }
      } else if (isClient) {
        const { data: clients } = await client.models.Client.list({
          filter: { cognitoUsername: { eq: user.username } }
        });
        
        if (clients && clients.length > 0) {
          const clientRecord = clients[0];
          setClientData({
            id: clientRecord.id || "",
            displayName: clientRecord.displayName || null,
            averageRating: clientRecord.averageRating,
            reliabilityScore: clientRecord.reliabilityScore,
            publicKey: clientRecord.publicKey,
            preferredCurrency: clientRecord.preferredCurrency || "USD",
          });
          setCurrencyForm({
            preferredCurrency: clientRecord.preferredCurrency || "USD",
          });
          setDisplayNameForm({
            displayName: clientRecord.displayName || "",
          });
        }
      }
    } catch (err) {
      logger.error("Error loading profile:", err);
      setError("Failed to load profile data");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEditForm(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSave = async () => {
    if (isPartner && partnerData) {
      if (!editForm.name.trim()) {
        setError("Name is required");
        return;
      }
      if (!editForm.description.trim()) {
        setError("Description is required");
        return;
      }

      setSaving(true);
      setError("");
      setSuccess("");

      try {
        const { errors } = await client.models.Partner.update({
          id: partnerData.id,
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          displayName: editForm.displayName.trim() || null,
        });

        if (errors) {
          setError("Failed to update profile");
        } else {
          setPartnerData(prev => prev ? {
            ...prev,
            name: editForm.name.trim(),
            description: editForm.description.trim(),
            displayName: editForm.displayName.trim() || null,
          } : null);
          setSuccess("Profile updated successfully!");
          setIsEditing(false);
          setTimeout(() => setSuccess(""), 3000);
        }
      } catch (err) {
        logger.error("Error updating profile:", err);
        setError("An error occurred while updating");
      } finally {
        setSaving(false);
      }
    }
  };

  const handleCancel = () => {
    if (partnerData) {
      setEditForm({
        name: partnerData.name,
        description: partnerData.description,
        displayName: partnerData.displayName || "",
      });
    }
    setIsEditing(false);
    setError("");
  };

  const handleDisplayNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDisplayNameForm({
      displayName: e.target.value,
    });
  };

  const handleSaveDisplayName = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (isPartner && partnerData) {
        const { errors } = await client.models.Partner.update({
          id: partnerData.id,
          displayName: displayNameForm.displayName.trim() || null,
        });

        if (errors) {
          setError("Failed to update display name");
        } else {
          setPartnerData(prev => prev ? {
            ...prev,
            displayName: displayNameForm.displayName.trim() || null,
          } : null);
          setEditForm(prev => ({
            ...prev,
            displayName: displayNameForm.displayName.trim(),
          }));
          setSuccess("Display name updated successfully!");
          setIsEditingDisplayName(false);
          setTimeout(() => setSuccess(""), 3000);
        }
      } else if (isClient && clientData) {
        const { errors } = await client.models.Client.update({
          id: clientData.id,
          displayName: displayNameForm.displayName.trim() || null,
        });

        if (errors) {
          setError("Failed to update display name");
        } else {
          setClientData(prev => prev ? {
            ...prev,
            displayName: displayNameForm.displayName.trim() || null,
          } : null);
          setSuccess("Display name updated successfully!");
          setIsEditingDisplayName(false);
          setTimeout(() => setSuccess(""), 3000);
        }
      }
    } catch (err) {
      logger.error("Error updating display name:", err);
      setError("An error occurred while updating display name");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelDisplayName = () => {
    if (isPartner && partnerData) {
      setDisplayNameForm({
        displayName: partnerData.displayName || "",
      });
    } else if (isClient && clientData) {
      setDisplayNameForm({
        displayName: clientData.displayName || "",
      });
    }
    setIsEditingDisplayName(false);
  };

  const handleCurrencyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrencyForm({
      preferredCurrency: e.target.value,
    });
  };

  const handleSaveCurrency = async () => {
    if (!clientData?.id) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { errors } = await client.models.Client.update({
        id: clientData.id,
        preferredCurrency: currencyForm.preferredCurrency,
      });

      if (errors) {
        setError("Failed to update currency preference");
      } else {
        setClientData(prev => prev ? {
          ...prev,
          preferredCurrency: currencyForm.preferredCurrency,
        } : null);
        setSuccess("Currency preference updated successfully!");
        setIsEditingCurrency(false);
        setTimeout(() => setSuccess(""), 3000);
        // Reload page to update credits display
        window.location.reload();
      }
    } catch (err) {
      logger.error("Error updating currency:", err);
      setError("An error occurred while updating currency");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelCurrency = () => {
    if (clientData) {
      setCurrencyForm({
        preferredCurrency: clientData.preferredCurrency || "USD",
      });
    }
    setIsEditingCurrency(false);
  };

  if (loading) {
    return (
      <div className="loading-wrapper">
        <LoadingWheel />
      </div>
    );
  }

  return (
    <div className="profile-wrapper">
      <div className="profile-container">
        <div className="profile-header">
          <div className="profile-avatar">
            <FontAwesomeIcon icon={faUser} />
          </div>
          <div className="profile-header-info">
            <h1>{capitalizeName(user?.displayName) || capitalizeName(user?.email?.split('@')[0]) || user?.email}</h1>
            <span className="profile-badge">{formatGroupName(user?.group)}</span>
          </div>
        </div>

        {success && <div className="success-message">{success}</div>}
        {error && <div className="error-message">{error}</div>}

        <div className="profile-section">
          <h2>Account Information</h2>
          <div className="profile-info-grid">
            <div className="info-item">
              <label>Email</label>
              <p>{user?.email}</p>
            </div>
            <div className="info-item">
              <label>Account Type</label>
              <p>{formatGroupName(user?.group)}</p>
            </div>
            <div className="info-item">
              <label>Username</label>
              <p>{capitalizeName(user?.username)}</p>
            </div>
            <div className="info-item">
              <label>Display Name</label>
              {isEditingDisplayName ? (
                <div className="display-name-edit">
                  <input
                    type="text"
                    value={displayNameForm.displayName}
                    onChange={handleDisplayNameChange}
                    className="form-input"
                    placeholder="Enter display name (leave empty for Anonymous)"
                    maxLength={50}
                    disabled={saving}
                  />
                  <div className="display-name-edit-actions">
                    <button 
                      onClick={handleSaveDisplayName} 
                      className="btn-save-small"
                      disabled={saving}
                    >
                      <FontAwesomeIcon icon={faSave} /> Save
                    </button>
                    <button 
                      onClick={handleCancelDisplayName} 
                      className="btn-cancel-small"
                      disabled={saving}
                    >
                      <FontAwesomeIcon icon={faTimes} /> Cancel
                    </button>
                  </div>
                  <p className="display-name-hint">This name will be shown in your reviews and ratings instead of your email. Leave empty to show as "Anonymous".</p>
                </div>
              ) : (
                <div className="display-name-display">
                  <p>{isPartner ? (partnerData?.displayName || "Anonymous") : (clientData?.displayName || "Anonymous")}</p>
                  <button 
                    onClick={() => setIsEditingDisplayName(true)} 
                    className="btn-edit-small"
                  >
                    <FontAwesomeIcon icon={faEdit} />
                  </button>
                </div>
              )}
            </div>
            {isClient && (
              <div className="info-item">
                <label>Preferred Currency</label>
                {isEditingCurrency ? (
                  <div className="currency-edit">
                    <select
                      value={currencyForm.preferredCurrency}
                      onChange={handleCurrencyChange}
                      className="form-select"
                      disabled={saving}
                    >
                      <option value="USD">USD - US Dollar ($)</option>
                      <option value="EUR">EUR - Euro (€)</option>
                      <option value="GBP">GBP - British Pound (£)</option>
                      <option value="CAD">CAD - Canadian Dollar (C$)</option>
                      <option value="AUD">AUD - Australian Dollar (A$)</option>
                      <option value="JPY">JPY - Japanese Yen (¥)</option>
                    </select>
                    <div className="currency-edit-actions">
                      <button 
                        onClick={handleSaveCurrency} 
                        className="btn-save-small"
                        disabled={saving}
                      >
                        <FontAwesomeIcon icon={faSave} /> Save
                      </button>
                      <button 
                        onClick={handleCancelCurrency} 
                        className="btn-cancel-small"
                        disabled={saving}
                      >
                        <FontAwesomeIcon icon={faTimes} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="currency-display">
                    <p>{clientData?.preferredCurrency || "USD"}</p>
                    <button 
                      onClick={() => setIsEditingCurrency(true)} 
                      className="btn-edit-small"
                    >
                      <FontAwesomeIcon icon={faEdit} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {isPartner && partnerData && (
          <div className="profile-section">
            <div className="section-header">
              <h2>Partner Profile</h2>
              {!isEditing && (
                <button onClick={() => setIsEditing(true)} className="btn-edit">
                  <FontAwesomeIcon icon={faEdit} /> Edit Profile
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="edit-form">
                <div className="form-group">
                  <label htmlFor="name">Organization Name *</label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    value={editForm.name}
                    onChange={handleInputChange}
                    className="form-input"
                    disabled={saving}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="description">Description *</label>
                  <textarea
                    id="description"
                    name="description"
                    value={editForm.description}
                    onChange={handleInputChange}
                    className="form-textarea"
                    rows={4}
                    disabled={saving}
                  />
                </div>

                <div className="form-actions">
                  {saving ? (
                    <LoadingWheel />
                  ) : (
                    <>
                      <button onClick={handleSave} className="btn-save">
                        <FontAwesomeIcon icon={faSave} /> Save Changes
                      </button>
                      <button onClick={handleCancel} className="btn-cancel">
                        <FontAwesomeIcon icon={faTimes} /> Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="profile-info-grid">
                <div className="info-item">
                  <label>Organization Name</label>
                  <p>{partnerData.name}</p>
                </div>
                <div className="info-item full-width">
                  <label>Description</label>
                  <p>{partnerData.description}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {((isPartner && partnerData) || (isClient && clientData)) && (
          <div className="profile-section">
            <h2>Statistics</h2>
            <div className="profile-info-grid">
              <div className="info-item">
                <label>Average Rating</label>
                <p>{isPartner ? partnerData?.averageRating?.toFixed(1) || "N/A" : clientData?.averageRating?.toFixed(1) || "N/A"}</p>
              </div>
              <div className="info-item">
                <label>Reliability Score</label>
                <p>{isPartner ? partnerData?.reliabilityScore?.toFixed(1) || "N/A" : clientData?.reliabilityScore?.toFixed(1) || "N/A"}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}