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

  return (
    <Router>
        <div className="page-wrapper">
          <Navbar />
        </div>
        <main className="main-content">
          {name ? <p>Oh, hey, {name}!</p> : <p>Who's there?</p>}
          <Routes>
            <Route path='/' element={<p>You're home!</p>} />
            <Route path='/signin' element={<SignIn />} />

            {/* Authenticated Routes */}
            {name && (
              <>
                <Route path='/robots' element={<RobotSelect />} />
                <Route path='/services' element={<ServiceSelect />} />
                <Route path='/teleop' element={<Teleop />} />
              </>
            )}
          </Routes>
        </main>
    </Router>
  );
}

export default App;
