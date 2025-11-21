import { generateClient } from "aws-amplify/api";
import type { Schema } from "../../amplify/data/resource";
import { useState } from "react";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { fetchAuthSession } from "@aws-amplify/auth";
import './UserSetup.css';

import { usePageTitle } from "../hooks/usePageTitle";
import { useLocation, useNavigate } from "react-router-dom";
import { LoadingWheel } from "../components/LoadingWheel";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faGamepad, faCheckCircle } from '@fortawesome/free-solid-svg-icons';
import { formatGroupName } from "../utils/formatters";

const client = generateClient<Schema>();

interface PrivateRouteProps {}

interface PartnerDetails {
  name: string;
  description: string;
}

export function UserSetup(_props: PrivateRouteProps) {
  usePageTitle();
  const { user } = useAuthStatus();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [userGroup, setUserGroup] = useState<string>("client");
  const [settingGroup, setSettingGroup] = useState<boolean>(false);
  const [partnerDetails, setPartnerDetails] = useState<PartnerDetails>({
    name: "",
    description: "",
  });
  const [error, setError] = useState<string>("");

  const handleOptionChange = (groupType: string) => {
    setUserGroup(groupType);
    setError("");
  };

  const handlePartnerInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setPartnerDetails(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const onConfirmUserGroup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (userGroup === "partner") {
      if (!partnerDetails.name.trim()) {
        setError("Partner name is required");
        return;
      }
      if (!partnerDetails.description.trim()) {
        setError("Partner description is required");
        return;
      }
    }

    setSettingGroup(true);

    try {
      const resp = await client.mutations.setUserGroupLambda({
        group: userGroup,
      }, {
        authMode: "userPool",
      });

      if (resp.data?.statusCode !== 200) {
        setError("Failed to set user group. Please try again.");
        setSettingGroup(false);
        return;
      }

      await fetchAuthSession({ forceRefresh: true });

      if (userGroup === "partner") {
        const createPartnerResp = await client.models.Partner.create({
          cognitoUsername: user?.username,
          name: partnerDetails.name.trim(),
          description: partnerDetails.description.trim(),
        });

        if (createPartnerResp.errors) {
          setError("Failed to create partner profile. Please contact support.");
          setSettingGroup(false);
          return;
        }
      } else if (userGroup === "client") {
        const createClientResp = await client.models.Client.create({
          cognitoUsername: user?.username,
        });

        if (createClientResp.errors) {
          setError("Failed to create client profile. Please contact support.");
          setSettingGroup(false);
          return;
        }
      }

      const from = location.state?.from || "/";
      navigate(from, { replace: true });

    } catch (err) {
      console.error("Error during setup:", err);
      setError("An unexpected error occurred. Please try again.");
      setSettingGroup(false);
    }
  };

  if (user?.group) {
    return (
      <div className="setup-wrapper">
        <div className="setup-container">
          <div className="success-state">
            <FontAwesomeIcon icon={faCheckCircle} className="success-icon" />
            <h2>Account Ready!</h2>
            <p>Your account type: <strong>{formatGroupName(user.group)}</strong></p>
            <button onClick={() => navigate('/')} className="btn-primary">
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isPartner = userGroup === "partner";

  return (
    <div className="setup-wrapper">
      <div className="setup-container">
        <div className="setup-header">
          <h1>Complete Your Profile</h1>
          <p className="setup-subtitle">Choose how you want to use Modulr</p>
          <div className="setup-steps">
            <div className="step active">
              <span className="step-number">1</span>
              <span className="step-label">Choose Type</span>
            </div>
            <div className={`step ${isPartner ? 'active' : ''}`}>
              <span className="step-number">2</span>
              <span className="step-label">Details</span>
            </div>
            <div className="step">
              <span className="step-number">3</span>
              <span className="step-label">Complete</span>
            </div>
          </div>
        </div>

        <form className="setup-form" onSubmit={onConfirmUserGroup}>
          <div className="account-type-selector">
            <div 
              className={`type-card ${userGroup === 'client' ? 'selected' : ''}`}
              onClick={() => !settingGroup && handleOptionChange('client')}
            >
              <FontAwesomeIcon icon={faGamepad} className="type-icon" />
              <h3>Client Account</h3>
              <p>Control robots remotely</p>
              <ul className="type-features">
                <li>Access available robots</li>
                <li>Remote teleoperation</li>
                <li>Session history & receipts</li>
              </ul>
              {userGroup === 'client' && <div className="selection-indicator">Selected</div>}
            </div>

            <div 
              className={`type-card ${userGroup === 'partner' ? 'selected' : ''}`}
              onClick={() => !settingGroup && handleOptionChange('partner')}
            >
              <FontAwesomeIcon icon={faRobot} className="type-icon" />
              <h3>Partner Account</h3>
              <p>Offer your robots for hire</p>
              <ul className="type-features">
                <li>List your robots</li>
                <li>Earn from sessions</li>
                <li>Manage availability</li>
              </ul>
              {userGroup === 'partner' && <div className="selection-indicator">Selected</div>}
            </div>
          </div>

          {isPartner && (
            <div className="partner-details-section">
              <h3 className="section-title">Partner Information</h3>
              
              <div className="form-group">
                <label htmlFor="partnerName">Organization Name *</label>
                <input
                  id="partnerName"
                  name="name"
                  type="text"
                  value={partnerDetails.name}
                  onChange={handlePartnerInputChange}
                  placeholder="e.g., RoboTech Solutions"
                  disabled={settingGroup}
                  required
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="partnerDescription">Description *</label>
                <textarea
                  id="partnerDescription"
                  name="description"
                  value={partnerDetails.description}
                  onChange={handlePartnerInputChange}
                  placeholder="Tell clients about your robot services, expertise, and what makes you unique..."
                  disabled={settingGroup}
                  rows={4}
                  required
                  className="form-textarea"
                />
                <span className="char-count">{partnerDetails.description.length} characters</span>
              </div>
            </div>
          )}

          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}

          <div className="form-actions">
            {settingGroup ? (
              <div className="loading-wrapper">
                <LoadingWheel />
              </div>
            ) : (
              <button type="submit" className="btn-primary btn-large">
                {isPartner ? "Create Partner Account" : "Create Client Account"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}