// import { useState } from 'react'
import "./App.css";
import Navbar from "./Navbar";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import ConfirmSignIn from "./pages/ConfirmSignIn";
import EndSession from "./pages/EndSession";
import RobotSelect from "./pages/RobotSelect";
import ServiceSelect from "./pages/ServiceSelect";
import SignIn from "./pages/SignIn";
import Teleop from "./pages/Teleop";
import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

type TitleUpdaterProps = {
  setIsLoggedIn: (loggedIn: boolean) => void;
};

function TitleUpdater({ setIsLoggedIn }: TitleUpdaterProps) {
  const location = useLocation();

  useEffect(() => {
    switch (location.pathname) {
      case "/confirm":
        setIsLoggedIn(false);
        document.title = "Confirm Passcode | Modulr";
        break;
      case "/signin":
        setIsLoggedIn(false);
        document.title = "Sign In | Modulr";
        break;
      case "/robots":
        setIsLoggedIn(true);
        document.title = "Robots | Modulr";
        break;
      case "/services":
        setIsLoggedIn(true);
        document.title = "Services | Modulr";
        break;
      case "/teleop":
        setIsLoggedIn(true);
        document.title = "Teleop | Modulr";
        break;
      case "/endsession":
        setIsLoggedIn(false);
        document.title = "End Session | Modulr";
        break;
      default:
        setIsLoggedIn(false);
        document.title = "Home | Modulr";
    }
  }, [location.pathname]);

  return null;
}

const client = generateClient<Schema>();

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    client.models.Todo.observeQuery().subscribe({
      // next: (data) => setTodos([...data.items]),
    });
  }, []);
  // const [count, setCount] = useState(0)
  // const {_, loadedModule} = useCapability({
  //   capability: '@transitive-robotics/remote-teleop',
  //   name: 'teleop',
  //   userId: 'modulr',
  //   deviceId: 'husarion',
  // });

  return (
    <Router>
      <TitleUpdater setIsLoggedIn={setIsLoggedIn} />
      <div className="page-wrapper">
        <Navbar isLoggedIn={isLoggedIn} />
        <main className="main-content">
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/confirm" element={<ConfirmSignIn />} />
            <Route path="/robots" element={<RobotSelect />} />
            <Route path="/services" element={<ServiceSelect />} />
            <Route path="/teleop" element={<Teleop />} />
            <Route path="/endsession" element={<EndSession />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
