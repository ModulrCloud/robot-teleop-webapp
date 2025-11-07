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
import { Home } from "./pages/Home";
import { CreateRobotListing } from "./pages/CreateRobotListing";
import { UserProfile } from "./pages/UserProfile";

// Amplify configuration
import outputs from '../amplify_outputs.json';
import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';

Amplify.configure(outputs);

function App() {

  return (
    <Router>
      <div className="page-wrapper">
        <Navbar />
      </div>
      <main className="main-content">
        <Routes>
          <Route path='/' element={<Home />} />
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
        </Routes>
      </main>
    </Router>
  );
}

export default App;
