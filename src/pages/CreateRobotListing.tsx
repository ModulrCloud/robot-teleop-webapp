import { useState } from 'react';
import './CreateRobotListing.css';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { LoadingWheel } from '../components/LoadingWheel';
import { Amplify } from 'aws-amplify';
import outputs from '../../amplify_outputs.json';
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
};

Amplify.configure(outputs);
const client = generateClient<Schema>();

export const CreateRobotListing = () => {
  usePageTitle();
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState<boolean | undefined>();

  const [robotListing, setRobotListing] = useState<RobotListing>({
    robotName: "",
    description: "",
    model: ROBOT_MODELS[0].value,
  });

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setRobotListing(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const onConfirmCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setSuccess(undefined);

    const robot = await client.mutations.setRobotLambda(robotListing);

    if (robot.errors) {
      setSuccess(false);
    } else {
      setSuccess(true);
      setRobotListing({
        robotName: "",
        description: "",
        model: ROBOT_MODELS[0].value,
      });
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
                disabled={isLoading}
              />
              <div className="char-count">
                {robotListing.description.length} characters
              </div>
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