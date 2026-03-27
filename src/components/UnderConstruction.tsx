import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHardHat, faTools } from '@fortawesome/free-solid-svg-icons';
import './UnderConstruction.css';

interface UnderConstructionProps {
  mode?: 'banner' | 'page';
  message?: string;
  feature?: string;
}

export const UnderConstruction = ({ 
  mode = 'banner', 
  message,
  feature 
}: UnderConstructionProps) => {
  
  const defaultMessage = feature 
    ? `${feature} is currently under construction` 
    : 'This feature is currently under construction';

  if (mode === 'page') {
    return (
      <div className="under-construction-page">
        <div className="construction-content">
          <div className="construction-icon-large">
            <FontAwesomeIcon icon={faHardHat} />
          </div>
          <h1>Under Construction</h1>
          <p>{message || defaultMessage}</p>
          <div className="construction-details">
            <FontAwesomeIcon icon={faTools} />
            <span>We're working hard to bring you this feature!</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="under-construction-banner">
      <div className="banner-icon">
        <FontAwesomeIcon icon={faHardHat} />
      </div>
      <div className="banner-content">
        <strong>Under Construction</strong>
        <span>{message || defaultMessage}</span>
      </div>
    </div>
  );
};