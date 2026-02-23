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
import { faRobot, faGamepad, faCheckCircle, faServer, faSatelliteDish } from '@fortawesome/free-solid-svg-icons';
import { formatGroupName } from "../utils/formatters";
import { logger } from '../utils/logger';

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

  const needsDetails = userGroup === "partner" || userGroup === "organization";

  const onConfirmUserGroup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (needsDetails) {
      if (!partnerDetails.name.trim()) {
        setError("Organization / company name is required");
        return;
      }
      if (!partnerDetails.description.trim()) {
        setError("Description is required");
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

      if (userGroup === "partner" || userGroup === "organization") {
        const allPartners = await client.models.Partner.list({ limit: 100 });
        const emailPrefix = user?.email?.split('@')[0] || '';
        const existingPartner = allPartners.data?.find(p => 
          p.cognitoUsername === user?.username ||
          p.cognitoUsername === user?.email ||
          (emailPrefix && p.cognitoUsername?.includes(emailPrefix))
        );
        
        if (existingPartner) {
          const from = location.state?.from || "/";
          navigate(from, { replace: true });
          return;
        }
        const createPartnerResp = await client.models.Partner.create({
          cognitoUsername: user?.username,
          name: partnerDetails.name.trim(),
          description: partnerDetails.description.trim(),
          isPublicProfile: false,
        });

        if (createPartnerResp.errors) {
          setError("Failed to create profile. Please contact support.");
          setSettingGroup(false);
          return;
        }
      } else if (userGroup === "client" || userGroup === "service_provider") {
        const createClientResp = await client.models.Client.create({
          cognitoUsername: user?.username,
        });

        if (createClientResp.errors) {
          setError("Failed to create profile. Please contact support.");
          setSettingGroup(false);
          return;
        }
      }

      const from = location.state?.from || "/";
      navigate(from, { replace: true });

    } catch (err) {
      logger.error("Error during setup:", err);
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

  const ACCOUNT_TYPES = [
    {
      id: 'client',
      icon: faGamepad,
      title: 'Client',
      subtitle: 'I want to teleoperate robots',
      features: ['Browse & access available robots', 'Remote teleoperation sessions', 'Session history & receipts'],
    },
    {
      id: 'partner',
      icon: faRobot,
      title: 'Partner',
      subtitle: 'I have robot(s) I want to rent out',
      features: ['List your robots on the marketplace', 'Earn credits from teleop sessions', 'Manage robot access & pricing'],
    },
    {
      id: 'service_provider',
      icon: faServer,
      title: 'Services Provider',
      subtitle: 'I have AI/data/compute services to sell',
      features: ['List AI & compute services', 'Integrate into teleop sessions', 'Service analytics & earnings'],
    },
    {
      id: 'organization',
      icon: faSatelliteDish,
      title: 'Organization',
      subtitle: 'I want to manage my robot team & fleet',
      features: ['Command HQ fleet management', 'Team roles & permissions', 'Custom ROS commands & configs'],
    },
  ];

  const selectedType = ACCOUNT_TYPES.find((t) => t.id === userGroup);
  const btnLabel = selectedType ? `Create ${selectedType.title} Account` : 'Continue';

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
            <div className={`step ${needsDetails ? 'active' : ''}`}>
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
          <div className="account-type-selector account-type-selector--4col">
            {ACCOUNT_TYPES.map((acct) => (
              <div
                key={acct.id}
                className={`type-card ${userGroup === acct.id ? 'selected' : ''}`}
                onClick={() => !settingGroup && handleOptionChange(acct.id)}
              >
                <FontAwesomeIcon icon={acct.icon} className="type-icon" />
                <h3>{acct.title}</h3>
                <p>{acct.subtitle}</p>
                <ul className="type-features">
                  {acct.features.map((f) => <li key={f}>{f}</li>)}
                </ul>
                {userGroup === acct.id && <div className="selection-indicator">Selected</div>}
              </div>
            ))}
          </div>

          {needsDetails && (
            <div className="partner-details-section">
              <h3 className="section-title">
                {userGroup === 'organization' ? 'Organization Details' : 'Company Details'}
              </h3>
              
              <div className="form-group">
                <label htmlFor="partnerName">
                  {userGroup === 'organization' ? 'Organization Name' : 'Company Name'} *
                </label>
                <input
                  id="partnerName"
                  name="name"
                  type="text"
                  value={partnerDetails.name}
                  onChange={handlePartnerInputChange}
                  placeholder={userGroup === 'organization' ? 'e.g., Modulr Robotics' : 'e.g., RoboTech Solutions'}
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
                  placeholder={
                    userGroup === 'organization'
                      ? 'Describe your organization, team size, and what robots you operate...'
                      : 'Tell clients about your robots, expertise, and what makes you unique...'
                  }
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
                {btnLabel}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}