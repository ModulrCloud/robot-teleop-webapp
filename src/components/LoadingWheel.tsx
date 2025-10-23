import { faSpinner } from "@fortawesome/free-solid-svg-icons"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"


export const LoadingWheel = () => {
  return <FontAwesomeIcon icon={faSpinner} spin={true} />
}
