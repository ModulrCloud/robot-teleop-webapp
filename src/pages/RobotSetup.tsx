import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { usePageTitle } from '../hooks/usePageTitle';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faRobot,
  faCopy,
  faCheckCircle,
  faArrowLeft,
  faInfoCircle
} from '@fortawesome/free-solid-svg-icons';
import outputs from '../../amplify_outputs.json';
import './RobotSetup.css';
import { logger } from '../utils/logger';

const client = generateClient<Schema>();

export default function RobotSetup() {
  usePageTitle();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const robotUuid = searchParams.get('robotId'); // This is the Robot.id (UUID)
  const [robotId, setRobotId] = useState<string>(''); // This is the robotId field (robot-XXXXXXXX)
  const [connectionUrl, setConnectionUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [copiedRobotId, setCopiedRobotId] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadRobotAndGenerateUrl = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // First, load the robot data to get the correct robotId
        if (robotUuid) {
          try {
            const robot = await client.models.Robot.get({ id: robotUuid });
            if (robot.data?.robotId) {
              setRobotId(robot.data.robotId);
            } else {
              setError('Robot ID not found. The robot may not be properly configured.');
              setLoading(false);
              return;
            }
          } catch (robotError) {
            logger.error('Error loading robot:', robotError);
            setError('Failed to load robot information. Please try again.');
            setLoading(false);
            return;
          }
        } else {
          setError('No robot ID provided. Please go back and select a robot.');
          setLoading(false);
          return;
        }
        
        // Get WebSocket URL from amplify_outputs.json
        const wsUrl = outputs?.custom?.signaling?.websocketUrl;
        if (!wsUrl) {
          setError('WebSocket URL not found. Make sure the Amplify sandbox is running.');
          setLoading(false);
          return;
        }

        // Get Partner's current ID token
        let token: string | undefined;
        try {
          const session = await fetchAuthSession();
          token = session.tokens?.idToken?.toString();
        } catch (authError) {
          logger.warn('Failed to get auth token:', authError);
          // For development/testing, allow URL without token
          // In production, this should be required
          if (import.meta.env.DEV) {
            setConnectionUrl(wsUrl);
            setLoading(false);
            return;
          }
          setError('Authentication required. Please sign in again.');
          setLoading(false);
          return;
        }

        // Construct full connection URL with token
        const fullUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
        setConnectionUrl(fullUrl);
      } catch (err) {
        logger.error('Error generating connection URL:', err);
        setError('Failed to generate connection URL. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadRobotAndGenerateUrl();
  }, [robotUuid]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(connectionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy:', err);
      // Fallback: select text
      const textArea = document.createElement('textarea');
      textArea.value = connectionUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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
              <h2>Step 1: Copy Your Connection Details</h2>
              <p className="section-description">
                Copy these values and add them to your robot's configuration file. You'll need both the <strong>Robot ID</strong> and the <strong>WebSocket Connection URL</strong>.
              </p>
              
              <div className="config-values">
                <div className="config-item">
                  <label htmlFor="robot-id">Robot ID</label>
                  <div className="url-input-group">
                    <input
                      type="text"
                      value={robotId || ''}
                      readOnly
                      className="url-input"
                      id="robot-id"
                    />
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(robotId || '');
                          setCopiedRobotId(true);
                          setTimeout(() => setCopiedRobotId(false), 2000);
                        } catch (err) {
                          logger.error('Failed to copy:', err);
                        }
                      }}
                      className={`copy-button ${copiedRobotId ? 'copied' : ''}`}
                      title="Copy Robot ID"
                    >
                      {copiedRobotId ? (
                        <>
                          <FontAwesomeIcon icon={faCheckCircle} />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <FontAwesomeIcon icon={faCopy} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="config-item">
                  <label htmlFor="connection-url">WebSocket Connection URL</label>
                  <div className="url-input-group">
                    <input
                      type="text"
                      value={connectionUrl}
                      readOnly
                      className="url-input"
                      id="connection-url"
                    />
                    <button
                      onClick={handleCopy}
                      className={`copy-button ${copied ? 'copied' : ''}`}
                      title="Copy Connection URL"
                    >
                      {copied ? (
                        <>
                          <FontAwesomeIcon icon={faCheckCircle} />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <FontAwesomeIcon icon={faCopy} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <p className="url-note">
                <FontAwesomeIcon icon={faInfoCircle} />
                The connection URL includes your authentication token. Keep it secure and don't share it publicly.
              </p>
            </div>

            <div className="setup-section">
              <h2>Step 2: Configure Your Robot</h2>
              <div className="instructions">
                <div className="instruction-step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h3>Add Configuration Values to Your Robot</h3>
                    <p>In your robot's configuration file, add both values from Step 1 above:</p>
                    <ul>
                      <li><strong>Robot ID:</strong> {robotId}</li>
                      <li><strong>WebSocket URL:</strong> The connection URL (includes authentication token)</li>
                    </ul>
                    <p className="step-note">The connection URL includes your authentication token. Keep it secure and add it to your robot's configuration file or environment variables.</p>
                  </div>
                </div>

                <div className="instruction-step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h3>Register Your Robot</h3>
                    <p>When your robot connects, it must send a registration message with its robot ID:</p>
                    <code className="code-block">
                      {JSON.stringify({
                        type: 'register',
                        from: robotId  // Use 'from' field (matches Rust agent format)
                      }, null, 2)}
                    </code>
                    <p className="step-note">Send this message immediately after the WebSocket connection is established. The server accepts both <code>{"{ type: 'register', from: 'robot-id' }"}</code> (Rust format) and <code>{"{ type: 'register', robotId: 'robot-id' }"}</code> (legacy format) for compatibility.</p>
                  </div>
                </div>

                <div className="instruction-step">
                  <div className="step-number">3</div>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0 }}>Example Code</h2>
                <button
                  onClick={async () => {
                    const codeText = `import websocket
import json
import time
import threading

# Your connection URL (from above)
WS_URL = "${connectionUrl}"
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
                  className={`copy-button ${copiedCode ? 'copied' : ''}`}
                  title="Copy Example Code"
                  style={{ marginLeft: 'auto' }}
                >
                  {copiedCode ? (
                    <>
                      <FontAwesomeIcon icon={faCheckCircle} />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <FontAwesomeIcon icon={faCopy} />
                      <span>Copy Code</span>
                    </>
                  )}
                </button>
              </div>
              <p className="section-description">
                Here's a simple example of how to connect your robot (Python):
              </p>
              <pre className="code-block large">
{`import websocket
import json
import time
import threading

# Your connection URL (from above)
WS_URL = "${connectionUrl}"
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

