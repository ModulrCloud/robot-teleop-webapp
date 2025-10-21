import { useState } from "react";
import './SignIn.css';
import { Button } from "react-bootstrap";

export default function SignIn() {
  const [email, setEmail] = useState("");
  return (
    <div className="signin-container">
      <h2>Sign In</h2>
      <input
        type="email"
        className="signin-email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button href="/confirm" className="signin-otp-btn button-yellow" type="button">
        Send One Time Passcode
      </Button>
    </div>
  );
}
