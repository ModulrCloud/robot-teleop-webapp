import { useRef, useState } from "react";
import './ConfirmSignIn.css';
import { Button } from "react-bootstrap";

export default function ConfirmSignIn() {
  const [passcode, setPasscode] = useState(["", "", "", "", "", ""]);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const handleChange = (idx: number, value: string) => {
    if (!/^\d?$/.test(value)) return; // Only allow single digit
    const newPasscode = [...passcode];
    newPasscode[idx] = value;
    setPasscode(newPasscode);

    // Move to next input if value entered
    if (value && idx < 5) {
      inputsRef.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !passcode[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (paste.length === 6) {
      setPasscode(paste.split(""));
      inputsRef.current[5]?.focus();
      e.preventDefault();
    }
  };

  return (
    <div className="confirm-container">
      <h2>Confirm Passcode</h2>
      <div className="passcode-inputs">
        {passcode.map((digit, idx) => (
          <input
            key={idx}
            type="password"
            inputMode="numeric"
            maxLength={1}
            className="passcode-box"
            value={digit}
            onChange={e => handleChange(idx, e.target.value)}
            onKeyDown={e => handleKeyDown(idx, e)}
            onPaste={handlePaste}
            ref={el => {
              inputsRef.current[idx] = el;
            }}
            autoFocus={idx === 0}
          />
        ))}
      </div>
      <Button href="/robots" className="signin-otp-btn button-yellow" type="button">
        Confirm
      </Button>
    </div>
  );
}
