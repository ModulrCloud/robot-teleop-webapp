import { useState } from "react";
import './SignIn.css';
import { Button } from "react-bootstrap";
import { signInWithRedirect } from 'aws-amplify/auth';

export default function SignIn() {
  const [email, setEmail] = useState("");

  const onSubmitEmail = async () => {
    console.log(`You tried to sign in with email: ${email}`);
    await signInWithRedirect({
      provider: 'Google'
    });
  }

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
      <Button onClick={onSubmitEmail} className="signin-otp-btn button-yellow" type="button">
        Send One Time Passcode
      </Button>
    </div>
  );
}
