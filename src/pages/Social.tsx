import { useState } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUsers,
  faCompass,
  faStar,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";
import "./Social.css";

export const Social = () => {
  usePageTitle();
  const [activeTab, setActiveTab] = useState<'discovery' | 'curated'>('discovery');

  return (
    <div className="social-page">
      <div className="social-header">
        <div className="social-title-section">
          <FontAwesomeIcon icon={faUsers} className="social-icon" />
          <h1>Modulr.Social</h1>
        </div>
        <p className="social-description">
          Connect with the robotics community. Share ideas, discover projects, and stay updated with the latest in robotics development.
        </p>
      </div>

      <div className="social-tabs">
        <button
          className={`social-tab ${activeTab === 'discovery' ? 'active' : ''}`}
          onClick={() => setActiveTab('discovery')}
        >
          <FontAwesomeIcon icon={faCompass} />
          <span>Discovery</span>
        </button>
        <button
          className={`social-tab ${activeTab === 'curated' ? 'active' : ''}`}
          onClick={() => setActiveTab('curated')}
        >
          <FontAwesomeIcon icon={faStar} />
          <span>Curated</span>
        </button>
      </div>

      <div className="social-content">
        {activeTab === 'discovery' ? (
          <div className="social-feed discovery-feed">
            <div className="placeholder-content">
              <FontAwesomeIcon icon={faCompass} className="placeholder-icon" />
              <h2>Discovery Feed</h2>
              <p>
                This will be a raw feed showing all community content in chronological order.
                Perfect for discovering new projects, discussions, and updates from the robotics community.
              </p>
              <div className="placeholder-info">
                <FontAwesomeIcon icon={faInfoCircle} />
                <span>Coming soon - Feed algorithm in development</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="social-feed curated-feed">
            <div className="placeholder-content">
              <FontAwesomeIcon icon={faStar} className="placeholder-icon" />
              <h2>Curated Feed</h2>
              <p>
                This will be a personalized feed tuned to your interests, activity, and preferences.
                Content will be algorithmically selected to show you the most relevant robotics content.
              </p>
              <div className="placeholder-info">
                <FontAwesomeIcon icon={faInfoCircle} />
                <span>Coming soon - Personalization algorithm in development</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

