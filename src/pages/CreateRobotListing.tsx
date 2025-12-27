import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './CreateRobotListing.css';
import { generateClient } from 'aws-amplify/api';
import { uploadData } from 'aws-amplify/storage';
import { Schema } from '../../amplify/data/resource';
import { LoadingWheel } from '../components/LoadingWheel';
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { getCurrencyInfo, creditsToCurrencySync, currencyToCreditsSync, fetchExchangeRates, type CurrencyCode } from '../utils/credits';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { logger } from '../utils/logger';
import { 
  faRobot, 
  faCheckCircle, 
  faExclamationCircle,
  faInfoCircle,
  faTruck,
  faPersonWalking,
  faPlane,
  faWater,
  faCloudUploadAlt,
  faTimes
} from '@fortawesome/free-solid-svg-icons';

const ROBOT_MODELS = [
  { value: "rover", label: "Rover", icon: faTruck },
  { value: "humanoid", label: "Humanoid", icon: faPersonWalking },
  { value: "drone", label: "Drone", icon: faPlane },
  { value: "submarine", label: "Submarine", icon: faWater },
];

type RobotListing = {
  robotName: string;
  description: string;
  model: string;
  hourlyRateCredits: number;
  enableAccessControl: boolean;
  allowedUserEmails: string; // Comma-separated or newline-separated emails
  city: string;
  state: string;
  country: string;
  latitude: string;
  longitude: string;
};

const client = generateClient<Schema>();

export const CreateRobotListing = () => {
  usePageTitle();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState<boolean | undefined>();
  const [hourlyRateError, setHourlyRateError] = useState<string | null>(null);

  const [robotListing, setRobotListing] = useState<RobotListing>({
    robotName: "",
    description: "",
    model: ROBOT_MODELS[0].value,
    hourlyRateCredits: 100, // Default 100 credits/hour (stored internally)
    enableAccessControl: false,
    allowedUserEmails: "",
    city: "",
    state: "",
    country: "",
    latitude: "",
    longitude: "",
  });
  
  // Raw input value as string to allow free typing
  const [hourlyRateInput, setHourlyRateInput] = useState<string>('1.00');

  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuthStatus();
  const [currencyDisplay, setCurrencyDisplay] = useState<string>('USD');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('USD');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | undefined>();

  // Fetch exchange rates on mount
  useEffect(() => {
    fetchExchangeRates().then(rates => {
      setExchangeRates(rates);
    }).catch(err => {
      console.warn('Failed to fetch exchange rates:', err);
    });
  }, []);

  // Load user's preferred currency for display
  // Check Partner record first (for partners), then Client record (for clients)
  useEffect(() => {
    const loadCurrency = async () => {
      if (!user?.username) {
        setCurrencyDisplay('USD');
        setCurrencyCode('USD');
        // Convert default credits to USD for display
        const usdValue = creditsToCurrencySync(robotListing.hourlyRateCredits, 'USD', exchangeRates);
        setHourlyRateInput(usdValue.toFixed(2));
        return;
      }

      try {
        // Check Partner record first (if user is a partner)
        const { data: partners } = await client.models.Partner.list({
          filter: { cognitoUsername: { eq: user.username } },
        });

        let preferredCurrency: CurrencyCode = 'USD';
        
        if (partners && partners.length > 0) {
          // User is a partner - use Partner record's currency preference
          preferredCurrency = (partners[0]?.preferredCurrency || "USD").toUpperCase() as CurrencyCode;
        } else {
          // User is a client - check Client record
          const { data: clients } = await client.models.Client.list({
            filter: { cognitoUsername: { eq: user.username } },
          });
          const clientRecord = clients?.[0];
          preferredCurrency = (clientRecord?.preferredCurrency || "USD").toUpperCase() as CurrencyCode;
        }
        
        setCurrencyCode(preferredCurrency);
        
        const currencyInfo = getCurrencyInfo(preferredCurrency);
        // Show currency code (USD, EUR, etc.) or "?" if currency info is invalid
        setCurrencyDisplay(currencyInfo.symbol === '?' ? '?' : preferredCurrency);
        
        // Convert current credits value to new currency for display
        const currencyValue = creditsToCurrencySync(robotListing.hourlyRateCredits, preferredCurrency, exchangeRates);
        setHourlyRateInput(currencyValue.toFixed(2));
      } catch (err) {
        logger.error("Error loading currency preference:", err);
        // Fallback to USD on error
        setCurrencyDisplay('USD');
        setCurrencyCode('USD');
        const usdValue = creditsToCurrencySync(robotListing.hourlyRateCredits, 'USD', exchangeRates);
        setHourlyRateInput(usdValue.toFixed(2));
      }
    };

    loadCurrency();
  }, [user?.username, exchangeRates]);

  // Only set initial value once when currency is loaded - don't update constantly
  // This allows the user to type freely without interference

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = event.target;
    const checked = (event.target as HTMLInputElement).checked;
    
    // Handle hourly rate input - just let user type freely, no validation while typing
    if (type === 'number' && name === 'hourlyRateCredits') {
      // Clear any previous error
      setHourlyRateError(null);
      // Allow free typing - store as string
      setHourlyRateInput(value);
    } else {
      setRobotListing(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value,
      }));
    }
  };

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image must be less than 5MB');
      return;
    }
    setUploadError(null);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadImage = async (): Promise<string | null> => {
    if (!imageFile) return null;

    const key = `robot-images/${Date.now()}-${Math.random().toString(36).slice(2)}.${imageFile.name.split('.').pop()}`;

    try {
      await uploadData({
        path: key,
        data: imageFile,
        options: {
          contentType: imageFile.type,
          onProgress: ({ transferredBytes, totalBytes }) => {
            if (totalBytes) setUploadProgress(Math.round((transferredBytes / totalBytes) * 100));
          },
        },
      }).result;

      return key;
    } catch (error) {
      logger.error('Upload failed:', error);
      throw error;
    }
  };

  const onConfirmCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setSuccess(undefined);
    setUploadError(null);
    setUploadProgress(0);
    setHourlyRateError(null);

    // Validate hourly rate before proceeding
    const hourlyRateValue = parseFloat(hourlyRateInput);
    if (isNaN(hourlyRateValue) || hourlyRateValue < 0) {
      setHourlyRateError('Enter a valid number');
      setIsLoading(false);
      return;
    }

    // Convert currency value to credits for storage
    const creditsValue = currencyToCreditsSync(hourlyRateValue, currencyCode, exchangeRates);
    if (isNaN(creditsValue) || creditsValue < 0) {
      setHourlyRateError('Enter a valid number');
      setIsLoading(false);
      return;
    }

    let imageUrl: string | null = null;

    if (imageFile) {
      try {
        const key = await uploadImage();
        imageUrl = key;
      } catch {
        setUploadError('Failed to upload image. Please try again.');
        setIsLoading(false);
        return;
      }
    }

    const emailList = robotListing.enableAccessControl && robotListing.allowedUserEmails
      ? robotListing.allowedUserEmails
          .split(/[,\n]/)
          .map(email => email.trim())
          .filter(email => email.length > 0 && email.includes('@'))
      : [];

    const robotData = {
      robotName: robotListing.robotName,
      description: robotListing.description,
      model: robotListing.model,
      hourlyRateCredits: creditsValue, // Use the validated and converted value
      enableAccessControl: robotListing.enableAccessControl,
      additionalAllowedUsers: emailList,
      imageUrl: imageUrl || undefined,
      city: robotListing.city || undefined,
      state: robotListing.state || undefined,
      country: robotListing.country || undefined,
      latitude: robotListing.latitude ? (isNaN(parseFloat(robotListing.latitude)) ? undefined : parseFloat(robotListing.latitude)) : undefined,
      longitude: robotListing.longitude ? (isNaN(parseFloat(robotListing.longitude)) ? undefined : parseFloat(robotListing.longitude)) : undefined,
    };

    try {
      const robot = await client.mutations.setRobotLambda(robotData);

      if (robot.errors) {
        setSuccess(false);
      } else {
        try {
          const robotData = JSON.parse(robot.data || '{}');
          const robotUuid = robotData.id;
          if (robotUuid) {
            navigate(`/robot-setup?robotId=${robotUuid}`);
          } else {
            setSuccess(true);
            resetForm();
          }
        } catch {
          setSuccess(true);
          resetForm();
        }
      }
    } catch (error) {
      logger.error('Create robot failed:', error);
      setSuccess(false);
    }

    setIsLoading(false);
  };

  const resetForm = () => {
    setRobotListing({
      robotName: "",
      description: "",
      model: ROBOT_MODELS[0].value,
      hourlyRateCredits: 100,
      enableAccessControl: false,
      allowedUserEmails: "",
      city: "",
      state: "",
      country: "",
      latitude: "",
      longitude: "",
    });
    clearImage();
  };

  return (
    <div className="create-listing-page">
      <div className="listing-header">
        <div className="header-icon">
          <FontAwesomeIcon icon={faRobot} />
        </div>
        <div className="header-content">
          <h1>List a Robot</h1>
          <p>Make your robot available for remote teleoperation by clients worldwide</p>
        </div>
      </div>

      <div className="listing-container">
        <div className="info-banner">
          <FontAwesomeIcon icon={faInfoCircle} />
          <span>Listed robots will be visible to all verified clients on the platform</span>
        </div>

        <form className="listing-form" onSubmit={onConfirmCreate}>
          <div className="form-section">
            <h3>Robot Details</h3>
            
            <div className="form-group">
              <label htmlFor="robot-name">
                Robot Name <span className="required">*</span>
              </label>
              <input 
                id="robot-name" 
                type="text" 
                name="robotName"
                value={robotListing.robotName}
                onChange={handleInputChange}
                placeholder="Enter a unique name for your robot"
                required
                disabled={isLoading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="robot-model">
                Robot Type <span className="required">*</span>
              </label>
              <div className="model-selector">
                {ROBOT_MODELS.map(model => (
                  <label 
                    key={model.value}
                    className={`model-option ${robotListing.model === model.value ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={model.value}
                      checked={robotListing.model === model.value}
                      onChange={handleInputChange}
                      disabled={isLoading}
                    />
                    <div className="model-card">
                      <div className="model-icon">
                        <FontAwesomeIcon icon={model.icon} />
                      </div>
                      <span className="model-label">{model.label}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="robot-description">
                Description <span className="optional">(optional)</span>
              </label>
              <textarea 
                id="robot-description"
                name="description"
                value={robotListing.description}
                onChange={handleInputChange}
                placeholder="Describe your robot's capabilities, specifications, and use cases..."
                rows={5}
                maxLength={280}
                disabled={isLoading}
              />
              <div className={`char-count ${robotListing.description.length >= 280 ? 'char-count-limit' : ''}`}>
                {robotListing.description.length}/280 characters
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="hourly-rate">
                Hourly Rate ({currencyDisplay}) <span className="required">*</span>
              </label>
              <input 
                id="hourly-rate" 
                type="number" 
                name="hourlyRateCredits"
                value={hourlyRateInput}
                onChange={handleInputChange}
                placeholder="1.00"
                min="0"
                step="0.01"
                required
                disabled={isLoading}
                className={hourlyRateError ? 'error' : ''}
              />
              {hourlyRateError && (
                <div className="form-error" style={{ color: '#f44336', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                  {hourlyRateError}
                </div>
              )}
              <small className="form-help-text">
                Set the hourly rate in your preferred currency that clients will pay to use this robot. 
                The platform will add a markup on top of this rate.
              </small>
            </div>

            {/* Image Upload Section */}
            <div className="form-group">
              <label>
                Robot Image <span className="optional">(optional)</span>
              </label>
              
              {!imagePreview ? (
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
                    onChange={handleFileInput}
                    hidden
                  />
                  <div className="upload-prompt">
                    <FontAwesomeIcon icon={faCloudUploadAlt} />
                    <span>Drop an image here or click to browse</span>
                    <small>PNG, JPG up to 5MB</small>
                  </div>
                </div>
              ) : (
                <div className="preview-container">
                  <img src={imagePreview} alt="Preview" />
                  <button type="button" className="remove-image" onClick={clearImage}>
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
            <h3>Access Control</h3>
            
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="enableAccessControl"
                  checked={robotListing.enableAccessControl}
                  onChange={handleInputChange}
                  disabled={isLoading}
                />
                <span>Restrict access to specific users</span>
              </label>
              <p className="form-help-text">
                {robotListing.enableAccessControl 
                  ? "Access will be restricted to you, chris@modulr.cloud, mike@modulr.cloud, and any users you add below. You can manage the access list after creating the robot."
                  : "Robot will be accessible to all authenticated users. You can enable access control later if needed."}
              </p>
            </div>

            {robotListing.enableAccessControl && (
              <div className="form-group">
                <label htmlFor="allowed-user-emails">
                  Additional Allowed Users <span className="optional">(optional)</span>
                </label>
                <textarea 
                  id="allowed-user-emails"
                  name="allowedUserEmails"
                  value={robotListing.allowedUserEmails}
                  onChange={handleInputChange}
                  placeholder="Enter email addresses, one per line or separated by commas&#10;Example:&#10;alice@example.com&#10;bob@example.com"
                  rows={4}
                  disabled={isLoading}
                />
                <p className="form-help-text">
                  Enter email addresses of users who should have access to this robot. 
                  You (the owner), chris@modulr.cloud, and mike@modulr.cloud are automatically included.
                </p>
              </div>
            )}
          </div>

          <div className="form-section">
            <h3>Location <span className="optional">(optional)</span></h3>
            <p className="form-help-text">
              Location information helps clients find robots in their area. All fields are optional.
            </p>
            
            <div className="form-group">
              <label htmlFor="robot-city">City</label>
              <input 
                id="robot-city" 
                type="text" 
                name="city"
                value={robotListing.city}
                onChange={handleInputChange}
                placeholder="e.g., San Francisco"
                disabled={isLoading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="robot-state">State / Province</label>
              <input 
                id="robot-state" 
                type="text" 
                name="state"
                value={robotListing.state}
                onChange={handleInputChange}
                placeholder="e.g., California"
                disabled={isLoading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="robot-country">Country</label>
              <input 
                id="robot-country" 
                type="text" 
                name="country"
                value={robotListing.country}
                onChange={handleInputChange}
                placeholder="e.g., United States"
                disabled={isLoading}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="robot-latitude">Latitude</label>
                <input 
                  id="robot-latitude" 
                  type="text" 
                  name="latitude"
                  value={robotListing.latitude}
                  onChange={handleInputChange}
                  placeholder="e.g., 37.7749"
                  disabled={isLoading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="robot-longitude">Longitude</label>
                <input 
                  id="robot-longitude" 
                  type="text" 
                  name="longitude"
                  value={robotListing.longitude}
                  onChange={handleInputChange}
                  placeholder="e.g., -122.4194"
                  disabled={isLoading}
                />
              </div>
            </div>
            <p className="form-help-text">
              Latitude and longitude are optional but useful for distance-based searches. 
              You can find coordinates using <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">Google Maps</a>.
            </p>
          </div>

          <div className="form-actions">
            <button 
              type="submit" 
              className="submit-btn"
              disabled={isLoading || !robotListing.robotName.trim()}
            >
              {isLoading ? (
                <>
                  <LoadingWheel />
                  <span>Creating Listing...</span>
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faRobot} />
                  <span>Create Robot Listing</span>
                </>
              )}
            </button>
          </div>
        </form>

        {success === true && (
          <div className="feedback-message success">
            <FontAwesomeIcon icon={faCheckCircle} />
            <div className="message-content">
              <strong>Success!</strong>
              <p>Your robot listing has been created and is now available to clients.</p>
            </div>
          </div>
        )}

        {success === false && (
          <div className="feedback-message error">
            <FontAwesomeIcon icon={faExclamationCircle} />
            <div className="message-content">
              <strong>Error</strong>
              <p>Something went wrong. Please check your connection and try again.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};