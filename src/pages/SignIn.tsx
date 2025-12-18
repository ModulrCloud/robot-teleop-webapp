import './SignIn.css';
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import { faRobot, faGamepad } from '@fortawesome/free-solid-svg-icons';
// Import Amplify first to ensure config is accessible
import { Amplify } from 'aws-amplify';
// Import auth functions after Amplify to ensure they use the configured instance
import { signInWithRedirect } from 'aws-amplify/auth';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { useNavigate } from 'react-router-dom';
import { LoadingWheel } from '../components/LoadingWheel';
import { logger } from '../utils/logger';

export default function SignIn() {
  usePageTitle();
  const { isLoggedIn, loading } = useAuthStatus();
  const navigate = useNavigate();

  // Debug: Log URL parameters on mount (commented out - uncomment for debugging)
  // useEffect(() => {
  //   const urlParams = new URLSearchParams(window.location.search);
  //   const hashParams = new URLSearchParams(window.location.hash.substring(1));
  //   
  //   if (urlParams.toString() || hashParams.toString()) {
  //     logger.log('🔍 SignIn page loaded with URL params:', {
  //       search: Object.fromEntries(urlParams),
  //       hash: Object.fromEntries(hashParams),
  //       fullUrl: window.location.href
  //     });
  //   }
  // }, []);

  const signInWithGoogle = async () => {
    try {
      // Verify config is accessible
      const checkConfig = Amplify.getConfig();
      
      // Debug logging (commented out - uncomment for debugging)
      // logger.log('Pre-sign-in config check:', {
      //   hasAuth: !!checkConfig.Auth,
      //   hasCognito: !!checkConfig.Auth?.Cognito,
      //   hasRegion: !!checkConfig.Auth?.Cognito?.region,
      //   region: checkConfig.Auth?.Cognito?.region,
      //   userPoolId: checkConfig.Auth?.Cognito?.userPoolId,
      //   hasOAuth: !!checkConfig.Auth?.Cognito?.loginWith?.oauth,
      //   oauthDomain: checkConfig.Auth?.Cognito?.loginWith?.oauth?.domain
      // });
      
      // Type assertion needed because Amplify config types can be complex
      const cognitoConfig = checkConfig.Auth?.Cognito as { region?: string } | undefined;
      if (!cognitoConfig?.region) {
        alert('Authentication configuration error: Region is missing. Please refresh the page.');
        logger.error('Config at sign-in time:', checkConfig);
        return;
      }
      
      // WORKAROUND: Try to force auth module to see config by re-importing
      // This might help if there's a module resolution issue
      try {
        // Clear any cached module state
        await import('aws-amplify/auth');
        // logger.log('Auth module re-imported, checking config again...');
        
        // Verify config is still accessible after re-import
        const configAfterImport = Amplify.getConfig();
        // logger.log('Config after auth module import:', {
        //   hasAuth: !!configAfterImport.Auth,
        //   hasCognito: !!configAfterImport.Auth?.Cognito,
        //   hasRegion: !!configAfterImport.Auth?.Cognito?.region
        // });
        // Suppress unused variable warning
        void configAfterImport;
      } catch (importError) {
        logger.warn('Could not re-import auth module:', importError);
      }
      
      // logger.log('🚀 Initiating Google sign-in redirect...');
      // logger.log('📍 Current URL before redirect:', window.location.href);
      
      try {
        await signInWithRedirect({
          provider: 'Google'
        });
        // Note: signInWithRedirect will navigate away, so code after this won't run
        // logger.log('✅ signInWithRedirect called successfully (redirect should happen now)');
      } catch (redirectError) {
        logger.error('❌ Error during signInWithRedirect:', redirectError);
        throw redirectError; // Re-throw to be caught by outer catch
      }
    } catch (error) {
      // Keep error logging for actual errors
      logger.error('❌ Sign in error caught:', error);
      logger.error('❌ Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        fullError: error
      });
      
      // More detailed error messages
      if (error instanceof Error) {
        const errorMsg = error.message || 'Unknown error';
        // logger.error('❌ Error message:', errorMsg);
        alert(`Sign in failed: ${errorMsg}\n\nCheck the browser console for more details.`);
      } else {
        logger.error('❌ Non-Error object:', error);
        alert(`Sign in failed. Please check the browser console for details.\n\nError: ${JSON.stringify(error)}`);
      }
    }
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
