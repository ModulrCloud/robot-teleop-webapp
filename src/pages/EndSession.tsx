import { Button } from "react-bootstrap";
import "./EndSession.css";

export default function EndSession() {
  return (
    <div className="endsession-container">
      <h2>Session Complete!</h2>
      <p>Total session duration: <b>0h 0m 19s</b></p>
      <p>Total session cost: <b>14435 MTR</b></p>
      <p className="padtop"><i>Thank you for using Modulr!</i></p>
      <Button
        className="button-yellow start-again-button"
        href="/signin"
      >
        Start a New Session
      </Button>
    </div>
  );
}
