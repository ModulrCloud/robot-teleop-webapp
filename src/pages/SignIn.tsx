import './SignIn.css';
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import { faRobot, faGamepad } from '@fortawesome/free-solid-svg-icons';
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
    <div className="signin-wrapper">
      <div className="signin-container">
        <div className="signin-header">
          <h1>Welcome to Modulr</h1>
          <p className="signin-tagline">Remote Robot Teleoperation Platform</p>
        </div>

        <div className="signin-features">
          <div className="feature-card">
            <FontAwesomeIcon icon={faGamepad} className="feature-icon" />
            <h3>Control Robots</h3>
            <p>Access and operate robots remotely from anywhere</p>
          </div>
          <div className="feature-card">
            <FontAwesomeIcon icon={faRobot} className="feature-icon" />
            <h3>Offer Your Robots</h3>
            <p>List your robots and earn from remote operations</p>
          </div>
        </div>

        <div className="signin-action">
          <p className="signin-prompt">Get started in seconds</p>
          <Button onClick={signInWithGoogle} className="signin-google-btn">
            <FontAwesomeIcon icon={faGoogle} className="google-icon" />
            Sign in with Google
          </Button>
          <p className="signin-note">You'll choose your account type after signing in</p>
        </div>
      </div>
    </div>
  );
}