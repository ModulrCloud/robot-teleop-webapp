import { useState, useEffect, useRef } from 'react';
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
  faSyncAlt,
  faPlay
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [robotOnlineStatus, setRobotOnlineStatus] = useState<{ isOnline: boolean; status?: string } | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState<number | null>(null);
  const statusPollGenerationRef = useRef(0);

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

  // Load and poll robot online status for "Test your robot" section.
  // Use a generation ref so a slow response cannot overwrite a fresher one (CodeX P2).
  useEffect(() => {
    if (!robotId) {
      setRobotOnlineStatus(null);
      setSecondsUntilNextCheck(null);
      return;
    }

    const loadRobotStatus = async () => {
      const generation = ++statusPollGenerationRef.current;
      setIsLoadingStatus(true);
      try {
        const status = await client.queries.getRobotStatusLambda({ robotId });
        if (generation !== statusPollGenerationRef.current) return; // stale response, ignore
        if (status.data) {
          setRobotOnlineStatus({
            isOnline: status.data.isOnline || false,
            status: status.data.status || undefined,
          });
        } else {
          setRobotOnlineStatus({ isOnline: false });
        }
      } catch (err) {
        if (generation !== statusPollGenerationRef.current) return;
        logger.error('Error loading robot status:', err);
        setRobotOnlineStatus({ isOnline: false });
      } finally {
        if (generation === statusPollGenerationRef.current) {
          setIsLoadingStatus(false);
          setSecondsUntilNextCheck(10);
        }
      }
    };

    loadRobotStatus();
    const interval = setInterval(loadRobotStatus, 10000);
    return () => clearInterval(interval);
  }, [robotId]);

  // Countdown for "next check in X seconds"
  useEffect(() => {
    if (secondsUntilNextCheck === null) return;
    const id = setInterval(() => {
      setSecondsUntilNextCheck((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [robotId, secondsUntilNextCheck]);

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
              <h2>Test your robot</h2>
              <p className="section-description">
                Once your robot is connected and online, start a teleoperation session to verify video and controls. As the owner, testing your own robot is free.
              </p>
              <p className="url-note" style={{ marginTop: '0.5rem' }}>
                <span
                  className="robot-status-dot"
                  style={{
                    backgroundColor:
                      isLoadingStatus ? '#888' : robotOnlineStatus?.isOnline ? '#ffb700' : robotOnlineStatus?.status === 'pending' ? '#ff9800' : '#666',
                  }}
                  aria-hidden
                />
                {' '}
                {isLoadingStatus
                  ? 'Checking...'
                  : robotOnlineStatus?.status === 'pending'
                    ? `Pending. Checking again in ${secondsUntilNextCheck ?? 10} seconds...`
                    : robotOnlineStatus?.isOnline
                      ? secondsUntilNextCheck !== null
                        ? `Robot online. Next check in ${secondsUntilNextCheck} seconds...`
                        : 'Robot online'
                      : `Offline. Checking again in ${secondsUntilNextCheck ?? 10} seconds...`}
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => robotId && navigate(`/teleop?robotId=${robotId}`)}
                disabled={!robotId || !robotOnlineStatus?.isOnline}
                style={{ marginTop: '0.75rem' }}
              >
                <FontAwesomeIcon icon={faPlay} />
                {' '}Start test session
              </button>
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

