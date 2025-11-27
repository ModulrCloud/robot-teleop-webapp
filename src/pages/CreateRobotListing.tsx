import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './CreateRobotListing.css';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { LoadingWheel } from '../components/LoadingWheel';
import { usePageTitle } from "../hooks/usePageTitle";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faRobot, 
  faCheckCircle, 
  faExclamationCircle,
  faInfoCircle,
  faTruck,
  faPersonWalking,
  faPlane,
  faWater
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

  const [robotListing, setRobotListing] = useState<RobotListing>({
    robotName: "",
    description: "",
    model: ROBOT_MODELS[0].value,
    enableAccessControl: false,
    allowedUserEmails: "",
    city: "",
    state: "",
    country: "",
    latitude: "",
    longitude: "",
  });

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = event.target;
    const checked = (event.target as HTMLInputElement).checked;
    setRobotListing(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const onConfirmCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setSuccess(undefined);

    // Parse email list (split by comma or newline, trim, filter empty)
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
      enableAccessControl: robotListing.enableAccessControl,
      additionalAllowedUsers: emailList,
      city: robotListing.city || undefined,
      state: robotListing.state || undefined,
      country: robotListing.country || undefined,
      latitude: robotListing.latitude ? (isNaN(parseFloat(robotListing.latitude)) ? undefined : parseFloat(robotListing.latitude)) : undefined,
      longitude: robotListing.longitude ? (isNaN(parseFloat(robotListing.longitude)) ? undefined : parseFloat(robotListing.longitude)) : undefined,
    };

    console.log('🤖 Creating robot with data:', robotData);

    try {
      const robot = await client.mutations.setRobotLambda(robotData);

      console.log('📊 Robot creation response:', {
        hasData: !!robot.data,
        hasErrors: !!robot.errors,
        data: robot.data,
        errors: robot.errors,
      });

      if (robot.errors) {
        console.error('❌ Errors creating robot:', robot.errors);
        setSuccess(false);
      } else {
        console.log('✅ Robot created successfully:', robot.data);
        
        // Parse the robot data to get robotId
        try {
          const robotData = JSON.parse(robot.data || '{}');
          const robotId = robotData.robotId;
          
          if (robotId) {
            // Redirect to setup page with robotId
            navigate(`/robot-setup?robotId=${robotId}`);
          } else {
            // Fallback: show success message
            setSuccess(true);
            setRobotListing({
              robotName: "",
              description: "",
              model: ROBOT_MODELS[0].value,
              enableAccessControl: false,
              allowedUserEmails: "",
              city: "",
              state: "",
              country: "",
              latitude: "",
              longitude: "",
            });
          }
        } catch (parseError) {
          console.error('Failed to parse robot data:', parseError);
          // Fallback: show success message
          setSuccess(true);
          setRobotListing({
            robotName: "",
            description: "",
            model: ROBOT_MODELS[0].value,
            enableAccessControl: false,
            allowedUserEmails: "",
            city: "",
            state: "",
            country: "",
            latitude: "",
            longitude: "",
          });
        }
      }
    } catch (error) {
      console.error('❌ Exception creating robot:', error);
      setSuccess(false);
    }

    setIsLoading(false);
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