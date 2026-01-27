import "./App.css";
import Navbar from "./Navbar";
import {
  BrowserRouter as Router,
  Routes,
  Route,
} from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { PrivateRoute } from "./PrivateRoute";
import { AppLayout } from "./components/AppLayout";
import { RouteLoadingSpinner } from "./components/RouteLoadingSpinner";
import { logger } from './utils/logger';

// Lazy load all page components for code splitting
const Dashboard = lazy(() => import("./pages/Dashboard").then(module => ({ default: module.Dashboard })));
const SignIn = lazy(() => import("./pages/SignIn"));
const UserSetup = lazy(() => import("./pages/UserSetup").then(module => ({ default: module.UserSetup })));
const UserProfile = lazy(() => import("./pages/UserProfile").then(module => ({ default: module.UserProfile })));
const CreateRobotListing = lazy(() => import("./pages/CreateRobotListing").then(module => ({ default: module.CreateRobotListing })));
const RobotSetup = lazy(() => import("./pages/RobotSetup"));
const EditRobot = lazy(() => import("./pages/EditRobot").then(module => ({ default: module.EditRobot })));
const MyRobots = lazy(() => import("./pages/MyRobots"));
const RobotSelect = lazy(() => import("./pages/RobotSelect"));
const RobotDetail = lazy(() => import("./pages/RobotDetail"));
const ServiceSelect = lazy(() => import("./pages/ServiceSelect"));
const Teleop = lazy(() => import("./pages/Teleop"));
const EndSession = lazy(() => import("./pages/EndSession"));
const SessionHistory = lazy(() => import("./pages/SessionHistory").then(module => ({ default: module.SessionHistory })));
const Settings = lazy(() => import("./pages/Settings").then(module => ({ default: module.Settings })));
const Credits = lazy(() => import("./pages/Credits").then(module => ({ default: module.Credits })));
const Admin = lazy(() => import("./pages/Admin").then(module => ({ default: module.Admin })));
const PartnerProfile = lazy(() => import("./pages/PartnerProfile"));
const EditPartnerProfile = lazy(() => import("./pages/EditPartnerProfile"));
const Social = lazy(() => import("./pages/Social").then(module => ({ default: module.Social })));
const DebugPanel = lazy(() => import("./components/DebugPanel").then(module => ({ default: module.DebugPanel })));

// Amplify configuration is now in main.tsx
import '@aws-amplify/ui-react/styles.css';

function App() {
  // Handle OAuth callback errors
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    
    const error = urlParams.get('error') || hashParams.get('error');
    const errorDescription = urlParams.get('error_description') || hashParams.get('error_description');
    
    if (error) {
      logger.error('OAuth callback error:', {
        error,
        errorDescription: decodeURIComponent(errorDescription || ''),
      });
      
      fetchAuthSession().catch(err => {
        logger.error('Failed to fetch session after OAuth error:', err);
      });
    }
  }, []);

  return (
    <Router>
      <Navbar />
      <AppLayout>
        <main className="main-content">
          <Routes>
            <Route path='/' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <Dashboard />
                </PrivateRoute>
              </Suspense>
            } />
            <Route path='/signin' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <SignIn />
              </Suspense>
            } />

            {/* Authenticated Routes */}
            <Route path='/user-setup' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <UserSetup />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/profile' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <UserProfile />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/create-robot-listing' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <CreateRobotListing />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/robot-setup' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <RobotSetup />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/edit-robot' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <EditRobot />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/my-robots' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <MyRobots />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/robots' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <RobotSelect />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/robot/:robotId' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <RobotDetail />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/services' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <ServiceSelect />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/teleop' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <Teleop />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/endsession' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <EndSession />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/sessions' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <SessionHistory />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/settings' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <Settings />
                </PrivateRoute>
              </Suspense>
            } 
            />
            <Route path='/credits' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <Credits />
                </PrivateRoute>
              </Suspense>
            } 
            />
            <Route path='/admin' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <Admin />
                </PrivateRoute>
              </Suspense>
            } 
            />
            <Route path='/partner/:partnerId' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <PartnerProfile />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/partner-profile/edit' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <EditPartnerProfile />
                </PrivateRoute>
              </Suspense>
            }
            />
            <Route path='/social' element={
              <Suspense fallback={<RouteLoadingSpinner />}>
                <PrivateRoute>
                  <Social />
                </PrivateRoute>
              </Suspense>
            }
            />
          </Routes>
        </main>
      </AppLayout>
      <Suspense fallback={null}>
        <DebugPanel />
      </Suspense>
    </Router>
  );
}

export default App;
