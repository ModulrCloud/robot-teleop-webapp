import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/api';
import { getUrl } from 'aws-amplify/storage';
import { Schema } from '../../amplify/data/resource';
import { LoadingWheel } from '../components/LoadingWheel';
import { usePageTitle } from '../hooks/usePageTitle';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { logger } from '../utils/logger';
import { 
  faGlobe, 
  faEnvelope, 
  faStar,
  faShieldHalved,
  faCopy,
  faCheck,
  faArrowUpRightFromSquare,
  faRobot,
  faArrowLeft,
  faCode,
  faBook
} from '@fortawesome/free-solid-svg-icons';
import { faXTwitter, faTelegram, faGithub } from '@fortawesome/free-brands-svg-icons';
import './PartnerProfile.css';

const client = generateClient<Schema>();

interface Partner {
  id: string;
  name: string;
  description: string;
  logoUrl?: string;
  websiteUrl?: string;
  contactEmail?: string;
  companyType?: string;
  integrationCode?: string;
  integrationDocsUrl?: string;
  averageRating?: number;
  reliabilityScore?: number;
  twitterUrl?: string;
  telegramUrl?: string;
  githubUrl?: string;
}

interface RobotItem {
  id: string;
  name: string;
  model?: string;
  city?: string;
}

export default function PartnerProfile() {
  usePageTitle();
  const { partnerId } = useParams();
  const navigate = useNavigate();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [robots, setRobots] = useState<RobotItem[]>([]);

  useEffect(() => {
    const loadPartner = async () => {
      if (!partnerId) {
        setError('No partner ID provided');
        setIsLoading(false);
        return;
      }

      try {
        const result = await client.models.Partner.get({ id: partnerId });
        if (!result.data) {
          setError('Partner not found');
          setIsLoading(false);
          return;
        }

        const data = result.data;
        setPartner({
          id: data.id!,
          name: data.name,
          description: data.description,
          logoUrl: data.logoUrl || undefined,
          websiteUrl: data.websiteUrl || undefined,
          contactEmail: data.contactEmail || undefined,
          companyType: data.companyType || undefined,
          integrationCode: data.integrationCode || undefined,
          integrationDocsUrl: data.integrationDocsUrl || undefined,
          averageRating: data.averageRating || undefined,
          reliabilityScore: data.reliabilityScore || undefined,
          twitterUrl: data.twitterUrl || undefined,
          telegramUrl: data.telegramUrl || undefined,
          githubUrl: data.githubUrl || undefined,
        });

        if (data.logoUrl && !data.logoUrl.startsWith('http')) {
          try {
            const url = await getUrl({ path: data.logoUrl });
            setLogoPreview(url.url.toString());
          } catch {
            setLogoPreview(null);
          }
        } else if (data.logoUrl) {
          setLogoPreview(data.logoUrl);
        }

        const robotsData = await data.robots();
        setRobots((robotsData.data || []).map(r => ({
          id: r.id!,
          name: r.name,
          model: r.model || undefined,
          city: r.city || undefined,
        })));
      } catch (err) {
        logger.error('Error loading partner:', err);
        setError('Failed to load partner profile');
      } finally {
        setIsLoading(false);
      }
    };

    loadPartner();
  }, [partnerId]);

  const copyCode = () => {
    if (partner?.integrationCode) {
      navigator.clipboard.writeText(partner.integrationCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="partner-profile-page">
        <LoadingWheel />
      </div>
    );
  }

  if (error || !partner) {
    return (
      <div className="partner-profile-page">
        <div className="error-state">
          <p>{error || 'Partner not found'}</p>
          <button onClick={() => navigate('/services')}>Back to Providers</button>
        </div>
      </div>
    );
  }

  return (
    <div className="partner-profile-page">
      <button className="back-btn" onClick={() => navigate('/services')}>
        <FontAwesomeIcon icon={faArrowLeft} />
        All Providers
      </button>

      <div className="profile-hero">
        <div className="hero-logo">
          <img 
            src={logoPreview || '/logo-thumb.png'} 
            alt={partner.name}
            onError={(e) => { e.currentTarget.src = '/logo-thumb.png'; }}
          />
        </div>
        <div className="hero-content">
          <div className="hero-top">
            {partner.companyType && <span className="company-badge">{partner.companyType}</span>}
          </div>
          <h1>{partner.name}</h1>
          <div className="hero-stats">
            {partner.averageRating && (
              <div className="stat-pill">
                <FontAwesomeIcon icon={faStar} />
                <span>{partner.averageRating.toFixed(1)} Rating</span>
              </div>
            )}
            {partner.reliabilityScore && (
              <div className="stat-pill">
                <FontAwesomeIcon icon={faShieldHalved} />
                <span>{Math.round(partner.reliabilityScore * 100)}% Reliable</span>
              </div>
            )}
            <div className="stat-pill">
              <FontAwesomeIcon icon={faRobot} />
              <span>{robots.length} Robots</span>
            </div>
          </div>
          <div className="hero-actions">
            {partner.websiteUrl && (
              <a href={partner.websiteUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                <FontAwesomeIcon icon={faGlobe} />
                Visit Website
              </a>
            )}
            {partner.contactEmail && (
              <a href={`mailto:${partner.contactEmail}`} className="btn-outline">
                <FontAwesomeIcon icon={faEnvelope} />
                Contact
              </a>
            )}
          </div>
          {(partner.twitterUrl || partner.telegramUrl || partner.githubUrl) && (
            <div className="hero-socials">
              {partner.twitterUrl && (
                <a href={partner.twitterUrl} target="_blank" rel="noopener noreferrer" className="social-link">
                  <FontAwesomeIcon icon={faXTwitter} />
                </a>
              )}
              {partner.telegramUrl && (
                <a href={partner.telegramUrl} target="_blank" rel="noopener noreferrer" className="social-link">
                  <FontAwesomeIcon icon={faTelegram} />
                </a>
              )}
              {partner.githubUrl && (
                <a href={partner.githubUrl} target="_blank" rel="noopener noreferrer" className="social-link">
                  <FontAwesomeIcon icon={faGithub} />
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="profile-body">
        <div className="profile-main">
          <section className="content-section">
            <h2>About</h2>
            <p className="about-text">{partner.description}</p>
          </section>

          {partner.integrationCode && (
            <section className="content-section">
              <div className="section-header">
                <h2>
                  <FontAwesomeIcon icon={faCode} />
                  Integration
                </h2>
                {partner.integrationDocsUrl && (
                  <a href={partner.integrationDocsUrl} target="_blank" rel="noopener noreferrer" className="docs-link">
                    <FontAwesomeIcon icon={faBook} />
                    Documentation
                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                  </a>
                )}
              </div>
              <div className="code-container">
                <div className="code-header">
                  <span>Quick Start</span>
                  <button className="copy-button" onClick={copyCode}>
                    <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="code-content">{partner.integrationCode}</pre>
              </div>
            </section>
          )}
        </div>

        {robots.length > 0 && (
          <aside className="profile-sidebar">
            <h3>Available Robots</h3>
            <div className="robots-list">
              {robots.slice(0, 5).map(robot => (
                <div key={robot.id} className="robot-item">
                  <div className="robot-icon">
                    <FontAwesomeIcon icon={faRobot} />
                  </div>
                  <div className="robot-info">
                    <span className="robot-name">{robot.name}</span>
                    {robot.city && <span className="robot-location">{robot.city}</span>}
                  </div>
                </div>
              ))}
              {robots.length > 5 && (
                <p className="more-robots">+{robots.length - 5} more robots</p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
