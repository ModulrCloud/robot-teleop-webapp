// import { useState } from 'react'
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
import { PrivateRoute } from "./PrivateRoute";
import { UserSetup } from "./pages/UserSetup";
import { Home } from "./pages/Home";

// Amplify information
import outputs from '../amplify_outputs.json';
import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';
import { useAuthStatus } from "./hooks/useAuthStatus";

Amplify.configure(outputs);

function App() {
  // const [count, setCount] = useState(0)
  // const {_, loadedModule} = useCapability({
  //   capability: '@transitive-robotics/remote-teleop',
  //   name: 'teleop',
  //   userId: 'modulr',
  //   deviceId: 'husarion',
  // });

  const { user } = useAuthStatus();
  const name = user?.displayName;
  const group = user?.group;

  return (
    <Router>
      <div className="page-wrapper">
        <Navbar />
      </div>
      <main className="main-content">
        {name ? <p>Oh, hey, {name}!</p> : <p>Who's there?</p>}
        {group ? <p>You've got a {group} group!</p> : <p>No group for you.</p>}
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
        </Routes>
      </main>
    </Router>
  );
}

export default App;
