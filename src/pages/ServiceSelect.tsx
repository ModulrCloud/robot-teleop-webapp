import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { generateClient } from 'aws-amplify/api';
import { getUrl } from 'aws-amplify/storage';
import { Schema } from '../../amplify/data/resource';
import { usePageTitle } from "../hooks/usePageTitle";
import { LoadingWheel } from "../components/LoadingWheel";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { logger } from '../utils/logger';
import { 
  faSearch, 
  faStar, 
  faRobot,
  faArrowRight,
  faFilter
} from '@fortawesome/free-solid-svg-icons';
import "./ServiceSelect.css";

const client = generateClient<Schema>();

const COMPANY_TYPES = ['All', 'Robot Provider', 'AI Provider', 'Data Service Provider', 'Compute Provider'];

interface PartnerData {
  id: string;
  name: string;
  description: string;
  companyType?: string;
  logoUrl?: string;
  averageRating?: number;
  robotCount: number;
}

export default function ServiceSelect() {
  usePageTitle();
  const navigate = useNavigate();
  const [partners, setPartners] = useState<PartnerData[]>([]);
  const [filteredPartners, setFilteredPartners] = useState<PartnerData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('All');
  const [resolvedLogos, setResolvedLogos] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadPartners = async () => {
      try {
        const result = await client.models.Partner.list({
          filter: { isPublicProfile: { eq: true } },
        });

        const partnerData: PartnerData[] = [];
        for (const p of result.data || []) {
          const robots = await p.robots();
          partnerData.push({
            id: p.id!,
            name: p.name,
            description: p.description,
            companyType: p.companyType || undefined,
            logoUrl: p.logoUrl || undefined,
            averageRating: p.averageRating || undefined,
            robotCount: robots.data?.length || 0,
          });
        }

        setPartners(partnerData);
        setFilteredPartners(partnerData);
      } catch (err) {
        logger.error('Error loading partners:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadPartners();
  }, []);

  useEffect(() => {
    const resolveLogo = async () => {
      const logos: Record<string, string> = {};
      for (const p of partners) {
        if (p.logoUrl && !p.logoUrl.startsWith('http') && !p.logoUrl.startsWith('/')) {
          try {
            const url = await getUrl({ path: p.logoUrl });
            logos[p.id] = url.url.toString();
          } catch {
            logos[p.id] = '';
          }
        } else if (p.logoUrl) {
          logos[p.id] = p.logoUrl;
        }
      }
      setResolvedLogos(logos);
    };

    if (partners.length > 0) resolveLogo();
  }, [partners]);

  useEffect(() => {
    let result = partners;

    if (selectedType !== 'All') {
      result = result.filter(p => p.companyType === selectedType);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(p => 
        p.name.toLowerCase().includes(term) || 
        p.description.toLowerCase().includes(term)
      );
    }

    setFilteredPartners(result);
  }, [searchTerm, selectedType, partners]);

  if (isLoading) {
    return (
      <div className="partners-directory">
        <LoadingWheel />
      </div>
    );
  }

  return (
    <div className="partners-directory">
      <div className="directory-header">
        <h1>Service Providers</h1>
        <p>Discover integration partners and service providers for your robotics projects</p>
      </div>

      <div className="directory-controls">
        <div className="search-box">
          <FontAwesomeIcon icon={faSearch} />
          <input
            type="text"
            placeholder="Search providers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-tabs">
          <FontAwesomeIcon icon={faFilter} className="filter-icon" />
          {COMPANY_TYPES.map(type => (
            <button
              key={type}
              className={`filter-tab ${selectedType === type ? 'active' : ''}`}
              onClick={() => setSelectedType(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {filteredPartners.length === 0 ? (
        <div className="empty-state">
          <p>No service providers found.</p>
        </div>
      ) : (
        <div className="partners-grid">
          {filteredPartners.map(partner => (
            <div
              key={partner.id}
              className="partner-card"
              onClick={() => navigate(`/partner/${partner.id}`)}
            >
              <div className="card-logo">
                <img 
                  src={resolvedLogos[partner.id] || '/logo-thumb.png'} 
                  alt={partner.name}
                  onError={(e) => { e.currentTarget.src = '/logo-thumb.png'; }}
                />
              </div>

              <div className="card-content">
                <h3>{partner.name}</h3>
                {partner.companyType && (
                  <span className="card-type">{partner.companyType}</span>
                )}
                <p className="card-description">
                  {partner.description.length > 100 
                    ? partner.description.slice(0, 100) + '...' 
                    : partner.description}
                </p>

                <div className="card-meta">
                  {partner.averageRating && (
                    <span className="meta-item">
                      <FontAwesomeIcon icon={faStar} />
                      {partner.averageRating.toFixed(1)}
                    </span>
                  )}
                  <span className="meta-item">
                    <FontAwesomeIcon icon={faRobot} />
                    {partner.robotCount} robots
                  </span>
                </div>
              </div>

              <div className="card-arrow">
                <FontAwesomeIcon icon={faArrowRight} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
