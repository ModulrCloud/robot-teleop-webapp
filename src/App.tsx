// import { useState } from 'react'
import './App.css'
import Navbar from './Navbar';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import SignIn from './pages/SignIn';
import RobotSelect from './pages/RobotSelect';
import ServiceSelect from './pages/ServiceSelect';
import Teleop from './pages/Teleop';


function App() {
  // const [count, setCount] = useState(0)
  // const {_, loadedModule} = useCapability({
  //   capability: '@transitive-robotics/remote-teleop',
  //   name: 'teleop',
  //   userId: 'modulr',
  //   deviceId: 'husarion',
  // });
  
  return (
    <Router>
    <div className='page-wrapper'>
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/robots" element={<RobotSelect />} />
          <Route path="/services" element={<ServiceSelect />} />
          <Route path="/teleop" element={<Teleop />} />
        </Routes>
      </main>
    </div>
    </Router>

  )

}

export default App
