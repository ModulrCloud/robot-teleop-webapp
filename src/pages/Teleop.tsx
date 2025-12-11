import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Joystick, { type JoystickChange } from "../components/Joystick";
import { LoadingWheel } from "../components/LoadingWheel";
import { useWebRTC } from "../hooks/useWebRTC";
import { useGamepad } from "../hooks/useGamepad";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faClock,
  faRotate,
  faVideo,
  faCircleExclamation,
  faArrowsUpDownLeftRight,
  faGamepad,
  faRightFromBracket,
  faCheckCircle,
  faLock
} from '@fortawesome/free-solid-svg-icons';
import "./Teleop.css";
import { usePageTitle } from "../hooks/usePageTitle";
import outputs from '../../amplify_outputs.json';
import { generateClient } from 'aws-amplify/api';
import { fetchAuthSession, fetchUserAttributes } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

export default function Teleop() {
  usePageTitle();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSendTimeRef = useRef<number>(0);
  const sessionStartTimeRef = useRef<number | null>(null);
  const [sessionTime, setSessionTime] = useState(0);
  const [isJoystickActive, setIsJoystickActive] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState({ forward: 0, turn: 0 });
  const [controlMode, setControlMode] = useState<'joystick' | 'gamepad'>('joystick');
  const [gamepadDetected, setGamepadDetected] = useState(false);
  const sendIntervalMs = 100; // 10 Hz
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Read WebSocket URL from amplify_outputs.json (AWS signaling server)
  // Falls back to local WebSocket for development
  const wsUrl = outputs?.custom?.signaling?.websocketUrl 
    ? outputs.custom.signaling.websocketUrl 
    : (import.meta.env.VITE_WS_URL || 'ws://192.168.132.19:8765');
  
  // Get robotId from URL params (set by RobotSelect page)
  // Falls back to environment variable or default for development
  const [searchParams] = useSearchParams();
  const robotId = searchParams.get('robotId') || import.meta.env.VITE_ROBOT_ID || 'robot1';

  const { status, connect, disconnect, sendCommand, stopRobot } = useWebRTC({
    wsUrl,
    robotId,
  });

  useEffect(() => {
    if (status.connected && sessionStartTimeRef.current === null) {
      sessionStartTimeRef.current = Date.now();
      
      // Save session to database
      (async () => {
        try {
          const session = await fetchAuthSession();
          const attributes = await fetchUserAttributes();
          const username = session.tokens?.idToken?.payload?.['cognito:username'] as string;
          
          const result = await client.models.Session.create({
            userId: username,
            userEmail: attributes.email || '',
            robotId: robotId,
            robotName: robotId, // Could be fetched from robot data if needed
            startedAt: new Date().toISOString(),
            status: 'active',
          });
          
          if (result.data?.id) {
            setSessionId(result.data.id);
          }
        } catch (err) {
          console.error('Failed to create session:', err);
        }
      })();
    }
  }, [status.connected, robotId]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (sessionStartTimeRef.current !== null) {
        setSessionTime(Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkGamepad = () => {
      const gamepads = navigator.getGamepads();
      const hasGamepad = Array.from(gamepads).some(g => g !== null);
      setGamepadDetected(hasGamepad);
    };

    // Check immediately on mount
    checkGamepad();
    
    // Browser security: gamepads already connected require user interaction to detect
    // Add one-time listeners for ANY user interaction to "activate" gamepad detection
    let interactionHandled = false;
    const handleFirstInteraction = () => {
      if (!interactionHandled) {
        interactionHandled = true;
        checkGamepad(); // Check immediately after first interaction
        // Remove listeners after first interaction
        document.removeEventListener('mousedown', handleFirstInteraction);
        document.removeEventListener('touchstart', handleFirstInteraction);
        document.removeEventListener('keydown', handleFirstInteraction);
        document.removeEventListener('pointerdown', handleFirstInteraction);
      }
    };
    
    // Listen for any user interaction to activate gamepad detection
    document.addEventListener('mousedown', handleFirstInteraction, { once: true });
    document.addEventListener('touchstart', handleFirstInteraction, { once: true });
    document.addEventListener('keydown', handleFirstInteraction, { once: true });
    document.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    
    // Also check periodically (some browsers need user interaction first)
    const interval = setInterval(checkGamepad, 500); // Check more frequently
    
    const handleGamepadConnected = () => {
      checkGamepad();
    };
    
    const handleGamepadDisconnected = () => {
      checkGamepad();
    };
    
    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
      document.removeEventListener('mousedown', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
      document.removeEventListener('pointerdown', handleFirstInteraction);
    };
  }, [controlMode]);

  useGamepad(
    (input) => {
      const forward = input.forward * 0.5;
      const turn = input.turn * -1.0;
      setCurrentSpeed({ forward, turn });
      setIsJoystickActive(forward !== 0 || turn !== 0);
      
      // Gamepad input detected - update detection status immediately
      const gamepads = navigator.getGamepads();
      const hasGamepad = Array.from(gamepads).some(g => g !== null);
      if (hasGamepad && !gamepadDetected) {
        setGamepadDetected(true);
      }
      
      if (!status.connected || controlMode !== 'gamepad') return;
      const now = Date.now();
      if (now - lastSendTimeRef.current < sendIntervalMs) return;
      lastSendTimeRef.current = now;
      sendCommand(forward, turn);
    },
    controlMode === 'gamepad'
  );

  useEffect(() => {
    connect();
    return () => {
      stopRobot();
      disconnect();
    };
  }, [connect, disconnect, stopRobot]);

  useEffect(() => {
    if (videoRef.current && status.videoStream) {
      videoRef.current.srcObject = status.videoStream;
    }
  }, [status.videoStream]);

  const handleJoystickChange = (change: JoystickChange) => {
    if (!status.connected || controlMode !== 'joystick') return;
    
    setIsJoystickActive(true);
    
    // Update visual feedback immediately for responsive feel
    const forward = change.y * 0.5;
    const turn = change.x * -1.0;
    setCurrentSpeed({ forward, turn });
    
    // Throttle network sends to avoid overwhelming the connection
    const now = Date.now();
    if (now - lastSendTimeRef.current >= sendIntervalMs) {
      lastSendTimeRef.current = now;
      sendCommand(forward, turn);
    }
  };

  const handleJoystickEnd = () => {
    setIsJoystickActive(false);
    setCurrentSpeed({ forward: 0, turn: 0 });
    if (status.connected) stopRobot();
  };

  const handleEndSession = async () => {
    stopRobot();
    disconnect();
    
    const duration = sessionStartTimeRef.current !== null 
      ? Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
      : 0;
    
    // Update session in database
    if (sessionId) {
      try {
        await client.models.Session.update({
          id: sessionId,
          endedAt: new Date().toISOString(),
          durationSeconds: duration,
          status: 'completed',
        });
      } catch (err) {
        console.error('Failed to update session:', err);
      }
    }
    
    navigate('/endsession', { state: { duration } });
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="teleop-container">
      <div className="teleop-top-bar">
        <div className="connection-info">
          <span className="info-label">Robot:</span>
          <span className="info-value">{robotId}</span>
        </div>
        
        <div className="session-timer">
          <FontAwesomeIcon icon={faClock} />
          {formatTime(sessionTime)}
        </div>

        <div className={`teleop-status-badge ${status.connected ? 'connected' : status.connecting ? 'connecting' : 'disconnected'}`}>
          {status.connecting && <><LoadingWheel /> Connecting...</>}
          {status.connected && <><span className="status-dot"></span> Connected</>}
          {status.error && <><span className="status-dot error"></span> Disconnected</>}
        </div>
      </div>

      {status.connected && (
        <div className="security-indicator-banner">
          <div className="security-badge">
            <FontAwesomeIcon icon={faLock} />
            <div className="security-info">
              <strong>Secure Connection</strong>
              <span>Your teleoperation session is encrypted end-to-end</span>
            </div>
          </div>
          {wsUrl.startsWith('wss://') && (
            <div className="encryption-details">
              <FontAwesomeIcon icon={faCheckCircle} />
              <span>WSS Encrypted</span>
            </div>
          )}
        </div>
      )}

      {status.error && (
        <div className="teleop-error-alert">
          <div className="error-content">
            <strong>Connection Error:</strong> {status.error}
            <div className="error-details">Check that WebSocket server is running at: {wsUrl}</div>
          </div>
          <button 
            onClick={connect} 
            className="retry-btn"
            disabled={status.connecting}
          >
            <FontAwesomeIcon icon={faRotate} />
            {status.connecting ? 'Connecting...' : 'Retry Connection'}
          </button>
        </div>
      )}

      <div className="teleop-panel">
        <div className="teleop-video-container">
          <div className="video-wrapper">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="teleop-video"
            />
            {!status.videoStream && (
              <div className="video-placeholder">
                {status.connecting ? (
                  <div className="placeholder-content">
                    <LoadingWheel />
                    <span>Establishing connection...</span>
                  </div>
                ) : status.connected ? (
                  <div className="placeholder-content">
                    <FontAwesomeIcon icon={faVideo} size="3x" />
                    <span>Waiting for video stream...</span>
                  </div>
                ) : (
                  <div className="placeholder-content">
                    <FontAwesomeIcon icon={faCircleExclamation} size="3x" />
                    <span>Camera offline</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="teleop-controls-panel">
          <div className="controls-header">
            <h3>Movement Control</h3>
            
            <div className="control-mode-selector">
              <button
                className={`mode-btn ${controlMode === 'joystick' ? 'active' : ''}`}
                onClick={() => setControlMode('joystick')}
              >
                <FontAwesomeIcon icon={faArrowsUpDownLeftRight} />
                Joystick
              </button>
              <button
                className={`mode-btn ${controlMode === 'gamepad' ? 'active' : ''}`}
                onClick={() => {
                  setControlMode('gamepad');
                  // User interaction activates gamepad API - check immediately
                  const gamepads = navigator.getGamepads();
                  const hasGamepad = Array.from(gamepads).some(g => g !== null);
                  setGamepadDetected(hasGamepad);
                }}
              >
                <FontAwesomeIcon icon={faGamepad} />
                Gamepad
              </button>
            </div>
          </div>

          <div className="control-status">
            <div className="status-row">
              <span className="status-label">Mode:</span>
              <span className="status-value">{controlMode === 'joystick' ? 'Virtual Joystick' : 'Gamepad'}</span>
            </div>
            <div className="status-row">
              <span className="status-label">Status:</span>
              <span className={`status-value ${isJoystickActive ? 'active-status' : ''}`}>
                {isJoystickActive ? 'Moving' : 'Idle'}
              </span>
            </div>
          </div>

          <div className="speed-indicators">
            <div className="speed-meter">
              <div className="speed-label">Forward</div>
              <div className="speed-bar-container">
                <div className="speed-bar-center-line" />
                <div 
                  className="speed-bar forward" 
                  style={{ 
                    left: currentSpeed.forward < 0 ? `${50 + (currentSpeed.forward / 0.5) * 50}%` : '50%',
                    width: `${Math.abs(currentSpeed.forward / 0.5) * 50}%`,
                    backgroundColor: currentSpeed.forward > 0 ? '#28a745' : currentSpeed.forward < 0 ? '#dc3545' : '#666'
                  }}
                />
              </div>
              <div className="speed-value">{((currentSpeed.forward / 0.5) * 100).toFixed(0)}%</div>
            </div>
            <div className="speed-meter">
              <div className="speed-label">Turn</div>
              <div className="speed-bar-container">
                <div className="speed-bar-center-line" />
                <div 
                  className="speed-bar turn" 
                  style={{ 
                    left: -currentSpeed.turn < 0 ? `${50 + (-currentSpeed.turn / 1.0) * 50}%` : '50%',
                    width: `${Math.abs(currentSpeed.turn / 1.0) * 50}%`,
                    backgroundColor: currentSpeed.turn < 0 ? '#ffc107' : currentSpeed.turn > 0 ? '#17a2b8' : '#666'
                  }}
                />
              </div>
              <div className="speed-value">{((-currentSpeed.turn / 1.0) * 100).toFixed(0)}%</div>
            </div>
          </div>
          
          {controlMode === 'joystick' ? (
            <div className="joystick-wrapper">
              <Joystick 
                onChange={handleJoystickChange} 
                onEnd={handleJoystickEnd}
                size={220}
                knobSize={90}
              />
            </div>
          ) : (
            <div className="gamepad-wrapper">
              {gamepadDetected ? (
                <div className="joystick-display-wrapper">
                  <div className="joystick-display" style={{ width: 220, height: 220 }}>
                    <div className="joystick-ring" />
                    <div
                      className="joystick-knob"
                      style={{
                        width: 90,
                        height: 90,
                        transform: `translate(calc(-50% + ${-currentSpeed.turn / 0.5 * 65}px), calc(-50% + ${currentSpeed.forward / 0.5 * -65}px))`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="gamepad-visual">
                  <FontAwesomeIcon icon={faGamepad} className="gamepad-icon" size="6x" />
                  <div className="gamepad-status not-detected-status">
                    <div className="gamepad-hint">
                      {controlMode === 'gamepad' 
                        ? 'Press a button on your controller to start'
                        : 'Switch to Gamepad mode to use your controller'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="control-hints">
            <div className="hint-item">
              <span className="hint-icon">↑↓</span>
              <span>Forward/Backward</span>
            </div>
            <div className="hint-item">
              <span className="hint-icon">←→</span>
              <span>Turn Left/Right</span>
            </div>
          </div>

          <button 
            onClick={handleEndSession} 
            className="end-session-btn"
            disabled={status.connecting}
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            End Session
          </button>
        </div>
      </div>
    </div>
  );
}