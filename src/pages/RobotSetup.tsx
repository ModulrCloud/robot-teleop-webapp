import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { usePageTitle } from '../hooks/usePageTitle';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRobot,
  faCopy,
  faCheckCircle,
  faArrowLeft,
  faInfoCircle,
  faKey,
  faSyncAlt
} from '@fortawesome/free-solid-svg-icons';
import outputs from '../../amplify_outputs.json';
import './RobotSetup.css';
import { logger } from '../utils/logger';

const client = generateClient<Schema>();

interface AmplifyOutputsWithCustom {
  custom?: {
    robotEnrollment?: {
      registrationUrl?: string;
    };
  };
}

const registrationUrl: string | undefined = (outputs as AmplifyOutputsWithCustom).custom?.robotEnrollment?.registrationUrl;

export default function RobotSetup() {
  usePageTitle();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const robotUuid = searchParams.get('robotId'); // This is the Robot.id (UUID)
  const [robotId, setRobotId] = useState<string>(''); // This is the robotId field (robot-XXXXXXXX)
  const [wsUrl, setWsUrl] = useState<string>('');
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
  const [enrollmentTokenExpiry, setEnrollmentTokenExpiry] = useState<number | null>(null);
  const [robotPublicKey, setRobotPublicKey] = useState<string | null>(null);
  const [isRegeneratingToken, setIsRegeneratingToken] = useState(false);
  const [copiedRosbridge, setCopiedRosbridge] = useState(false);
  const [copiedInitialSetup, setCopiedInitialSetup] = useState(false);
  const [copiedStartCommand, setCopiedStartCommand] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scroll to top when navigating to this page (avoids ending up at bottom from restoration or layout)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const loadRobot = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!robotUuid) {
          setError('No robot ID provided. Please go back and select a robot.');
          setLoading(false);
          return;
        }

        try {
          const robot = await client.models.Robot.get({ id: robotUuid });
          if (!robot.data?.robotId) {
            setError('Robot ID not found. The robot may not be properly configured.');
            setLoading(false);
            return;
          }
          setRobotId(robot.data.robotId);
          setEnrollmentToken(robot.data.enrollmentToken ?? null);
          setEnrollmentTokenExpiry(robot.data.enrollmentTokenExpiry ?? null);
          setRobotPublicKey(robot.data.publicKey ?? null);
        } catch (robotError) {
          logger.error('Error loading robot:', robotError);
          setError('Failed to load robot information. Please try again.');
          setLoading(false);
          return;
        }

        const signalingWsUrl = outputs?.custom?.signaling?.websocketUrl;
        if (!signalingWsUrl) {
          setError('WebSocket URL not found. Make sure the Amplify sandbox is running.');
          setLoading(false);
          return;
        }
        setWsUrl(signalingWsUrl);
      } catch (err) {
        logger.error('Error loading robot setup:', err);
        setError('Failed to load setup information. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadRobot();
  }, [robotUuid]);

  const handleRegenerateToken = async () => {
    if (!robotUuid) return;
    setIsRegeneratingToken(true);
    try {
      const result = await client.mutations.regenerateEnrollmentToken({ robotId: robotUuid });
      if (result.data) {
        setEnrollmentToken(result.data.token);
        setEnrollmentTokenExpiry(result.data.expiry);
      }
    } catch (err) {
      logger.error('Failed to regenerate enrollment token:', err);
    } finally {
      setIsRegeneratingToken(false);
    }
  };

  const tokenIsValid = enrollmentToken && enrollmentTokenExpiry && Date.now() < enrollmentTokenExpiry;

  const initialSetupCommand = robotId && wsUrl && tokenIsValid && registrationUrl
    ? `cargo run -- initial-setup --robot-id ${robotId} --signaling-url "${wsUrl}" --enrollment-url "${registrationUrl}" --enrollment-token ${enrollmentToken} --video-source ros --image-format jpeg`
    : '';

  if (!robotUuid) {
    return (
      <div className="robot-setup-page">
        <div className="setup-container">
          <div className="error-message">
            <FontAwesomeIcon icon={faInfoCircle} />
            <p>No robot ID provided. Please go back and select a robot.</p>
            <button onClick={() => navigate('/my-robots')} className="btn-primary">
              <FontAwesomeIcon icon={faArrowLeft} />
              Back to My Robots
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="robot-setup-page">
      <div className="setup-container">
        <div className="setup-header">
          <div className="header-icon">
            <FontAwesomeIcon icon={faRobot} />
          </div>
          <div className="header-content">
            <h1>Robot Setup Instructions</h1>
            <p>Configure your robot to connect to the Modulr platform</p>
          </div>
        </div>

        {error && (
          <div className="error-banner">
            <FontAwesomeIcon icon={faInfoCircle} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="loading-section">
            <p>Generating connection URL...</p>
          </div>
        ) : (
          <>
            <div className="setup-section">
              <h2>Before you begin</h2>
              <p className="section-description">
                Install the <strong>Modulr robot agent</strong> on your robot so it can connect to the platform. Clone and build the agent, then follow the steps below.
              </p>
              <p>
                <a
                  href="https://github.com/ModulrCloud/modulr-agent"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="setup-link"
                >
                  Get the Modulr agent (GitHub)
                </a>
                {' '}
                — follow the README for prerequisites (Rust, GStreamer, ROS) and build instructions.
              </p>
            </div>

            <div className="setup-section">
              <h2>Step 1: Dependencies (ROS video source)</h2>
              <p className="section-description">
                If using ROS 2 with the ROS video source, start rosbridge first. It&apos;s needed for the video stream.
              </p>
              <div className="codeblock-wrapper" style={{ marginTop: '0.75rem' }}>
                <div className="codeblock-header">
                  <span className="codeblock-lang">Terminal</span>
                  <button
                    type="button"
                    onClick={async () => {
                      const cmd = 'ros2 launch rosbridge_server rosbridge_websocket_launch.xml';
                      try {
                        await navigator.clipboard.writeText(cmd);
                        setCopiedRosbridge(true);
                        setTimeout(() => setCopiedRosbridge(false), 2000);
                      } catch (err) {
                        logger.error('Failed to copy:', err);
                      }
                    }}
                    className={`codeblock-copy-btn ${copiedRosbridge ? 'copied' : ''}`}
                    title="Copy rosbridge launch command"
                  >
                    {copiedRosbridge ? (
                      <>
                        <FontAwesomeIcon icon={faCheckCircle} />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <FontAwesomeIcon icon={faCopy} />
                        <span>Copy code</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="codeblock-body">
                  <pre className="codeblock-pre">ros2 launch rosbridge_server rosbridge_websocket_launch.xml</pre>
                </div>
              </div>
            </div>

            <div className="setup-section">
              <h2>Step 2: Run initial setup on your robot</h2>
              <p className="section-description">
                On your robot (in the Modulr agent project directory), run the command below. It saves your Robot ID, signaling URL, and a one-time enrollment token into the agent config file (default: <code>~/.config/modulr_agent/config.json</code>). The agent will generate an Ed25519 keypair and register its public key automatically. To use a specific file (e.g. <code>./local_config.json</code>), add <code>--config-override ./local_config.json</code> before <code>--video-source</code>.
              </p>

              {robotPublicKey ? (
                <div className="url-note" style={{ marginTop: '0.75rem' }}>
                  <FontAwesomeIcon icon={faKey} />
                  {' '}Robot is enrolled — PKI key registered. The robot will connect using keypair authentication.
                </div>
              ) : tokenIsValid ? (
                <>
                  <div className="codeblock-wrapper" style={{ marginTop: '0.75rem' }}>
                    <div className="codeblock-header">
                      <span className="codeblock-lang">Terminal</span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!initialSetupCommand) return;
                          try {
                            await navigator.clipboard.writeText(initialSetupCommand);
                            setCopiedInitialSetup(true);
                            setTimeout(() => setCopiedInitialSetup(false), 2000);
                          } catch (err) {
                            logger.error('Failed to copy:', err);
                          }
                        }}
                        className={`codeblock-copy-btn ${copiedInitialSetup ? 'copied' : ''}`}
                        title="Copy initial-setup command"
                        disabled={!initialSetupCommand}
                      >
                        {copiedInitialSetup ? (
                          <>
                            <FontAwesomeIcon icon={faCheckCircle} />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <FontAwesomeIcon icon={faCopy} />
                            <span>Copy code</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="codeblock-body">
                      <pre className="codeblock-pre">{initialSetupCommand}</pre>
                    </div>
                  </div>
                  <p className="url-note" style={{ marginTop: '0.75rem' }}>
                    <FontAwesomeIcon icon={faInfoCircle} />
                    {' '}Enrollment token expires {enrollmentTokenExpiry ? new Date(enrollmentTokenExpiry).toLocaleString() : ''}. It is one-time use and will be consumed when the robot registers its key.
                  </p>
                </>
              ) : (
                <div style={{ marginTop: '0.75rem' }}>
                  <p className="url-note">
                    <FontAwesomeIcon icon={faInfoCircle} />
                    {' '}Enrollment token has expired or been used.
                  </p>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleRegenerateToken}
                    disabled={isRegeneratingToken}
                    style={{ marginTop: '0.5rem' }}
                  >
                    <FontAwesomeIcon icon={faSyncAlt} />
                    {' '}{isRegeneratingToken ? 'Regenerating...' : 'Regenerate Enrollment Token'}
                  </button>
                </div>
              )}
            </div>

            <div className="setup-section">
              <h2>Step 3: Configure and run your robot</h2>
              <div className="instructions">
                <div className="instruction-step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h3>Run the command above on your robot</h3>
                    <p>In the directory where you cloned and built the <a href="https://github.com/ModulrCloud/modulr-agent" target="_blank" rel="noopener noreferrer" className="setup-link">Modulr agent</a>, run the initial-setup command from Step 2. It will save your Robot ID and signaling URL into the config file.</p>
                  </div>
                </div>

                <div className="instruction-step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h3>Register your robot</h3>
                    <p>When you start the agent (Step 4 below), it will connect to the signaling server and register automatically. No extra step needed.</p>
                  </div>
                </div>

                <div className="instruction-step">
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <h3>Start the Agent</h3>
                    <p>Run the agent on your robot. Use the same config path you used for initial-setup (e.g. default <code>~/.config/modulr_agent/config.json</code> or <code>./local_config.json</code> if you used <code>--config-override</code>).</p>
                    <div className="codeblock-wrapper" style={{ marginTop: '0.75rem' }}>
                      <div className="codeblock-header">
                        <span className="codeblock-lang">Terminal</span>
                        <button
                          type="button"
                          onClick={async () => {
                            const startCommand = 'cargo run -- -vvv start';
                            try {
                              await navigator.clipboard.writeText(startCommand);
                              setCopiedStartCommand(true);
                              setTimeout(() => setCopiedStartCommand(false), 2000);
                            } catch (err) {
                              logger.error('Failed to copy:', err);
                            }
                          }}
                          className={`codeblock-copy-btn ${copiedStartCommand ? 'copied' : ''}`}
                          title="Copy start command"
                        >
                          {copiedStartCommand ? (
                            <>
                              <FontAwesomeIcon icon={faCheckCircle} />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <FontAwesomeIcon icon={faCopy} />
                              <span>Copy code</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="codeblock-body">
                        <pre className="codeblock-pre">cargo run -- -vvv start</pre>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="instruction-step">
                  <div className="step-number">4</div>
                  <div className="step-content">
                    <h3>Verify Connection</h3>
                    <p>Once connected and registered, your robot will appear as "online" in the Modulr platform. You can verify the connection by:</p>
                    <ul>
                      <li>Checking the robot status in your dashboard</li>
                      <li>Attempting to start a teleoperation session</li>
                      <li>Monitoring the robot's connection logs</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="setup-section">
              <h2>Example Code</h2>
              <p className="section-description">
                Here's a simple example of how to connect your robot (Python):
              </p>
              <div className="codeblock-wrapper codeblock-large">
                <div className="codeblock-header">
                  <span className="codeblock-lang">Python</span>
                  <button
                    type="button"
                    onClick={async () => {
                      const codeText = `import websocket
import json
import time
import threading

# Your connection URL (from above)
WS_URL = "${wsUrl}"
ROBOT_ID = "${robotId}"

# Global flag to control connection lifetime
should_close = False

def on_message(ws, message):
    print(f"")
    print(f"📥 RECEIVED MESSAGE FROM SERVER:")
    print(f"   Raw message: {message}")
    print(f"   Message length: {len(message)} characters")
    try:
        msg = json.loads(message)
        msg_type = msg.get("type", "")
        print(f"   Parsed type: {msg_type}")
        print(f"   Full parsed message: {json.dumps(msg, indent=2)}")
        
        # Handle different message types
        if msg_type == "offer":
            sender_id = msg.get('from', 'unknown')
            sdp_offer = msg.get('sdp', '')
            print(f"  → ✅ Received offer from {sender_id}")
            print(f"  → SDP offer length: {len(sdp_offer)} characters")
            if sdp_offer:
                print(f"  → SDP preview: {sdp_offer[:100]}...")
            # IMPORTANT: The 'from' field contains the browser's connection ID (e.g., "Uxqj_cTxoAMCKcw=")
            # In production, this is the actual WebSocket connection ID assigned by AWS API Gateway
            # We use this connection ID in the 'to' field when replying so the server knows where to forward the message
            print(f"  → Will reply to connection ID: {sender_id}")
            # In a real robot, you would:
            # 1. Process the SDP offer
            # 2. Create a WebRTC answer using a WebRTC peer connection
            # 3. Send the answer back using the connection ID from the 'from' field
            # 
            # NOTE: This test script sends a minimal SDP answer format.
            # The browser will receive it but the WebRTC connection won't actually work
            # because we're not using a real WebRTC peer connection.
            # This is just for testing the signaling flow, not the actual WebRTC connection.
            if not should_close:
                # Create a minimal valid SDP answer format
                # This won't establish a real connection, but it won't crash the browser
                minimal_sdp_answer = f"""v=0
o=- 0 0 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:test
a=ice-pwd:test
a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144"""
                
                answer_msg = {
                    "type": "answer",
                    "from": ROBOT_ID,  # Use "from" not "robotId"
                    "to": sender_id,  # Reply to the sender using their connection ID
                    "sdp": minimal_sdp_answer  # Minimal valid SDP format (won't work for real connection)
                }
                ws.send(json.dumps(answer_msg))
                print(f"  → ✅ Sent answer to {sender_id} (minimal SDP - for signaling test only)")
                print(f"  → ⚠️  Note: This won't establish a real WebRTC connection")
                print(f"  →    A real robot would use a WebRTC peer connection to create a proper answer")
        elif msg_type == "candidate":  # Use "candidate" not "ice-candidate"
            sender_id = msg.get('from', 'unknown')
            print(f"  → Received ICE candidate from {sender_id}")
            candidate = msg.get("candidate", {})
            print(f"  → Candidate: {str(candidate)[:50]}...")
            # IMPORTANT: The 'from' field contains the browser's connection ID
            # We use this connection ID in the 'to' field when replying
            # In a real robot, you would add this candidate to your WebRTC peer connection
            # For testing, send a mock ICE candidate back
            if not should_close:
                candidate_msg = {
                    "type": "candidate",  # Use "candidate" not "ice-candidate"
                    "from": ROBOT_ID,  # Use "from" not "robotId"
                    "to": sender_id,  # Reply to the sender using their connection ID
                    "candidate": {  # Candidate object directly, not nested in payload
                        "candidate": "mock-ice-candidate-from-robot",
                        "sdpMLineIndex": 0,
                        "sdpMid": "0"
                    }
                }
                ws.send(json.dumps(candidate_msg))
                print(f"  → Sent mock ICE candidate to {sender_id}")
        elif msg_type == "monitor-confirmed":
            print(f"  → Monitor subscription confirmed")
        else:
            print(f"  → Unknown message type: {msg_type}")
    except json.JSONDecodeError:
        print(f"  → Received non-JSON message")

def on_error(ws, error):
    print(f"Error: {error}")

def on_close(ws, close_status_code, close_msg):
    print("Connection closed")

def on_open(ws):
    print("✅ Connected to WebSocket server!")
    print(f"   Connection URL: {WS_URL}")
    print(f"   Robot ID: {ROBOT_ID}")
    
    # Register the robot immediately
    register_msg = {
        "type": "register",
        "from": ROBOT_ID  # Use "from" not "robotId" (matches Rust agent format)
    }
    print(f"📤 Sending registration message: {json.dumps(register_msg)}")
    ws.send(json.dumps(register_msg))
    print(f"✅ Registration message sent for robot: {ROBOT_ID}")
    print(f"✅ Robot is now online and waiting for browser connections...")
    print(f"   To test: Open the Teleop page in your browser and start a session")
    print(f"   The robot will automatically respond to offers from browsers")
    print(f"")
    print(f"🔍 DEBUG: Watch for incoming messages below...")
    print(f"   Any message from the server will appear as 'Received: ...'")
    print(f"")
    
    # Send periodic keepalive messages to show robot is still active
    # In production, robots typically send keepalives every 30-60 seconds
    def send_keepalive():
        while not should_close:
            time.sleep(30)  # Send keepalive every 30 seconds
            if not should_close:
                keepalive_msg = {
                    "type": "register",  # Re-register to show robot is still active
                    "from": ROBOT_ID  # Use "from" not "robotId" (matches Rust agent format)
                }
                ws.send(json.dumps(keepalive_msg))
                print(f"📡 Keepalive sent (robot still online)")
    
    threading.Thread(target=send_keepalive, daemon=True).start()

# Connect to WebSocket
ws = websocket.WebSocketApp(
    WS_URL,
    on_message=on_message,
    on_error=on_error,
    on_close=on_close,
    on_open=on_open
)

# Run in a separate thread so we can control when to close
def run_websocket():
    ws.run_forever()

thread = threading.Thread(target=run_websocket, daemon=True)
thread.start()

# Keep connection open indefinitely (robot waits for browser connections)
# In production, the robot would run continuously until shutdown
# Press Ctrl+C to stop
print("\\n🤖 Robot is running and waiting for browser connections...")
print("   Press Ctrl+C to stop the robot\\n")
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\\n🛑 Stopping robot...")
    should_close = True
    ws.close()
    print("✅ Robot disconnected")`;
                    try {
                      await navigator.clipboard.writeText(codeText);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    } catch (err) {
                      logger.error('Failed to copy:', err);
                    }
                  }}
                    className={`codeblock-copy-btn ${copiedCode ? 'copied' : ''}`}
                    title="Copy Example Code"
                  >
                    {copiedCode ? (
                      <>
                        <FontAwesomeIcon icon={faCheckCircle} />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <FontAwesomeIcon icon={faCopy} />
                        <span>Copy code</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="codeblock-body">
                  <pre className="codeblock-pre">
{`import websocket
import json
import time
import threading

# Your connection URL (from above)
WS_URL = "${wsUrl}"
ROBOT_ID = "${robotId}"

# Global flag to control connection lifetime
should_close = False

def on_message(ws, message):
    print(f"")
    print(f"📥 RECEIVED MESSAGE FROM SERVER:")
    print(f"   Raw message: {message}")
    print(f"   Message length: {len(message)} characters")
    try:
        msg = json.loads(message)
        msg_type = msg.get("type", "")
        print(f"   Parsed type: {msg_type}")
        print(f"   Full parsed message: {json.dumps(msg, indent=2)}")
        
        # Handle different message types
        if msg_type == "offer":
            sender_id = msg.get('from', 'unknown')
            sdp_offer = msg.get('sdp', '')
            print(f"  → ✅ Received offer from {sender_id}")
            print(f"  → SDP offer length: {len(sdp_offer)} characters")
            if sdp_offer:
                print(f"  → SDP preview: {sdp_offer[:100]}...")
            # IMPORTANT: The 'from' field contains the browser's connection ID (e.g., "Uxqj_cTxoAMCKcw=")
            # In production, this is the actual WebSocket connection ID assigned by AWS API Gateway
            # We use this connection ID in the 'to' field when replying so the server knows where to forward the message
            print(f"  → Will reply to connection ID: {sender_id}")
            # In a real robot, you would:
            # 1. Process the SDP offer
            # 2. Create a WebRTC answer using a WebRTC peer connection
            # 3. Send the answer back using the connection ID from the 'from' field
            # 
            # NOTE: This test script sends a minimal SDP answer format.
            # The browser will receive it but the WebRTC connection won't actually work
            # because we're not using a real WebRTC peer connection.
            # This is just for testing the signaling flow, not the actual WebRTC connection.
            if not should_close:
                # Create a minimal valid SDP answer format
                # This won't establish a real connection, but it won't crash the browser
                minimal_sdp_answer = f"""v=0
o=- 0 0 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:test
a=ice-pwd:test
a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144"""
                
                answer_msg = {
                    "type": "answer",
                    "from": ROBOT_ID,  # Use "from" not "robotId"
                    "to": sender_id,  # Reply to the sender using their connection ID
                    "sdp": minimal_sdp_answer  # Minimal valid SDP format (won't work for real connection)
                }
                ws.send(json.dumps(answer_msg))
                print(f"  → ✅ Sent answer to {sender_id} (minimal SDP - for signaling test only)")
                print(f"  → ⚠️  Note: This won't establish a real WebRTC connection")
                print(f"  →    A real robot would use a WebRTC peer connection to create a proper answer")
        elif msg_type == "candidate":  # Use "candidate" not "ice-candidate"
            sender_id = msg.get('from', 'unknown')
            print(f"  → Received ICE candidate from {sender_id}")
            candidate = msg.get("candidate", {})
            print(f"  → Candidate: {str(candidate)[:50]}...")
            # IMPORTANT: The 'from' field contains the browser's connection ID
            # We use this connection ID in the 'to' field when replying
            # In a real robot, you would add this candidate to your WebRTC peer connection
            # For testing, send a mock ICE candidate back
            if not should_close:
                candidate_msg = {
                    "type": "candidate",  # Use "candidate" not "ice-candidate"
                    "from": ROBOT_ID,  # Use "from" not "robotId"
                    "to": sender_id,  # Reply to the sender using their connection ID
                    "candidate": {  # Candidate object directly, not nested in payload
                        "candidate": "mock-ice-candidate-from-robot",
                        "sdpMLineIndex": 0,
                        "sdpMid": "0"
                    }
                }
                ws.send(json.dumps(candidate_msg))
                print(f"  → Sent mock ICE candidate to {sender_id}")
        elif msg_type == "monitor-confirmed":
            print(f"  → Monitor subscription confirmed")
        else:
            print(f"  → Unknown message type: {msg_type}")
    except json.JSONDecodeError:
        print(f"  → Received non-JSON message")

def on_error(ws, error):
    print(f"Error: {error}")

def on_close(ws, close_status_code, close_msg):
    print("Connection closed")

def on_open(ws):
    print("✅ Connected to WebSocket server!")
    print(f"   Connection URL: {WS_URL}")
    print(f"   Robot ID: {ROBOT_ID}")
    
    # Register the robot immediately
    register_msg = {
        "type": "register",
        "from": ROBOT_ID  # Use "from" not "robotId" (matches Rust agent format)
    }
    print(f"📤 Sending registration message: {json.dumps(register_msg)}")
    ws.send(json.dumps(register_msg))
    print(f"✅ Registration message sent for robot: {ROBOT_ID}")
    print(f"✅ Robot is now online and waiting for browser connections...")
    print(f"   To test: Open the Teleop page in your browser and start a session")
    print(f"   The robot will automatically respond to offers from browsers")
    print(f"")
    print(f"🔍 DEBUG: Watch for incoming messages below...")
    print(f"   Any message from the server will appear as 'Received: ...'")
    print(f"")
    
    # Send periodic keepalive messages to show robot is still active
    # In production, robots typically send keepalives every 30-60 seconds
    def send_keepalive():
        while not should_close:
            time.sleep(30)  # Send keepalive every 30 seconds
            if not should_close:
                keepalive_msg = {
                    "type": "register",  # Re-register to show robot is still active
                    "from": ROBOT_ID  # Use "from" not "robotId" (matches Rust agent format)
                }
                ws.send(json.dumps(keepalive_msg))
                print(f"📡 Keepalive sent (robot still online)")
    
    threading.Thread(target=send_keepalive, daemon=True).start()

# Connect to WebSocket
ws = websocket.WebSocketApp(
    WS_URL,
    on_message=on_message,
    on_error=on_error,
    on_close=on_close,
    on_open=on_open
)

# Run in a separate thread so we can control when to close
def run_websocket():
    ws.run_forever()

thread = threading.Thread(target=run_websocket, daemon=True)
thread.start()

# Keep connection open for 10 seconds
print("Keeping connection open for 10 seconds...")
time.sleep(10)

# Close the connection
print("Closing connection...")
should_close = True
ws.close()
print("Connection closed after 10 seconds")`}
                  </pre>
                </div>
              </div>
            </div>

            <div className="setup-actions">
              <button onClick={() => navigate('/my-robots')} className="btn-secondary">
                <FontAwesomeIcon icon={faArrowLeft} />
                Back to My Robots
              </button>
              <button onClick={() => navigate('/create-robot-listing')} className="btn-primary">
                <FontAwesomeIcon icon={faRobot} />
                List Another Robot
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

