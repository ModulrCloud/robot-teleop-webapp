import "./App.css";
import Navbar from "./Navbar";
import {
  BrowserRouter as Router,
  Routes,
  Route,
} from "react-router-dom";
import RobotSelect from "./pages/RobotSelect";
import ServiceSelect from "./pages/ServiceSelect";
import SignIn from "./pages/SignIn";
import Teleop from "./pages/Teleop";
import EndSession from "./pages/EndSession";
import { PrivateRoute } from "./PrivateRoute";
import { UserSetup } from "./pages/UserSetup";
import { Dashboard } from "./pages/Dashboard";
import { CreateRobotListing } from "./pages/CreateRobotListing";
import { UserProfile } from "./pages/UserProfile";
import { SessionHistory } from "./pages/SessionHistory";
import { AppLayout } from "./components/AppLayout";
import { Settings } from "./pages/Settings";
import { Credits } from "./pages/Credits";
import RobotSetup from "./pages/RobotSetup";
import { EditRobot } from "./pages/EditRobot";
import MyRobots from "./pages/MyRobots";
import { useEffect } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import PartnerProfile from './pages/PartnerProfile';
import EditPartnerProfile from './pages/EditPartnerProfile';
import { DebugPanel } from './components/DebugPanel';
import { logger } from './utils/logger';

// Amplify configuration is now in main.tsx
import '@aws-amplify/ui-react/styles.css';

function App() {
  // Debug: Log OAuth callback handling (commented out - uncomment for debugging)
  useEffect(() => {
    // Check if we're coming back from OAuth redirect
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    
    // const code = urlParams.get('code') || hashParams.get('code'); // Unused for now
    const error = urlParams.get('error') || hashParams.get('error');
    const errorDescription = urlParams.get('error_description') || hashParams.get('error_description');
    
    // if (code) {
    //   console.log('🔵 OAuth callback detected - Authorization code received:', {
    //     code: code.substring(0, 20) + '...',
    //     fullUrl: window.location.href,
    //     searchParams: Object.fromEntries(urlParams),
    //     hashParams: Object.fromEntries(hashParams)
    //   });
    // }
    
    if (error) {
      // Keep error logging for actual errors
      logger.error('🔴 OAuth callback error:', {
        error,
        errorDescription: decodeURIComponent(errorDescription || ''),
        fullUrl: window.location.href,
        searchParams: Object.fromEntries(urlParams),
        hashParams: Object.fromEntries(hashParams)
      });
      
      // Try to get more details from the session
      fetchAuthSession().then(() => {
        // logger.log('Session after OAuth error:', session);
      }).catch(err => {
        logger.error('Failed to fetch session after OAuth error:', err);
      });
    }
    
    // Log current URL for debugging (commented out)
    // if (window.location.search || window.location.hash) {
    //   console.log('📍 Current URL:', window.location.href);
    //   console.log('📍 Search params:', Object.fromEntries(urlParams));
    //   console.log('📍 Hash params:', Object.fromEntries(hashParams));
    // }
  }, []);

  return (
    <Router>
      <Navbar />
      <AppLayout>
        <main className="main-content">
          <Routes>
            <Route path='/' element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            } />
            <Route path='/signin' element={<SignIn />} />

            {/* Authenticated Routes */}
            <Route path='/user-setup' element={
              <PrivateRoute>
                <UserSetup />
              </PrivateRoute>
            }
            />
            <Route path='/profile' element={
              <PrivateRoute>
                <UserProfile />
              </PrivateRoute>
            }
            />
            <Route path='/create-robot-listing' element={
              <PrivateRoute>
                <CreateRobotListing />
              </PrivateRoute>
            }
            />
            <Route path='/robot-setup' element={
              <PrivateRoute>
                <RobotSetup />
              </PrivateRoute>
            }
            />
            <Route path='/edit-robot' element={
              <PrivateRoute>
                <EditRobot />
              </PrivateRoute>
            }
            />
            <Route path='/my-robots' element={
              <PrivateRoute>
                <MyRobots />
              </PrivateRoute>
            }
            />
            <Route path='/robots' element={
              <PrivateRoute>
                <RobotSelect />
              </PrivateRoute>
            }
            />
            <Route path='/services' element={
              <PrivateRoute>
                <ServiceSelect />
              </PrivateRoute>
            }
            />
            <Route path='/teleop' element={
              <PrivateRoute>
                <Teleop />
              </PrivateRoute>
            }
            />
            <Route path='/endsession' element={
              <PrivateRoute>
                <EndSession />
              </PrivateRoute>
            }
            />
            <Route path='/sessions' element={
              <PrivateRoute>
                <SessionHistory />
              </PrivateRoute>
            }
            />
            <Route path='/settings' element={
              <PrivateRoute>
                <Settings />
              </PrivateRoute>
            } 
            />
            <Route path='/credits' element={
              <PrivateRoute>
                <Credits />
              </PrivateRoute>
            } 
            />
            <Route path='/partner/:partnerId' element={
              <PrivateRoute>
                <PartnerProfile />
              </PrivateRoute>
            }
            />
            <Route path='/partner-profile/edit' element={
              <PrivateRoute>
                <EditPartnerProfile />
              </PrivateRoute>
            }
            />
          </Routes>
        </main>
      </AppLayout>
      {(import.meta.env.DEV || import.meta.env.VITE_SHOW_DEBUG_PANEL === 'true') && <DebugPanel />}
    </Router>
  );
}

export default App;
