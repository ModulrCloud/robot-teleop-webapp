import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './CreateRobotListing.css';
import { generateClient } from 'aws-amplify/api';
import { uploadData, getUrl } from 'aws-amplify/storage';
import { Schema } from '../../amplify/data/resource';
import { LoadingWheel } from '../components/LoadingWheel';
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { getCurrencyInfo, creditsToCurrencySync, currencyToCreditsSync, fetchExchangeRates, type CurrencyCode } from '../utils/credits';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { logger } from '../utils/logger';
import { RobotAvailabilityManager } from '../components/RobotAvailabilityManager';
import { 
  faRobot, 
  faCheckCircle, 
  faExclamationCircle,
  faInfoCircle,
  faTrash,
  faCircle,
  faCloudUploadAlt,
  faTimes,
  faLock
} from '@fortawesome/free-solid-svg-icons';

// Robot types with their default images
const ROBOT_TYPES = [
  { value: "rover", label: "Rover", image: "/default/rover.png" },
  { value: "humanoid", label: "Humanoid", image: "/default/robot.png" },
  { value: "drone", label: "Drone", image: "/default/drone.png" },
  { value: "sub", label: "Submarine", image: "/default/sub.png" },
  { value: "robodog", label: "Robot Dog", image: "/default/robodog.png" },
  { value: "robot", label: "Robot Arm", image: "/default/humanoid.png" },
];

// Get default robot image based on robotType
const getDefaultRobotImage = (robotType: string): string => {
  const type = ROBOT_TYPES.find(t => t.value === robotType.toLowerCase());
  return type?.image || "/default/humanoid.png";
};

type RobotListing = {
  robotName: string;
  description: string;
  robotType: string; // Robot type for default image selection
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

export const EditRobot = () => {
  usePageTitle();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const robotId = searchParams.get('robotId');
  const isViewMode = searchParams.get('mode') === 'view';
  
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingRobot, setIsLoadingRobot] = useState(true);
  const [success, setSuccess] = useState<boolean | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [robotName, setRobotName] = useState<string>('');
  const [robotStatus, setRobotStatus] = useState<{ isOnline: boolean; lastSeen?: number } | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [robotIdForStatus, setRobotIdForStatus] = useState<string>(''); // robotId field (robot-XXXXXXXX)

  const [robotListing, setRobotListing] = useState<RobotListing>({
    robotName: "",
    description: "",
    robotType: ROBOT_TYPES[0].value,
    hourlyRateCredits: 100,
    enableAccessControl: false,
    allowedUserEmails: "",
    city: "",
    state: "",
    country: "",
    latitude: "",
    longitude: "",
  });
  const [isVerified, setIsVerified] = useState(false);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [existingImageKey, setExistingImageKey] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuthStatus();
  const [currencyDisplay, setCurrencyDisplay] = useState<string>('USD');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('USD');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | undefined>();
  const [hourlyRateCurrency, setHourlyRateCurrency] = useState<number>(1.00);

  // Fetch exchange rates on mount
  useEffect(() => {
    fetchExchangeRates().then(rates => {
      setExchangeRates(rates);
    }).catch(err => {
      logger.warn('Failed to fetch exchange rates:', err);
    });
  }, []);

  // Load user's preferred currency for display
  // Partners may also have a Client record for currency preferences
  useEffect(() => {
    const loadCurrency = async () => {
      if (!user?.username) {
        setCurrencyDisplay('USD');
        setCurrencyCode('USD');
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
        setHourlyRateCurrency(currencyValue);
      } catch (err) {
        logger.error("Error loading currency preference:", err);
        // Fallback to USD on error
        setCurrencyDisplay('USD');
        setCurrencyCode('USD');
      }
    };

    loadCurrency();
  }, [user?.username, exchangeRates, robotListing.hourlyRateCredits]);

  // Update displayed currency value when credits change or currency changes
  useEffect(() => {
    if (currencyCode && exchangeRates && robotListing.hourlyRateCredits) {
      const currencyValue = creditsToCurrencySync(robotListing.hourlyRateCredits, currencyCode, exchangeRates);
      setHourlyRateCurrency(currencyValue);
    }
  }, [robotListing.hourlyRateCredits, currencyCode, exchangeRates]);

  // Load robot data
  useEffect(() => {
    const loadRobot = async () => {
      if (!robotId) {
        setError('No robot ID provided');
        setIsLoadingRobot(false);
        return;
      }

      try {
        setIsLoadingRobot(true);
        setError(null);
        
        // Try to get robot by ID
        const robot = await client.models.Robot.get({ id: robotId });
        
        if (robot.errors || !robot.data) {
          throw new Error(robot.errors?.[0]?.message || 'Robot not found');
        }

        const robotData = robot.data;
        
        // Extract allowed users (excluding default users)
        const allowedUsers = robotData.allowedUsers || [];
        const defaultUsers = ['chris@modulr.cloud', 'mike@modulr.cloud'];
        const additionalUsers = allowedUsers
          .filter((email): email is string => email != null && typeof email === 'string')
          .filter((email: string) => !defaultUsers.includes(email.toLowerCase()));

        const name = robotData.name || "";
        setRobotName(name);
        setRobotIdForStatus(robotData.robotId || ''); // Store robotId for status check
        
        // Type-safe access to extended robot fields
        const extendedData = robotData as typeof robotData & { isVerified?: boolean; robotType?: string };
        setIsVerified(extendedData.isVerified || false); // Store verification status
        
        // Get robotType, falling back to model for backwards compatibility
        const robotTypeValue = extendedData.robotType || robotData.model || ROBOT_TYPES[0].value;
        // Validate that the robotType is one of the allowed values
        const validRobotType = ROBOT_TYPES.some(t => t.value === robotTypeValue.toLowerCase()) 
          ? robotTypeValue.toLowerCase() 
          : ROBOT_TYPES[0].value;
        
        setRobotListing({
          robotName: name,
          description: robotData.description || "",
          robotType: validRobotType,
          hourlyRateCredits: robotData.hourlyRateCredits || 100,
          enableAccessControl: allowedUsers.length > 0,
          allowedUserEmails: additionalUsers.join('\n'),
          city: robotData.city || "",
          state: robotData.state || "",
          country: robotData.country || "",
          latitude: robotData.latitude?.toString() || "",
          longitude: robotData.longitude?.toString() || "",
        });

        // Load existing image if available (only for verified robots with custom images)
        if (robotData.imageUrl && extendedData.isVerified) {
          setExistingImageKey(robotData.imageUrl);
          if (!robotData.imageUrl.startsWith('http')) {
            try {
              const result = await getUrl({ path: robotData.imageUrl, options: { bucket: 'robotImages' } });
              setImagePreview(result.url.toString());
            } catch (err) {
              logger.error('Error loading existing image:', err);
              // If loading fails, show default image based on robotType
              setImagePreview(getDefaultRobotImage(validRobotType));
            }
          } else {
            setImagePreview(robotData.imageUrl);
          }
        } else {
          // Use default image based on robotType
          setImagePreview(getDefaultRobotImage(validRobotType));
        }
      } catch (err) {
        logger.error('Error loading robot:', err);
        setError(err instanceof Error ? err.message : 'Failed to load robot');
      } finally {
        setIsLoadingRobot(false);
      }
    };

    loadRobot();
  }, [robotId]);

  // Load robot status
  useEffect(() => {
    const loadRobotStatus = async () => {
      if (!robotIdForStatus) {
        setRobotStatus(null);
        return;
      }

      try {
        setIsLoadingStatus(true);
        const status = await client.queries.getRobotStatusLambda({
          robotId: robotIdForStatus,
        });
        
        if (status.data) {
          setRobotStatus({
            isOnline: status.data.isOnline || false,
            lastSeen: status.data.lastSeen || undefined,
          });
        } else {
          setRobotStatus({ isOnline: false });
        }
      } catch (err) {
        logger.error('Error loading robot status:', err);
        setRobotStatus({ isOnline: false });
      } finally {
        setIsLoadingStatus(false);
      }
    };

    loadRobotStatus();
    
    // Poll status every 10 seconds
    const interval = setInterval(loadRobotStatus, 10000);
    return () => clearInterval(interval);
  }, [robotIdForStatus]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = event.target;
    const checked = (event.target as HTMLInputElement).checked;
    
    // Handle hourly rate input (user enters currency value, we convert to credits)
    if (type === 'number' && name === 'hourlyRateCredits') {
      // Remove any non-numeric characters except decimal point
      const sanitized = value.replace(/[^0-9.]/g, '');
      // Convert to number, default to 0 if empty or invalid
      const currencyValue = sanitized === '' || sanitized === '.' ? 0 : parseFloat(sanitized);
      
      if (!isNaN(currencyValue) && currencyValue >= 0) {
        // Update displayed currency value
        setHourlyRateCurrency(currencyValue);
        
        // Convert currency value back to credits for storage
        const creditsValue = currencyToCreditsSync(currencyValue, currencyCode, exchangeRates);
        setRobotListing(prev => ({
          ...prev,
          hourlyRateCredits: creditsValue,
        }));
      }
    } else {
      setRobotListing(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value,
      }));
      
      // If robotType changed and no custom image is set, update preview to default
      if (name === 'robotType' && !imageFile && !existingImageKey) {
        setImagePreview(getDefaultRobotImage(value));
      }
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
    setExistingImageKey(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // Show default image based on current robotType
    setImagePreview(getDefaultRobotImage(robotListing.robotType));
  };

  const uploadImage = async (): Promise<string | null> => {
    if (!imageFile) return existingImageKey;

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

  const onConfirmUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setSuccess(undefined);
    setError(null);
    setUploadError(null);
    setUploadProgress(0);

    let imageUrl: string | null | undefined = existingImageKey;

    if (imageFile) {
      try {
        imageUrl = await uploadImage();
      } catch {
        setUploadError('Failed to upload image. Please try again.');
        setIsLoading(false);
        return;
      }
    }

    // If no image is provided and no existing image, don't include imageUrl in update
    // The default robot image will be used based on the model
    if (!imageUrl || imageUrl.trim() === '') {
      imageUrl = undefined;
    }

    // Parse email list (split by comma or newline, trim, filter empty)
    const emailList = robotListing.enableAccessControl && robotListing.allowedUserEmails
      ? robotListing.allowedUserEmails
          .split(/[,\n]/)
          .map(email => email.trim())
          .filter(email => email.length > 0 && email.includes('@'))
      : [];

    // Ensure robotType is valid before sending
    const validRobotType = robotListing.robotType && robotListing.robotType.trim() !== '' 
      ? robotListing.robotType.trim().toLowerCase()
      : ROBOT_TYPES[0].value;
    const robotTypeToSend = ROBOT_TYPES.some(t => t.value === validRobotType) 
      ? validRobotType 
      : ROBOT_TYPES[0].value;
    
    const robotData = {
      robotName: robotListing.robotName,
      description: robotListing.description,
      model: robotTypeToSend, // Keep model for backwards compatibility
      robotType: robotTypeToSend, // New field for default image selection
      hourlyRateCredits: robotListing.hourlyRateCredits,
      enableAccessControl: robotListing.enableAccessControl,
      additionalAllowedUsers: emailList,
      ...(isVerified && imageUrl ? { imageUrl } : {}), // Only include imageUrl if verified and has a value
      city: robotListing.city || undefined,
      state: robotListing.state || undefined,
      country: robotListing.country || undefined,
      latitude: robotListing.latitude ? (isNaN(parseFloat(robotListing.latitude)) ? undefined : parseFloat(robotListing.latitude)) : undefined,
      longitude: robotListing.longitude ? (isNaN(parseFloat(robotListing.longitude)) ? undefined : parseFloat(robotListing.longitude)) : undefined,
    };

    try {
      if (!robotId) {
        throw new Error('Robot ID is required for updates');
      }

      const robot = await client.mutations.updateRobotLambda({
        robotId,
        ...robotData,
      });

      if (robot.errors) {
        setError(robot.errors[0]?.message || 'Failed to update robot');
        setSuccess(false);
      } else {
        setSuccess(true);
        navigate(`/robot-setup?robotId=${robotId}`);
      }
    } catch (error) {
      logger.error('Error updating robot:', error);
      setError(error instanceof Error ? error.message : 'Failed to update robot');
      setSuccess(false);
    }

    setIsLoading(false);
  };

  const handleDeleteRobot = async () => {
    if (!robotId) {
      setError('No robot ID provided');
      return;
    }

    const confirmMessage = `Are you sure you want to delete "${robotName || 'this robot'}"? This action cannot be undone.`;
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);
      
      const result = await client.mutations.deleteRobotLambda({ robotId });
      
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: { message?: string }) => e.message || JSON.stringify(e)).join(', ');
        throw new Error(errorMessages);
      }
      
      if (result.data?.statusCode === 200) {
        navigate('/robots');
      } else {
        throw new Error(result.data?.body || 'Failed to delete robot');
      }
    } catch (err) {
      logger.error('Error deleting robot:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete robot');
      setSuccess(false);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoadingRobot) {
    return (
      <div className="create-listing-page">
        <LoadingWheel />
      </div>
    );
  }

  if (error && !robotId) {
    return (
      <div className="create-listing-page">
        <div className="listing-header">
          <div className="header-icon">
            <FontAwesomeIcon icon={faRobot} />
          </div>
          <div className="header-content">
            <h1>Edit Robot</h1>
            <p>{error}</p>
          </div>
        </div>
        <div className="listing-container">
          <button onClick={() => navigate('/robots')} className="submit-btn">
            Back to Robots
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="create-listing-page">
      <div className="listing-header">
        <div className="header-icon">
          <FontAwesomeIcon icon={faRobot} />
        </div>
        <div className="header-content">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h1>{isViewMode ? 'Robot Details' : 'Edit Robot'}</h1>
            {robotIdForStatus && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem',
                fontSize: '0.9rem',
                color: robotStatus?.isOnline ? '#ffb700' : '#666',
                fontWeight: 500
              }}>
                <FontAwesomeIcon 
                  icon={faCircle} 
                  style={{ 
                    fontSize: '0.6rem',
                    color: robotStatus?.isOnline ? '#ffb700' : '#666'
                  }} 
                />
                <span>
                  {isLoadingStatus ? 'Checking...' : (robotStatus?.isOnline ? 'Online' : 'Offline')}
                </span>
              </div>
            )}
          </div>
          <p>{isViewMode ? 'View robot information' : 'Update your robot\'s information and settings'}</p>
        </div>
      </div>

      <div className="listing-container">
        {isViewMode ? (
          <>
            <div className="robot-view-details">
              <div className="view-section">
                <h3>Robot Information</h3>
                
                <div className="view-row">
                  <span className="view-label">Name</span>
                  <span className="view-value">{robotListing.robotName || 'N/A'}</span>
                </div>
                
                <div className="view-row">
                  <span className="view-label">Type</span>
                  <span className="view-value" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <img 
                      src={ROBOT_TYPES.find(t => t.value === robotListing.robotType)?.image || "/default/humanoid.png"} 
                      alt={robotListing.robotType}
                      style={{ width: '40px', height: '40px', objectFit: 'contain', borderRadius: '6px' }}
                    />
                    {ROBOT_TYPES.find(t => t.value === robotListing.robotType)?.label || robotListing.robotType}
                  </span>
                </div>
                
                <div className="view-row">
                  <span className="view-label">Description</span>
                  <span className="view-value">{robotListing.description || 'No description'}</span>
                </div>

                {imagePreview && (
                  <div className="view-row">
                    <span className="view-label">Image</span>
                    <div className="view-value">
                      <img 
                        src={imagePreview} 
                        alt={robotListing.robotName} 
                        style={{ maxWidth: '200px', borderRadius: '8px' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {(robotListing.city || robotListing.state || robotListing.country) && (
                <div className="view-section">
                  <h3>Location</h3>
                  <div className="view-row">
                    <span className="view-label">Address</span>
                    <span className="view-value">
                      {[robotListing.city, robotListing.state, robotListing.country]
                        .filter(Boolean)
                        .join(', ') || 'Not specified'}
                    </span>
                  </div>
                  {(robotListing.latitude || robotListing.longitude) && (
                    <div className="view-row">
                      <span className="view-label">Coordinates</span>
                      <span className="view-value">
                        {robotListing.latitude}, {robotListing.longitude}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="view-section">
                <h3>Access</h3>
                <div className="view-row">
                  <span className="view-label">Access Control</span>
                  <span className="view-value">
                    {robotListing.enableAccessControl ? 'Restricted' : 'Open to all users'}
                  </span>
                </div>
              </div>
            </div>

            <div className="form-actions">
              <button 
                type="button"
                className="submit-btn"
                onClick={() => navigate('/robots')}
              >
                Back to Robots
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="info-banner">
              <FontAwesomeIcon icon={faInfoCircle} />
              <span>Changes will be reflected immediately for all users</span>
            </div>

            <form className="listing-form" onSubmit={onConfirmUpdate}>
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
                disabled={isLoading || isViewMode}
              />
            </div>

            <div className="form-group">
              <label htmlFor="robot-type">
                Robot Type <span className="required">*</span>
              </label>
              <div className="robot-type-selector">
                {ROBOT_TYPES.map(type => (
                  <label 
                    key={type.value}
                    className={`robot-type-option ${robotListing.robotType === type.value ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="robotType"
                      value={type.value}
                      checked={robotListing.robotType === type.value}
                      onChange={handleInputChange}
                      disabled={isLoading || isViewMode}
                    />
                    <div className="robot-type-card">
                      <div className="robot-type-image">
                        <img src={type.image} alt={type.label} />
                      </div>
                      <span className="robot-type-label">{type.label}</span>
                    </div>
                  </label>
                ))}
              </div>
              <p className="form-help-text">
                Select the type that best matches your robot. This image will be displayed in listings.
              </p>
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
                disabled={isLoading || isViewMode}
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
                value={hourlyRateCurrency.toFixed(2)}
                onChange={handleInputChange}
                placeholder="1.00"
                min="0"
                step="0.01"
                required
                disabled={isLoading}
              />
              <small className="form-help-text">
                Set the hourly rate in your preferred currency that clients will pay to use this robot. 
                The platform will add a markup on top of this rate.
              </small>
            </div>
          </div>

          <div className="form-section">
            <h3>Robot Image</h3>
            
            <div className="form-group">
              {/* Show current image (default or custom) */}
              <div className="preview-container" style={{ marginBottom: '1rem' }}>
                <img 
                  src={imagePreview || getDefaultRobotImage(robotListing.robotType)} 
                  alt="Robot preview" 
                />
                {isVerified && (imageFile || existingImageKey) && (
                  <button type="button" className="remove-image" onClick={clearImage}>
                    <FontAwesomeIcon icon={faTimes} />
                  </button>
                )}
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <div className="upload-progress">
                    <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
              </div>

              {/* Conditional upload section based on verification */}
              {isVerified ? (
                <>
                  <label>
                    Custom Image <span className="optional">(optional)</span>
                  </label>
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
                  {uploadError && (
                    <div className="upload-error">
                      <FontAwesomeIcon icon={faExclamationCircle} />
                      <span>{uploadError}</span>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ 
                  background: 'rgba(255, 183, 0, 0.1)', 
                  border: '1px solid rgba(255, 183, 0, 0.3)', 
                  borderRadius: '8px', 
                  padding: '1rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem'
                }}>
                  <FontAwesomeIcon icon={faLock} style={{ color: '#ffc107', marginTop: '0.125rem' }} />
                  <div>
                    <p style={{ 
                      color: 'rgba(255, 255, 255, 0.9)', 
                      margin: 0,
                      fontWeight: 500
                    }}>
                      Custom images available after verification
                    </p>
                    <p style={{ 
                      color: 'rgba(255, 255, 255, 0.6)', 
                      margin: '0.5rem 0 0 0',
                      fontSize: '0.85rem'
                    }}>
                      Your robot is using the default image based on its type. Once our team verifies your robot, 
                      you'll be able to upload custom photos.
                    </p>
                  </div>
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
                  disabled={isLoading || isViewMode}
                />
                <span>Restrict access to specific users</span>
              </label>
              <p className="form-help-text">
                {robotListing.enableAccessControl 
                  ? "Access will be restricted to you, chris@modulr.cloud, mike@modulr.cloud, and any users you add below. You can manage the access list after updating the robot."
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
                  disabled={isLoading || isViewMode}
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
                disabled={isLoading || isViewMode}
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
                disabled={isLoading || isViewMode}
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
                disabled={isLoading || isViewMode}
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
                  disabled={isLoading || isViewMode}
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
                  disabled={isLoading || isViewMode}
                />
              </div>
            </div>
            <p className="form-help-text">
              Latitude and longitude are optional but useful for distance-based searches. 
              You can find coordinates using <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">Google Maps</a>.
            </p>
          </div>

          {robotIdForStatus && (
            <div className="form-section">
              <RobotAvailabilityManager 
                robotId={robotIdForStatus}
                robotUuid={robotId || undefined}
              />
            </div>
          )}

          <div className="form-actions">
            <button 
              type="button"
              className="submit-btn"
              onClick={handleDeleteRobot}
              disabled={isLoading || isDeleting}
              style={{ 
                background: '#dc2626',
                backgroundImage: 'none',
                color: 'white',
                border: 'none',
                padding: '0.875rem',
                minWidth: '48px',
                boxShadow: 'none'
              }}
              title="Delete Robot"
            >
              {isDeleting ? (
                <LoadingWheel />
              ) : (
                <FontAwesomeIcon icon={faTrash} />
              )}
            </button>
            <div style={{ display: 'flex', gap: '1rem', marginLeft: 'auto' }}>
              <button 
                type="button"
                className="submit-btn cancel-btn"
                onClick={() => navigate('/robots')}
                disabled={isLoading || isDeleting}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="submit-btn"
                disabled={isLoading || isDeleting || !robotListing.robotName.trim()}
              >
                {isLoading ? (
                  <>
                    <LoadingWheel />
                    <span>Updating...</span>
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faRobot} />
                    <span>Update Robot</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {success === true && (
          <div className="feedback-message success">
            <FontAwesomeIcon icon={faCheckCircle} />
            <div className="message-content">
              <strong>Success!</strong>
              <p>Your robot has been updated successfully. Redirecting...</p>
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
          </>
        )}
      </div>
    </div>
  );
};

