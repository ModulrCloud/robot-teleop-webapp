import './SignIn.css';
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import { signInWithRedirect } from 'aws-amplify/auth';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { useNavigate } from 'react-router-dom';
import { LoadingWheel } from '../components/LoadingWheel';

export default function SignIn() {
  usePageTitle();
  const { isLoggedIn, loading } = useAuthStatus();
  const navigate = useNavigate();

  const signInWithGoogle = async () => {
    await signInWithRedirect({
      provider: 'Google'
    });
  };

  if (loading) {
    return (
      <div className="signin-container">
        <LoadingWheel />
      </div>
    );
  }

  if (isLoggedIn) {
    navigate('/');
    return null;
  }

  return (
    <div className="signin-container">
      <h2>Sign In</h2>
      <Button onClick={signInWithGoogle} className="signin-google-btn">
        <FontAwesomeIcon icon={faGoogle} size="1x" id="google-icon" />
        Sign in With Google
      </Button>
    </div>
  );
}