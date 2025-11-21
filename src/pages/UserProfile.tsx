import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { useState, useEffect } from "react";
import { useAuthStatus } from "../hooks/useAuthStatus";
import './UserProfile.css';
import { usePageTitle } from "../hooks/usePageTitle";
import { LoadingWheel } from "../components/LoadingWheel";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faEdit, faSave, faTimes } from '@fortawesome/free-solid-svg-icons';
import { formatGroupName } from "../utils/formatters";

const client = generateClient<Schema>();

interface PartnerData {
  id: string;
  name: string;
  description: string;
  averageRating?: number | null;
  reliabilityScore?: number | null;
  publicKey?: string | null;
}

interface ClientData {
  id: string;
  averageRating?: number | null;
  reliabilityScore?: number | null;
  publicKey?: string | null;
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
  });

  const isPartner = user?.group === "PARTNERS";
  const isClient = user?.group === "CLIENTS";

  useEffect(() => {
    loadProfileData();
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
            averageRating: partner.averageRating,
            reliabilityScore: partner.reliabilityScore,
            publicKey: partner.publicKey,
          });
          setEditForm({
            name: partner.name || "",
            description: partner.description || "",
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
            averageRating: clientRecord.averageRating,
            reliabilityScore: clientRecord.reliabilityScore,
            publicKey: clientRecord.publicKey,
          });
        }
      }
    } catch (err) {
      console.error("Error loading profile:", err);
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
        });

        if (errors) {
          setError("Failed to update profile");
        } else {
          setPartnerData(prev => prev ? {
            ...prev,
            name: editForm.name.trim(),
            description: editForm.description.trim(),
          } : null);
          setSuccess("Profile updated successfully!");
          setIsEditing(false);
          setTimeout(() => setSuccess(""), 3000);
        }
      } catch (err) {
        console.error("Error updating profile:", err);
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
      });
    }
    setIsEditing(false);
    setError("");
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
            <h1>{user?.displayName || user?.email}</h1>
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
              <p>{user?.username}</p>
            </div>
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