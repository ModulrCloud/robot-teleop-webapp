import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { useState, useEffect } from "react";
import { useAuthStatus } from "../hooks/useAuthStatus";
import './UserProfile.css';
import { usePageTitle } from "../hooks/usePageTitle";
import { LoadingWheel } from "../components/LoadingWheel";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faEdit, faSave, faTimes, faExternalLinkAlt, faAt, faGlobe, faCrown, faCalendarAlt, faRocket, faGift, faCheckCircle, faExclamationCircle } from '@fortawesome/free-solid-svg-icons';
import { useNavigate } from 'react-router-dom';
import { formatGroupName, capitalizeName } from "../utils/formatters";
import { logger } from '../utils/logger';
import { UsernameRegistrationModal } from "../components/UsernameRegistrationModal";
import { SubscriptionModal } from "../components/SubscriptionModal";

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
  const navigate = useNavigate();
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

  // Social Profile state
  const [socialProfile, setSocialProfile] = useState<{
    id: string;
    username: string | null;
    displayName: string | null;
    subscriptionStatus: string | null;
    subscriptionPlan: string | null;
    subscriptionStartedAt: string | null;
    subscriptionExpiresAt: string | null;
    trialEndsAt: string | null;
    pendingSubscriptionPlan: string | null;
    pendingSubscriptionStartsAt: string | null;
    isOgPricing: boolean;
    ogPriceMtrMonthly: number | null;
    ogPriceMtrAnnual: number | null;
    modulrAddress: string | null;
  } | null>(null);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  const isPartner = user?.group === "PARTNERS";
  const isClient = user?.group === "CLIENTS";

  useEffect(() => {
    loadProfileData();
    
    // Listen for social profile updates (e.g., after username purchase or profile repair)
    const handleProfileUpdate = () => {
      loadProfileData();
    };
    
    window.addEventListener('socialProfileUpdated', handleProfileUpdate);
    return () => {
      window.removeEventListener('socialProfileUpdated', handleProfileUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadProfileData = async () => {
    if (!user?.username) return;
    
    setLoading(true);
    
    try {
      // Load Social Profile via Lambda (bypasses Amplify Data authorization issues)
      try {
        const result = await client.queries.getSocialProfileLambda();
        
        // Parse the response (Lambda returns JSON string)
        let response;
        if (typeof result.data === 'string') {
          const parsedData = JSON.parse(result.data);
          if (parsedData.body) {
            response = JSON.parse(parsedData.body);
          } else {
            response = parsedData;
          }
        } else {
          response = result.data;
        }
        
        if (response?.success && response?.profile) {
          const profile = response.profile;
          setSocialProfile({
            id: profile.id || '',
            username: profile.username || null,
            displayName: profile.displayName || null,
            subscriptionStatus: profile.subscriptionStatus || null,
            subscriptionPlan: profile.subscriptionPlan || null,
            subscriptionStartedAt: profile.subscriptionStartedAt || null,
            subscriptionExpiresAt: profile.subscriptionExpiresAt || null,
            trialEndsAt: profile.trialEndsAt || null,
            pendingSubscriptionPlan: profile.pendingSubscriptionPlan || null,
            pendingSubscriptionStartsAt: profile.pendingSubscriptionStartsAt || null,
            isOgPricing: profile.isOgPricing || false,
            ogPriceMtrMonthly: profile.ogPriceMtrMonthly || null,
            ogPriceMtrAnnual: profile.ogPriceMtrAnnual || null,
            modulrAddress: profile.modulrAddress || null,
          });
        }
        // No profile found is okay - user hasn't registered a username yet
      } catch (socialErr) {
        // Only log errors in development
        if (import.meta.env.DEV) {
          logger.error("[UserProfile] Error loading social profile:", socialErr);
        }
        // Non-fatal - social profile may not exist yet
      }
      
      if (isPartner) {
        const allPartners = await client.models.Partner.list({ limit: 100 });
        const emailPrefix = user.email?.split('@')[0] || '';
        const partner = allPartners.data?.find(p => 
          p.cognitoUsername === user.username ||
          p.cognitoUsername === user.email ||
          (emailPrefix && p.cognitoUsername?.includes(emailPrefix))
        );
        
        if (partner) {
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

  const handleUsernameSuccess = (username: string) => {
    setSocialProfile(prev => prev ? { ...prev, username } : {
      id: '',
      username,
      displayName: null,
      subscriptionStatus: 'trial',
      subscriptionPlan: null,
      subscriptionStartedAt: null,
      subscriptionExpiresAt: null,
      trialEndsAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      isOgPricing: true,
      ogPriceMtrMonthly: 399,
      ogPriceMtrAnnual: 4000,
      modulrAddress: null,
    });
    setShowUsernameModal(false);
    // Reload to get full profile data
    loadProfileData();
  };

  // Helper function to format dates
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Helper function to get days remaining
  const getDaysRemaining = (dateString: string | null) => {
    if (!dateString) return 0;
    const endDate = new Date(dateString);
    const now = new Date();
    const diffTime = endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  // Get subscription display info
  const getSubscriptionInfo = () => {
    if (!socialProfile) return null;
    
    const status = socialProfile.subscriptionStatus;
    const trialDaysLeft = getDaysRemaining(socialProfile.trialEndsAt);
    const subscriptionDaysLeft = getDaysRemaining(socialProfile.subscriptionExpiresAt);
    
    switch (status) {
      case 'trial':
        return {
          label: 'Pro Trial',
          badgeClass: 'trial',
          icon: faGift,
          message: trialDaysLeft > 0 
            ? `${trialDaysLeft} days remaining in your free trial`
            : 'Your trial has ended',
          expiresAt: socialProfile.trialEndsAt,
          canUpgrade: true,
          showWarning: trialDaysLeft <= 7 && trialDaysLeft > 0,
        };
      case 'active':
        return {
          label: 'Pro',
          badgeClass: 'active',
          icon: faCrown,
          message: `${socialProfile.subscriptionPlan === 'annual' ? 'Annual' : 'Monthly'} subscription`,
          expiresAt: socialProfile.subscriptionExpiresAt,
          canUpgrade: socialProfile.subscriptionPlan === 'monthly',
          showWarning: subscriptionDaysLeft <= 7 && subscriptionDaysLeft > 0,
        };
      case 'cancelled':
        return {
          label: 'Pro (Cancelled)',
          badgeClass: 'cancelled',
          icon: faExclamationCircle,
          message: 'Your subscription has been cancelled',
          expiresAt: socialProfile.subscriptionExpiresAt,
          canUpgrade: true,
          showWarning: true,
        };
      case 'expired':
        return {
          label: 'Free',
          badgeClass: 'expired',
          icon: faExclamationCircle,
          message: 'Your Pro access has expired',
          expiresAt: null,
          canUpgrade: true,
          showWarning: false,
        };
      default:
        return {
          label: 'Free',
          badgeClass: 'none',
          icon: faUser,
          message: 'Upgrade to Pro for unlimited posts and more',
          expiresAt: null,
          canUpgrade: true,
          showWarning: false,
        };
    }
  };

  const subscriptionInfo = getSubscriptionInfo();

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

        <div className="profile-section account-section">
          <h2>
            <FontAwesomeIcon icon={faUser} className="section-icon" />
            Account Information
          </h2>
          <div className="profile-info-grid">
            {/* Row 1: Email & Account Type */}
            <div className="info-item">
              <label>Email</label>
              <p>{user?.email}</p>
            </div>
            <div className="info-item">
              <label>Account Type</label>
              <p>{formatGroupName(user?.group)}</p>
            </div>

            {/* Row 2: Google ID */}
            <div className="info-item full-width">
              <label>Google ID</label>
              <p className="google-id">{user?.username}</p>
              <span className="info-hint">Your OAuth identifier (private - never shown publicly)</span>
            </div>

            {/* Row 3: @Username */}
            <div className="info-item full-width">
              <label>
                <FontAwesomeIcon icon={faAt} className="label-icon" />
                Username
              </label>
              {socialProfile?.username ? (
                <div className="username-display">
                  <p className="username-value">@{socialProfile.username}</p>
                  {socialProfile.subscriptionStatus === 'trial' && (
                    <span className="subscription-badge trial">Pro Trial</span>
                  )}
                  {socialProfile.subscriptionStatus === 'active' && (
                    <span className="subscription-badge active">Pro</span>
                  )}
                </div>
              ) : (
                <div className="username-not-set">
                  <p>Not registered</p>
                  <button 
                    onClick={() => setShowUsernameModal(true)}
                    className="btn-register-username"
                  >
                    <FontAwesomeIcon icon={faAt} /> Register Username
                  </button>
                  <span className="info-hint">Required to post on Modulr platforms (Social, Teleop sharing, etc.)</span>
                </div>
              )}
            </div>

            {/* Row 4: Display Name */}
            <div className="info-item full-width">
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
                  <p className="display-name-hint">Friendly name shown in reviews and ratings. Can be duplicates (e.g., "John Smith").</p>
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

            {/* Row 5: Preferred Currency (Clients only) */}
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

            {/* Row 6: Modulr Network Address (Coming Soon) */}
            <div className="info-item full-width">
              <label>
                <FontAwesomeIcon icon={faGlobe} className="label-icon" />
                Modulr Network Address
              </label>
              <div className="modulr-address-section disabled">
                <input
                  type="text"
                  placeholder="Coming Soon..."
                  disabled
                  className="modulr-address-input"
                />
                <span className="info-hint">
                  Link your on-chain identity. Modulr blockchain integration coming soon.
                  Your address will be portable to the Modulr Network!
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Subscription Section - Only show if user has a username */}
        {socialProfile?.username && (
          <div className="profile-section subscription-section">
            <h2>
              <FontAwesomeIcon icon={faCrown} className="section-icon" />
              Modulr Pro Subscription
            </h2>
            
            <div className="subscription-content">
              {/* Current Status */}
              <div className="subscription-status-card">
                <div className="subscription-status-header">
                  <div className="subscription-status-left">
                    <FontAwesomeIcon 
                      icon={subscriptionInfo?.icon || faUser} 
                      className={`subscription-status-icon ${subscriptionInfo?.badgeClass}`}
                    />
                    <div>
                      <span className={`subscription-status-badge ${subscriptionInfo?.badgeClass}`}>
                        {subscriptionInfo?.label}
                      </span>
                      <p className="subscription-status-message">{subscriptionInfo?.message}</p>
                    </div>
                  </div>
                  {subscriptionInfo?.expiresAt && (
                    <div className="subscription-expires">
                      <FontAwesomeIcon icon={faCalendarAlt} />
                      <span>
                        {socialProfile.subscriptionStatus === 'trial' ? 'Trial ends' : 
                         socialProfile.subscriptionStatus === 'cancelled' ? 'Access until' : 'Renews'}
                        : {formatDate(subscriptionInfo.expiresAt)}
                      </span>
                    </div>
                  )}
                </div>

                {subscriptionInfo?.showWarning && (
                  <div className="subscription-warning">
                    <FontAwesomeIcon icon={faExclamationCircle} />
                    <span>
                      {socialProfile.subscriptionStatus === 'trial' 
                        ? 'Your trial is ending soon! Subscribe to keep Pro features.'
                        : socialProfile.subscriptionStatus === 'cancelled'
                        ? 'Your access will end soon. Resubscribe to keep Pro features.'
                        : 'Your subscription is renewing soon.'}
                    </span>
                  </div>
                )}
              </div>

              {/* OG Pricing Badge */}
              {socialProfile.isOgPricing && (
                <div className="og-pricing-banner">
                  <FontAwesomeIcon icon={faRocket} />
                  <div>
                    <strong>OG Pricing Locked In!</strong>
                    <p>As an early adopter, you've locked in special pricing forever:</p>
                    <ul>
                      <li>Monthly: {socialProfile.ogPriceMtrMonthly?.toLocaleString()} MTR/mo (${((socialProfile.ogPriceMtrMonthly || 399) / 100).toFixed(2)}/mo)</li>
                      <li>Annual: {socialProfile.ogPriceMtrAnnual?.toLocaleString()} MTR/yr (${((socialProfile.ogPriceMtrAnnual || 4000) / 100).toFixed(2)}/yr)</li>
                    </ul>
                    <span className="og-pricing-note">
                      Keep your subscription active to maintain this pricing!
                    </span>
                  </div>
                </div>
              )}

              {/* Pro Benefits */}
              <div className="subscription-benefits">
                <h4>Pro Benefits</h4>
                <div className="benefits-grid">
                  <div className="benefit-item">
                    <FontAwesomeIcon icon={faCheckCircle} />
                    <span>Unlimited posts per day</span>
                  </div>
                  <div className="benefit-item">
                    <FontAwesomeIcon icon={faCheckCircle} />
                    <span>Unlimited comments per day</span>
                  </div>
                  <div className="benefit-item">
                    <FontAwesomeIcon icon={faCheckCircle} />
                    <span>Extended post length (4,096 chars)</span>
                  </div>
                  <div className="benefit-item">
                    <FontAwesomeIcon icon={faCheckCircle} />
                    <span>Pro badge on profile</span>
                  </div>
                  <div className="benefit-item">
                    <FontAwesomeIcon icon={faCheckCircle} />
                    <span>Video uploads (coming soon)</span>
                  </div>
                  <div className="benefit-item">
                    <FontAwesomeIcon icon={faCheckCircle} />
                    <span>Share Teleop sessions</span>
                  </div>
                </div>
              </div>

              {/* Free Tier Limits */}
              {(socialProfile.subscriptionStatus === 'none' || 
                socialProfile.subscriptionStatus === 'expired' || 
                !socialProfile.subscriptionStatus) && (
                <div className="free-tier-limits">
                  <h4>Free Tier Limits</h4>
                  <ul>
                    <li>1 post per day</li>
                    <li>1 comment per day</li>
                    <li>1,024 character limit</li>
                    <li>No video uploads</li>
                  </ul>
                </div>
              )}

              {/* Action Buttons */}
              <div className="subscription-actions">
                {subscriptionInfo?.canUpgrade && (
                  <>
                    {(socialProfile.subscriptionStatus === 'none' || 
                      socialProfile.subscriptionStatus === 'expired' ||
                      socialProfile.subscriptionStatus === 'trial' ||
                      socialProfile.subscriptionStatus === 'cancelled' ||
                      !socialProfile.subscriptionStatus) && (
                      <button 
                        className="btn-subscribe"
                        onClick={() => setShowSubscriptionModal(true)}
                      >
                        <FontAwesomeIcon icon={faCrown} />
                        {socialProfile.subscriptionStatus === 'trial' 
                          ? 'Subscribe Now' 
                          : socialProfile.subscriptionStatus === 'cancelled'
                          ? 'Resubscribe'
                          : 'Upgrade to Pro'}
                      </button>
                    )}
                    {socialProfile.subscriptionStatus === 'active' && 
                     socialProfile.subscriptionPlan === 'monthly' && (
                      <button 
                        className="btn-upgrade-annual"
                        onClick={() => setShowSubscriptionModal(true)}
                      >
                        <FontAwesomeIcon icon={faRocket} />
                        Switch to Annual (Save 16%)
                      </button>
                    )}
                  </>
                )}
                {socialProfile.subscriptionStatus === 'active' && (
                  <button 
                    className="btn-manage-subscription"
                    onClick={() => setShowSubscriptionModal(true)}
                  >
                    Manage Subscription
                  </button>
                )}
              </div>

              {/* Note about billing */}
              <p className="subscription-note">
                <FontAwesomeIcon icon={faCalendarAlt} />
                {socialProfile.subscriptionStatus === 'trial' 
                  ? 'You won\'t be charged until your trial ends. Cancel anytime.'
                  : socialProfile.subscriptionStatus === 'active' && socialProfile.subscriptionPlan === 'monthly'
                  ? 'Upgrade to annual takes effect after your current month ends.'
                  : 'All subscriptions are paid using MTR credits.'}
              </p>
            </div>
          </div>
        )}

        {isPartner && partnerData && (
          <div className="profile-section">
            <div className="section-header">
              <h2>Partner Profile</h2>
              <div className="section-actions">
                {!isEditing && (
                  <button onClick={() => setIsEditing(true)} className="btn-edit">
                    <FontAwesomeIcon icon={faEdit} /> Edit Profile
                  </button>
                )}
                <button onClick={() => navigate('/partner-profile/edit')} className="btn-edit-full">
                  <FontAwesomeIcon icon={faExternalLinkAlt} /> Edit Full Profile
                </button>
              </div>
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

      {/* Username Registration Modal */}
      <UsernameRegistrationModal
        isOpen={showUsernameModal}
        onClose={() => setShowUsernameModal(false)}
        onSuccess={handleUsernameSuccess}
      />

      {/* Subscription Modal */}
      <SubscriptionModal
        isOpen={showSubscriptionModal}
        onClose={() => setShowSubscriptionModal(false)}
        onSuccess={(plan) => {
          setShowSubscriptionModal(false);
          loadProfileData();
        }}
        currentStatus={socialProfile?.subscriptionStatus || null}
        currentPlan={socialProfile?.subscriptionPlan || null}
        pendingSubscriptionPlan={socialProfile?.pendingSubscriptionPlan || null}
        pendingSubscriptionStartsAt={socialProfile?.pendingSubscriptionStartsAt || null}
        isOgPricing={socialProfile?.isOgPricing || false}
        ogPriceMonthly={socialProfile?.ogPriceMtrMonthly || null}
        ogPriceAnnual={socialProfile?.ogPriceMtrAnnual || null}
        trialEndsAt={socialProfile?.trialEndsAt || null}
      />
    </div>
  );
}