import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/api';
import { uploadData, getUrl } from 'aws-amplify/storage';
import { Schema } from '../../amplify/data/resource';
import { LoadingWheel } from '../components/LoadingWheel';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { logger } from '../utils/logger';
import { 
  faBuilding,
  faCheckCircle,
  faExclamationCircle,
  faCloudUploadAlt,
  faTimes
} from '@fortawesome/free-solid-svg-icons';
import './CreateRobotListing.css';

const client = generateClient<Schema>();

const COMPANY_TYPES = [
  'Robot Provider',
  'AI Provider',
  'Data Service Provider',
  'Compute Provider',
];

export default function EditPartnerProfile() {
  usePageTitle();
  const navigate = useNavigate();
  const { user } = useAuthStatus();
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingPartner, setIsLoadingPartner] = useState(true);
  const [success, setSuccess] = useState<boolean | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    companyType: '',
    websiteUrl: '',
    contactEmail: '',
    integrationCode: '',
    integrationDocsUrl: '',
    isPublicProfile: true,
    twitterUrl: '',
    telegramUrl: '',
    githubUrl: '',
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [existingLogoKey, setExistingLogoKey] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadPartner = async () => {
      if (!user?.username) return;

      try {
        const result = await client.models.Partner.list({
          filter: { cognitoUsername: { eq: user.username } },
          limit: 1,
        });

        const partner = result.data?.[0];
        if (partner) {
          setPartnerId(partner.id!);
          setForm({
            name: partner.name || '',
            description: partner.description || '',
            companyType: partner.companyType || '',
            websiteUrl: partner.websiteUrl || '',
            contactEmail: partner.contactEmail || '',
            integrationCode: partner.integrationCode || '',
            integrationDocsUrl: partner.integrationDocsUrl || '',
            isPublicProfile: partner.isPublicProfile ?? true,
            twitterUrl: partner.twitterUrl || '',
            telegramUrl: partner.telegramUrl || '',
            githubUrl: partner.githubUrl || '',
          });

          if (partner.logoUrl) {
            setExistingLogoKey(partner.logoUrl);
            if (!partner.logoUrl.startsWith('http')) {
              const url = await getUrl({ path: partner.logoUrl });
              setLogoPreview(url.url.toString());
            } else {
              setLogoPreview(partner.logoUrl);
            }
          }
        }
      } catch (err) {
        logger.error('Error loading partner:', err);
        setError('Failed to load profile');
      } finally {
        setIsLoadingPartner(false);
      }
    };

    loadPartner();
  }, [user]);

  const validateField = (name: string, value: string): string => {
    if (!value) return '';
    
    const socialPatterns: Record<string, { prefix: string; hint: string }> = {
      twitterUrl: { prefix: 'https://x.com/', hint: 'https://x.com/username' },
      telegramUrl: { prefix: 'https://t.me/', hint: 'https://t.me/username' },
      githubUrl: { prefix: 'https://github.com/', hint: 'https://github.com/username' },
    };

    if (socialPatterns[name]) {
      if (value.startsWith('@')) {
        return `Use full URL: ${socialPatterns[name].hint}`;
      }
      if (!value.startsWith(socialPatterns[name].prefix)) {
        return `Must start with ${socialPatterns[name].prefix}`;
      }
    }

    if (['websiteUrl', 'integrationDocsUrl'].includes(name)) {
      if (!value.startsWith('https://') && !value.startsWith('http://')) {
        return 'Must start with https://';
      }
    }

    if (name === 'contactEmail') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return 'Enter a valid email address';
      }
    }

    return '';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    const validatedFields = ['twitterUrl', 'telegramUrl', 'githubUrl', 'websiteUrl', 'integrationDocsUrl', 'contactEmail'];
    if (validatedFields.includes(name)) {
      setFieldErrors(prev => ({ ...prev, [name]: validateField(name, value) }));
    }
  };

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Logo must be less than 2MB');
      return;
    }
    setUploadError(null);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setExistingLogoKey(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadLogo = async (): Promise<string | null> => {
    if (!logoFile) return existingLogoKey;

    const key = `partner-logos/${Date.now()}-${Math.random().toString(36).slice(2)}.${logoFile.name.split('.').pop()}`;

    try {
      await uploadData({
        path: key,
        data: logoFile,
        options: {
          bucket: 'robotImages',
          contentType: logoFile.type,
          onProgress: ({ transferredBytes, totalBytes }) => {
            if (totalBytes) setUploadProgress(Math.round((transferredBytes / totalBytes) * 100));
          },
        },
      }).result;

      return key;
    } catch (err) {
      logger.error('Logo upload failed:', err);
      setUploadError('Failed to upload logo');
      throw err;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setSuccess(undefined);
    setError(null);
    setUploadError(null);
    setUploadProgress(0);

    try {
      let logoUrl = existingLogoKey;
      if (logoFile) {
        try {
          logoUrl = await uploadLogo();
        } catch {
          setIsLoading(false);
          return;
        }
      }

      const data = {
        name: form.name,
        description: form.description,
        companyType: form.companyType || null,
        websiteUrl: form.websiteUrl || null,
        contactEmail: form.contactEmail || null,
        integrationCode: form.integrationCode || null,
        integrationDocsUrl: form.integrationDocsUrl || null,
        isPublicProfile: form.isPublicProfile,
        logoUrl: logoUrl || null,
        twitterUrl: form.twitterUrl || null,
        telegramUrl: form.telegramUrl || null,
        githubUrl: form.githubUrl || null,
      };

      if (partnerId) {
        await client.models.Partner.update({ id: partnerId, ...data });
      } else {
        const existingCheck = await client.models.Partner.list({
          filter: { cognitoUsername: { eq: user?.username || '' } },
          limit: 1,
        });
        if (existingCheck.data && existingCheck.data.length > 0) {
          setError('A company profile already exists for this account');
          setIsLoading(false);
          return;
        }
        await client.models.Partner.create({
          ...data,
          cognitoUsername: user?.username,
        });
      }

      setSuccess(true);
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      logger.error('Error saving profile:', err);
      setError('Failed to save profile');
      setSuccess(false);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoadingPartner) {
    return (
      <div className="create-listing-page">
        <LoadingWheel />
      </div>
    );
  }

  return (
    <div className="create-listing-page">
      <div className="listing-header">
        <div className="header-icon">
          <FontAwesomeIcon icon={faBuilding} />
        </div>
        <div className="header-content">
          <h1>{partnerId ? 'Edit' : 'Create'} Company Profile</h1>
          <p>
            {partnerId 
              ? 'Update your company profile and integration details'
              : 'Set up your company profile for clients to discover'}
          </p>
          {partnerId && (
            <a 
              href={`/partner/${partnerId}`} 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ 
                color: '#ffc107', 
                fontSize: '0.9rem', 
                marginTop: '0.5rem',
                display: 'inline-block'
              }}
            >
              View public profile →
            </a>
          )}
        </div>
      </div>

      <div className="listing-container">
        <form className="listing-form" onSubmit={handleSubmit}>
          <div className="form-section">
            <h3>Company Info</h3>

            <div className="form-group">
              <label>Company Name <span className="required">*</span></label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <div className="form-group">
              <label>Company Type</label>
              <select name="companyType" value={form.companyType} onChange={handleChange} disabled={isLoading}>
                <option value="">Select type...</option>
                {COMPANY_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Description <span className="required">*</span></label>
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows={4}
                required
                disabled={isLoading}
              />
            </div>

            <div className="form-group">
              <label>Logo <span className="optional">(optional)</span></label>
              {!logoPreview ? (
                <div
                  className={`upload-zone ${isDragging ? 'dragging' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                    hidden
                  />
                  <div className="upload-prompt">
                    <FontAwesomeIcon icon={faCloudUploadAlt} />
                    <span>Drop logo here or click to browse</span>
                    <small>PNG, JPG up to 2MB</small>
                  </div>
                </div>
              ) : (
                <div className="preview-container">
                  <img src={logoPreview} alt="Logo preview" />
                  <button type="button" className="remove-image" onClick={clearLogo}>
                    <FontAwesomeIcon icon={faTimes} />
                  </button>
                  {uploadProgress > 0 && uploadProgress < 100 && (
                    <div className="upload-progress">
                      <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  )}
                </div>
              )}
              {uploadError && (
                <div className="upload-error">
                  <FontAwesomeIcon icon={faExclamationCircle} />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>
          </div>

          <div className="form-section">
            <h3>Contact</h3>

            <div className={`form-group ${fieldErrors.websiteUrl ? 'has-error' : ''}`}>
              <label>Website URL</label>
              <input
                type="url"
                name="websiteUrl"
                value={form.websiteUrl}
                onChange={handleChange}
                placeholder="https://example.com"
                disabled={isLoading}
              />
              {fieldErrors.websiteUrl && (
                <span className="field-error">{fieldErrors.websiteUrl}</span>
              )}
            </div>

            <div className={`form-group ${fieldErrors.contactEmail ? 'has-error' : ''}`}>
              <label>Contact Email</label>
              <input
                type="email"
                name="contactEmail"
                value={form.contactEmail}
                onChange={handleChange}
                placeholder="contact@example.com"
                disabled={isLoading}
              />
              {fieldErrors.contactEmail && (
                <span className="field-error">{fieldErrors.contactEmail}</span>
              )}
            </div>
          </div>

          <div className="form-section">
            <h3>Social Links</h3>

            <div className={`form-group ${fieldErrors.twitterUrl ? 'has-error' : ''}`}>
              <label>Twitter / X</label>
              <input
                type="url"
                name="twitterUrl"
                value={form.twitterUrl}
                onChange={handleChange}
                placeholder="https://x.com/yourcompany"
                disabled={isLoading}
              />
              {fieldErrors.twitterUrl && (
                <span className="field-error">{fieldErrors.twitterUrl}</span>
              )}
            </div>

            <div className={`form-group ${fieldErrors.telegramUrl ? 'has-error' : ''}`}>
              <label>Telegram</label>
              <input
                type="url"
                name="telegramUrl"
                value={form.telegramUrl}
                onChange={handleChange}
                placeholder="https://t.me/yourgroup"
                disabled={isLoading}
              />
              {fieldErrors.telegramUrl && (
                <span className="field-error">{fieldErrors.telegramUrl}</span>
              )}
            </div>

            <div className={`form-group ${fieldErrors.githubUrl ? 'has-error' : ''}`}>
              <label>GitHub</label>
              <input
                type="url"
                name="githubUrl"
                value={form.githubUrl}
                onChange={handleChange}
                placeholder="https://github.com/yourcompany"
                disabled={isLoading}
              />
              {fieldErrors.githubUrl && (
                <span className="field-error">{fieldErrors.githubUrl}</span>
              )}
            </div>
          </div>

          <div className="form-section">
            <h3>Integration</h3>

            <div className="form-group">
              <label>Integration Code Snippet <span className="optional">(optional)</span></label>
              <textarea
                name="integrationCode"
                value={form.integrationCode}
                onChange={handleChange}
                rows={6}
                placeholder="npm install your-sdk&#10;&#10;import { SDK } from 'your-sdk';"
                disabled={isLoading}
                style={{ fontFamily: 'monospace' }}
              />
            </div>

            <div className={`form-group ${fieldErrors.integrationDocsUrl ? 'has-error' : ''}`}>
              <label>Documentation URL</label>
              <input
                type="url"
                name="integrationDocsUrl"
                value={form.integrationDocsUrl}
                onChange={handleChange}
                placeholder="https://docs.example.com"
                disabled={isLoading}
              />
              {fieldErrors.integrationDocsUrl && (
                <span className="field-error">{fieldErrors.integrationDocsUrl}</span>
              )}
            </div>
          </div>

          <div className="form-section">
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="isPublicProfile"
                  checked={form.isPublicProfile}
                  onChange={handleChange}
                  disabled={isLoading}
                />
                <span>Make profile publicly visible</span>
              </label>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="submit-btn cancel-btn" onClick={() => navigate('/')} disabled={isLoading}>
              Cancel
            </button>
            <button type="submit" className="submit-btn" disabled={isLoading || !form.name || !form.description || Object.values(fieldErrors).some(e => e)}>
              {isLoading ? <LoadingWheel /> : (partnerId ? 'Save Changes' : 'Create Profile')}
            </button>
          </div>
        </form>

        {success && (
          <div className="feedback-message success">
            <FontAwesomeIcon icon={faCheckCircle} />
            <div className="message-content">
              <strong>Success!</strong>
              <p>Profile saved. Redirecting...</p>
            </div>
          </div>
        )}

        {success === false && error && (
          <div className="feedback-message error">
            <FontAwesomeIcon icon={faExclamationCircle} />
            <div className="message-content">
              <strong>Error</strong>
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
