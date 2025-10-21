import './SignIn.css';
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import { signInWithRedirect } from 'aws-amplify/auth';
import { usePageTitle } from '../hooks/usePageTitle';

export default function SignIn() {
  usePageTitle();
  const signInWithGoogle = async () => {
    await signInWithRedirect({
      provider: 'Google'
    });
  }

  return (
    <div className="signin-container">
      <h2>Sign In</h2>
      <Button onClick={signInWithGoogle} className="signin-google-btn">
        <FontAwesomeIcon icon={faGoogle} size="1x" id="google-icon" />{''}
        Sign in With Google
      </Button>
    </div>
  );
}
