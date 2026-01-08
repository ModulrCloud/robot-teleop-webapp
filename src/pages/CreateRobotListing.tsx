import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './CreateRobotListing.css';
import { generateClient } from 'aws-amplify/api';
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
  faCalendarAlt
} from '@fortawesome/free-solid-svg-icons';

// Robot types with their default images
const ROBOT_TYPES = [
  { value: "rover", label: "Rover", image: "/default/rover.png" },
  { value: "humanoid", label: "Humanoid", image: "/default/humanoid.png" },
  { value: "drone", label: "Drone", image: "/default/drone.png" },
  { value: "sub", label: "Submarine", image: "/default/sub.png" },
  { value: "robodog", label: "Robot Dog", image: "/default/robodog.png" },
  { value: "robot", label: "Robot Arm", image: "/default/robot.png" },
];

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

export const CreateRobotListing = () => {
  usePageTitle();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState<boolean | undefined>();
  const [hourlyRateError, setHourlyRateError] = useState<string | null>(null);

  const [robotListing, setRobotListing] = useState<RobotListing>({
    robotName: "",
    description: "",
    robotType: ROBOT_TYPES[0].value,
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
  const { user } = useAuthStatus();
  const [currencyDisplay, setCurrencyDisplay] = useState<string>('USD');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('USD');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | undefined>();

  // Fetch exchange rates on mount
  useEffect(() => {
    fetchExchangeRates().then(rates => {
      setExchangeRates(rates);
    }).catch(err => {
      logger.warn('Failed to fetch exchange rates:', err);
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

  const onConfirmCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setSuccess(undefined);
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

    const emailList = robotListing.enableAccessControl && robotListing.allowedUserEmails
      ? robotListing.allowedUserEmails
          .split(/[,\n]/)
          .map(email => email.trim())
          .filter(email => email.length > 0 && email.includes('@'))
      : [];

    const robotData = {
      robotName: robotListing.robotName,
      description: robotListing.description,
      model: robotListing.robotType, // Use robotType as model for backwards compatibility
      robotType: robotListing.robotType, // New field for default image selection
      hourlyRateCredits: creditsValue,
      enableAccessControl: robotListing.enableAccessControl,
      additionalAllowedUsers: emailList,
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
                      disabled={isLoading}
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

          <div className="form-section">
            <h3>
              <FontAwesomeIcon icon={faCalendarAlt} style={{ marginRight: '0.5rem' }} />
              Robot Availability
            </h3>
            <div style={{ 
              background: 'rgba(255, 183, 0, 0.1)', 
              border: '1px solid rgba(255, 183, 0, 0.3)', 
              borderRadius: '8px', 
              padding: '1.5rem',
              marginTop: '1rem'
            }}>
              <p style={{ 
                color: 'rgba(255, 255, 255, 0.9)', 
                margin: 0,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem'
              }}>
                <FontAwesomeIcon icon={faInfoCircle} style={{ color: '#17a2b8', marginTop: '0.25rem', flexShrink: 0 }} />
                <span>
                  You can manage robot availability (block dates/times when your robot is unavailable) after creating the robot. 
                  Once your robot is created, you'll be able to set availability blocks from the Edit Robot page.
                </span>
              </p>
            </div>
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