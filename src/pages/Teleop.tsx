import { Button } from "react-bootstrap";
import Joystick, { type JoystickChange } from "../components/Joystick";
import "./Teleop.css";

export default function Teleop() {
  const handleJoystickChange = (_: JoystickChange) => {
    // TODO: wire to robot control
  }

  return (
    <div style={{ position: "relative" }}>
      <h2>Control Your Robot</h2>
      <div className="teleop-layout">
        <div className="teleop-video">
          <iframe width="560" height="315" src="https://www.youtube.com/embed/MbOy-0mxhaI?si=C5lar3DmAjgbpkL1&controls=0&autoplay=1" title="YouTube video player" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen></iframe>
        </div>
        <div className="teleop-controls">
          <Joystick onChange={handleJoystickChange} />
        </div>
      </div>

      <div className="endsession-wrapper">
        <Button
          className="button-yellow endsession-button"
          id="end-button"
          href="/endsession"
        >
          End Session
        </Button>

      </div>
    </div>
  );
}
