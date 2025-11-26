import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  faWater,
  faTrash
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

export const EditRobot = () => {
  usePageTitle("Edit Robot");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const robotId = searchParams.get('robotId');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingRobot, setIsLoadingRobot] = useState(true);
  const [success, setSuccess] = useState<boolean | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [robotName, setRobotName] = useState<string>('');

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
        const additionalUsers = allowedUsers.filter(
          (email: string) => !defaultUsers.includes(email.toLowerCase())
        );

        const name = robotData.name || "";
        setRobotName(name);
        setRobotListing({
          robotName: name,
          description: robotData.description || "",
          model: robotData.model || ROBOT_MODELS[0].value,
          enableAccessControl: allowedUsers.length > 0,
          allowedUserEmails: additionalUsers.join('\n'),
          city: robotData.city || "",
          state: robotData.state || "",
          country: robotData.country || "",
          latitude: robotData.latitude?.toString() || "",
          longitude: robotData.longitude?.toString() || "",
        });
      } catch (err) {
        console.error('Error loading robot:', err);
        setError(err instanceof Error ? err.message : 'Failed to load robot');
      } finally {
        setIsLoadingRobot(false);
      }
    };

    loadRobot();
  }, [robotId]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = event.target;
    const checked = (event.target as HTMLInputElement).checked;
    setRobotListing(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const onConfirmUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setSuccess(undefined);
    setError(null);

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

    console.log('🤖 Updating robot with data:', robotData);

    try {
      if (!robotId) {
        throw new Error('Robot ID is required for updates');
      }

      const robot = await client.mutations.updateRobotLambda({
        robotId,
        ...robotData,
      });

      console.log('📊 Robot update response:', {
        hasData: !!robot.data,
        hasErrors: !!robot.errors,
        data: robot.data,
        errors: robot.errors,
      });

      if (robot.errors) {
        console.error('❌ Errors updating robot:', robot.errors);
        setError(robot.errors[0]?.message || 'Failed to update robot');
        setSuccess(false);
      } else {
        console.log('✅ Robot updated successfully:', robot.data);
        setSuccess(true);
        
        // Redirect to Robot Setup page so user can get a fresh token URL
        // The Robot Setup page will fetch a fresh token from the current auth session
        if (robotId) {
          navigate(`/robot-setup?robotId=${robotId}`);
        } else {
          // Fallback: try to get robotId from response
          try {
            const robotData = JSON.parse(robot.data || '{}');
            const updatedRobotId = robotData.robotId;
            if (updatedRobotId) {
              navigate(`/robot-setup?robotId=${updatedRobotId}`);
            } else {
              // Final fallback: redirect to robots list
              setTimeout(() => {
                navigate('/robots');
              }, 2000);
            }
          } catch (parseError) {
            console.error('Failed to parse robot data:', parseError);
            // Final fallback: redirect to robots list
            setTimeout(() => {
              navigate('/robots');
            }, 2000);
          }
        }
      }
    } catch (error) {
      console.error('❌ Exception updating robot:', error);
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
      
      console.log(`🗑️ Attempting to delete robot: ${robotName} (${robotId})`);
      
      const result = await client.mutations.deleteRobotLambda({ robotId });
      
      console.log('📊 Delete robot response:', {
        hasData: !!result.data,
        hasErrors: !!result.errors,
        data: result.data,
        errors: result.errors,
      });
      
      // Check for GraphQL errors first
      if (result.errors && result.errors.length > 0) {
        console.error('❌ GraphQL errors:', result.errors);
        const errorMessages = result.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
        throw new Error(errorMessages);
      }
      
      // Check the response status
      if (result.data?.statusCode === 200) {
        // Success - redirect to robots list
        navigate('/robots');
      } else {
        throw new Error(result.data?.body || 'Failed to delete robot');
      }
    } catch (err) {
      console.error('❌ Exception deleting robot:', err);
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
          <h1>Edit Robot</h1>
          <p>Update your robot's information and settings</p>
        </div>
      </div>

      <div className="listing-container">
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
      </div>
    </div>
  );
};

