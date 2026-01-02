import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@fortawesome/free-solid-svg-icons";
import "./RouteLoadingSpinner.css";

export const RouteLoadingSpinner = () => {
  return (
    <div className="route-loading-container">
      <FontAwesomeIcon icon={faSpinner} className="route-loading-spinner" />
    </div>
  );
};


