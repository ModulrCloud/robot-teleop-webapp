import { useState } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { formatGroupName, capitalizeName } from "../utils/formatters";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCog,
  faBell,
  faShieldAlt,
  faUser,
  faPalette,
  faKey,
  faCheck,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";
import "./Settings.css";

type SettingSection =
  | "account"
  | "notifications"
  | "privacy"
  | "appearance"
  | "admin";

export const Settings = () => {
  usePageTitle();
  const { user } = useAuthStatus();

  const [activeSection, setActiveSection] = useState<SettingSection>("account");

  const [settings, setSettings] = useState({
    emailNotifications: true,
    sessionAlerts: true,
    darkMode: true,
    currency: "USD",
    language: "en",
  });

  const handleCurrencyChange = (currency: string) => {
    setSettings((prev) => ({ ...prev, currency }));
  };

  const handleLanguageChange = (language: string) => {
    setSettings((prev) => ({ ...prev, language }));
  };

  const isAdmin = user?.group === "ADMINS";

  const handleToggle = (key: keyof typeof settings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const sections = [
    { id: "account" as SettingSection, label: "Account", icon: faUser },
    {
      id: "notifications" as SettingSection,
      label: "Notifications",
      icon: faBell,
    },
    {
      id: "privacy" as SettingSection,
      label: "Privacy & Security",
      icon: faShieldAlt,
    },
    {
      id: "appearance" as SettingSection,
      label: "Appearance",
      icon: faPalette,
    },
    ...(isAdmin
      ? [{ id: "admin" as SettingSection, label: "Admin Controls", icon: faKey }]
      : []),
  ];

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div className="header-icon">
          <FontAwesomeIcon icon={faCog} />
        </div>
        <div className="header-content">
          <h1>Settings</h1>
          <p>Manage your account preferences and application settings</p>
        </div>
      </div>

      <div className="settings-container">
        <div className="settings-sidebar">
          {sections.map((section) => (
            <button
              key={section.id}
              className={`settings-nav-item ${
                activeSection === section.id ? "active" : ""
              }`}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              <FontAwesomeIcon icon={section.icon} />
              <span>{section.label}</span>
            </button>
          ))}
        </div>

        <div className="settings-content">
          {activeSection === "account" && (
            <div className="settings-section">
              <h2>Account Information</h2>
              <p className="section-description">
                Your account details and preferences
              </p>

              <div className="settings-group">
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Email Address</label>
                    <span className="setting-value">{user?.email}</span>
                  </div>
                </div>
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Account Type</label>
                    <span className="setting-value">
                      <span className="account-badge">
                        {formatGroupName(user?.group)}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Username</label>
                    <span className="setting-value">{capitalizeName(user?.username)}</span>
                  </div>
                </div>
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Preferred Currency</label>
                    <span className="setting-description">
                      Show prices in your local currency
                    </span>
                  </div>
                  <select
                    className="setting-select"
                    value={settings.currency}
                    onChange={(e) => handleCurrencyChange(e.target.value)}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="JPY">JPY (¥)</option>
                  </select>
                </div>
              </div>

              <div className="info-banner">
                <FontAwesomeIcon icon={faInfoCircle} />
                <span>
                  To update your email or account type, please contact support
                </span>
              </div>
            </div>
          )}

          {activeSection === "notifications" && (
            <div className="settings-section">
              <h2>Notification Preferences</h2>
              <p className="section-description">
                Choose what notifications you want to receive
              </p>

              <div className="settings-group">
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Email Notifications</label>
                    <span className="setting-description">
                      Receive updates about your sessions via email
                    </span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.emailNotifications}
                      onChange={() => handleToggle("emailNotifications")}
                      disabled
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Session Alerts</label>
                    <span className="setting-description">
                      Get notified when teleoperation sessions start or end
                    </span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.sessionAlerts}
                      onChange={() => handleToggle("sessionAlerts")}
                      disabled
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeSection === "privacy" && (
            <div className="settings-section">
              <h2>Privacy &amp; Security</h2>
              <p className="section-description">
                Control your privacy and security settings
              </p>

              <div className="settings-group">
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Two-Factor Authentication</label>
                    <span className="setting-description">
                      Add an extra layer of security to your account
                    </span>
                  </div>
                  <button className="action-btn secondary" disabled type="button">
                    Coming Soon
                  </button>
                </div>
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Session History</label>
                    <span className="setting-description">
                      Your teleoperation sessions are stored for 90 days
                    </span>
                  </div>
                  <span className="status-badge">
                    <FontAwesomeIcon icon={faCheck} /> Active
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeSection === "appearance" && (
            <div className="settings-section">
              <h2>Appearance</h2>
              <p className="section-description">
                Customize how the app looks
              </p>

              <div className="settings-group">
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Dark Mode</label>
                    <span className="setting-description">
                      Use dark theme across the application
                    </span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.darkMode}
                      onChange={() => handleToggle("darkMode")}
                      disabled
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Language</label>
                    <span className="setting-description">
                      Choose your preferred language
                    </span>
                  </div>
                  <select
                    className="setting-select"
                    value={settings.language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                  </select>
                </div>
              </div>

              <div className="info-banner">
                <FontAwesomeIcon icon={faInfoCircle} />
                <span>More customization options coming soon</span>
              </div>
            </div>
          )}

          {activeSection === "admin" && isAdmin && (
            <div className="settings-section">
              <h2>Admin Controls</h2>
              <p className="section-description">
                Advanced settings for administrators
              </p>

              <div className="admin-placeholder">
                <FontAwesomeIcon icon={faKey} className="admin-icon" />
                <h3>Admin Dashboard</h3>
                <p>
                  Advanced administrative controls will be available here in a
                  future update.
                </p>
                <div className="admin-features">
                  <div className="feature-item">
                    <FontAwesomeIcon icon={faCheck} />
                    <span>User Management</span>
                  </div>
                  <div className="feature-item">
                    <FontAwesomeIcon icon={faCheck} />
                    <span>System Monitoring</span>
                  </div>
                  <div className="feature-item">
                    <FontAwesomeIcon icon={faCheck} />
                    <span>Analytics &amp; Reports</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
