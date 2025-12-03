import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './CreateRobotListing.css';
import { generateClient } from 'aws-amplify/api';
import { uploadData, getUrl } from 'aws-amplify/storage';
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
  faTrash,
  faCircle,
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
    model: ROBOT_MODELS[0].value,
    enableAccessControl: false,
    allowedUserEmails: "",
    city: "",
    state: "",
    country: "",
    latitude: "",
    longitude: "",
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [existingImageKey, setExistingImageKey] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        
        // Ensure model is a valid value, defaulting to first model if missing or invalid
        const validModel = robotData.model && robotData.model.trim() !== '' 
          ? robotData.model.trim().toLowerCase()
          : ROBOT_MODELS[0].value;
        // Validate that the model is one of the allowed values
        const modelValue = ROBOT_MODELS.some(m => m.value === validModel) 
          ? validModel 
          : ROBOT_MODELS[0].value;
        
        setRobotListing({
          robotName: name,
          description: robotData.description || "",
          model: modelValue,
          enableAccessControl: allowedUsers.length > 0,
          allowedUserEmails: additionalUsers.join('\n'),
          city: robotData.city || "",
          state: robotData.state || "",
          country: robotData.country || "",
          latitude: robotData.latitude?.toString() || "",
          longitude: robotData.longitude?.toString() || "",
        });

        // Load existing image if available
        if (robotData.imageUrl) {
          setExistingImageKey(robotData.imageUrl);
          if (!robotData.imageUrl.startsWith('http')) {
            try {
              const result = await getUrl({ path: robotData.imageUrl });
              setImagePreview(result.url.toString());
            } catch (err) {
              console.error('Error loading existing image:', err);
            }
          } else {
            setImagePreview(robotData.imageUrl);
          }
        }
      } catch (err) {
        console.error('Error loading robot:', err);
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
        console.error('Error loading robot status:', err);
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
    setRobotListing(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
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
    setExistingImageKey(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
      console.error('Upload failed:', error);
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

    // Parse email list (split by comma or newline, trim, filter empty)
    const emailList = robotListing.enableAccessControl && robotListing.allowedUserEmails
      ? robotListing.allowedUserEmails
          .split(/[,\n]/)
          .map(email => email.trim())
          .filter(email => email.length > 0 && email.includes('@'))
      : [];

    // Ensure model is valid before sending
    const validModel = robotListing.model && robotListing.model.trim() !== '' 
      ? robotListing.model.trim().toLowerCase()
      : ROBOT_MODELS[0].value;
    const modelToSend = ROBOT_MODELS.some(m => m.value === validModel) 
      ? validModel 
      : ROBOT_MODELS[0].value;
    
    const robotData = {
      robotName: robotListing.robotName,
      description: robotListing.description,
      model: modelToSend,
      enableAccessControl: robotListing.enableAccessControl,
      additionalAllowedUsers: emailList,
      imageUrl: imageUrl || undefined,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h1>Edit Robot</h1>
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
            <h3>Robot Image</h3>
            
            <div className="form-group">
              <label>
                Image <span className="optional">(optional)</span>
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

