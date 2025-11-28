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
            console.error('Error loading robot:', robotError);
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
          console.warn('Failed to get auth token:', authError);
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
        console.error('Error generating connection URL:', err);
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
      console.error('Failed to copy:', err);
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
            <button onClick={() => navigate('/create-robot-listing')} className="btn-primary">
              <FontAwesomeIcon icon={faArrowLeft} />
              Back to Robot Listings
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
                          console.error('Failed to copy:', err);
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
                        robotId: robotId
                      }, null, 2)}
                    </code>
                    <p className="step-note">Send this message immediately after the WebSocket connection is established.</p>
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
    print(f"Received: {message}")
    try:
        msg = json.loads(message)
        msg_type = msg.get("type", "")
        
        # Handle different message types
        if msg_type == "offer":
            print(f"  → Received offer from {msg.get('from', 'unknown')}")
            print(f"  → SDP: {msg.get('sdp', 'N/A')[:50]}...")
            # In a real robot, you would:
            # 1. Process the SDP offer
            # 2. Create a WebRTC answer
            # 3. Send the answer back
            # For testing, send a mock answer
            if not should_close:
                answer_msg = {
                    "type": "answer",
                    "robotId": ROBOT_ID,
                    "target": "client",
                    "payload": {
                        "sdp": "mock-answer-sdp-from-robot"
                    }
                }
                ws.send(json.dumps(answer_msg))
                print(f"  → Sent mock answer")
        elif msg_type == "ice-candidate":
            print(f"  → Received ICE candidate: {msg.get('candidate', 'N/A')[:50]}...")
            # In a real robot, you would add this candidate to your WebRTC peer connection
            # For testing, send a mock ICE candidate back
            if not should_close:
                candidate_msg = {
                    "type": "ice-candidate",
                    "robotId": ROBOT_ID,
                    "target": "client",
                    "payload": {
                        "candidate": "mock-ice-candidate-from-robot"
                    }
                }
                ws.send(json.dumps(candidate_msg))
                print(f"  → Sent mock ICE candidate")
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
    print("Connected!")
    
    # Register the robot immediately
    register_msg = {
        "type": "register",
        "robotId": ROBOT_ID
    }
    ws.send(json.dumps(register_msg))
    print(f"Robot {ROBOT_ID} registered")
    
    # Send test messages at different intervals to simulate robot activity
    def send_test_messages():
        # Send keepalive after 2 seconds
        time.sleep(2)
        if not should_close:
            test_msg = {
                "type": "register",  # Re-register to show robot is still active
                "robotId": ROBOT_ID
            }
            ws.send(json.dumps(test_msg))
            print(f"Sent keepalive message")
        
        # Send a mock offer after 4 seconds (simulating a client connection attempt)
        time.sleep(2)
        if not should_close:
            offer_msg = {
                "type": "offer",
                "robotId": ROBOT_ID,
                "target": "robot",
                "payload": {
                    "sdp": "mock-offer-sdp-for-testing"
                }
            }
            ws.send(json.dumps(offer_msg))
            print(f"Sent mock offer message")
        
        # Send a mock ICE candidate after 6 seconds
        time.sleep(2)
        if not should_close:
            candidate_msg = {
                "type": "ice-candidate",
                "robotId": ROBOT_ID,
                "target": "robot",
                "payload": {
                    "candidate": "mock-ice-candidate-for-testing"
                }
            }
            ws.send(json.dumps(candidate_msg))
            print(f"Sent mock ICE candidate")
    
    threading.Thread(target=send_test_messages, daemon=True).start()

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
print("Connection closed after 10 seconds")`;
                    try {
                      await navigator.clipboard.writeText(codeText);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    } catch (err) {
                      console.error('Failed to copy:', err);
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
    print(f"Received: {message}")
    try:
        msg = json.loads(message)
        msg_type = msg.get("type", "")
        
        # Handle different message types
        if msg_type == "offer":
            print(f"  → Received offer from {msg.get('from', 'unknown')}")
            print(f"  → SDP: {msg.get('sdp', 'N/A')[:50]}...")
            # In a real robot, you would:
            # 1. Process the SDP offer
            # 2. Create a WebRTC answer
            # 3. Send the answer back
            # For testing, send a mock answer
            if not should_close:
                answer_msg = {
                    "type": "answer",
                    "robotId": ROBOT_ID,
                    "target": "client",
                    "payload": {
                        "sdp": "mock-answer-sdp-from-robot"
                    }
                }
                ws.send(json.dumps(answer_msg))
                print(f"  → Sent mock answer")
        elif msg_type == "ice-candidate":
            print(f"  → Received ICE candidate: {msg.get('candidate', 'N/A')[:50]}...")
            # In a real robot, you would add this candidate to your WebRTC peer connection
            # For testing, send a mock ICE candidate back
            if not should_close:
                candidate_msg = {
                    "type": "ice-candidate",
                    "robotId": ROBOT_ID,
                    "target": "client",
                    "payload": {
                        "candidate": "mock-ice-candidate-from-robot"
                    }
                }
                ws.send(json.dumps(candidate_msg))
                print(f"  → Sent mock ICE candidate")
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
    print("Connected!")
    
    # Register the robot immediately
    register_msg = {
        "type": "register",
        "robotId": ROBOT_ID
    }
    ws.send(json.dumps(register_msg))
    print(f"Robot {ROBOT_ID} registered")
    
    # Send test messages at different intervals to simulate robot activity
    def send_test_messages():
        # Send keepalive after 2 seconds
        time.sleep(2)
        if not should_close:
            test_msg = {
                "type": "register",  # Re-register to show robot is still active
                "robotId": ROBOT_ID
            }
            ws.send(json.dumps(test_msg))
            print(f"Sent keepalive message")
        
        # Send a mock offer after 4 seconds (simulating a client connection attempt)
        time.sleep(2)
        if not should_close:
            offer_msg = {
                "type": "offer",
                "robotId": ROBOT_ID,
                "target": "robot",
                "payload": {
                    "sdp": "mock-offer-sdp-for-testing"
                }
            }
            ws.send(json.dumps(offer_msg))
            print(f"Sent mock offer message")
        
        # Send a mock ICE candidate after 6 seconds
        time.sleep(2)
        if not should_close:
            candidate_msg = {
                "type": "ice-candidate",
                "robotId": ROBOT_ID,
                "target": "robot",
                "payload": {
                    "candidate": "mock-ice-candidate-for-testing"
                }
            }
            ws.send(json.dumps(candidate_msg))
            print(f"Sent mock ICE candidate")
    
    threading.Thread(target=send_test_messages, daemon=True).start()

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
              <button onClick={() => navigate('/robots')} className="btn-secondary">
                <FontAwesomeIcon icon={faArrowLeft} />
                Back to Robots
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

