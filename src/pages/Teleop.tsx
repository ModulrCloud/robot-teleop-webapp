import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Joystick, { type JoystickChange } from "../components/Joystick";
import { LoadingWheel } from "../components/LoadingWheel";
import { useWebRTC } from "../hooks/useWebRTC";
import { useGamepad } from "../hooks/useGamepad";
import "./Teleop.css";

export default function Teleop() {
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

  // TODO: Read from deployment config (environment/AWS Parameter Store)
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://192.168.132.19:8765';
  // TODO: Read from database based on selected robot
  const robotId = import.meta.env.VITE_ROBOT_ID || 'robot1';

  const { status, connect, disconnect, sendCommand, stopRobot } = useWebRTC({
    wsUrl,
    robotId,
  });

  useEffect(() => {
    if (status.connected && sessionStartTimeRef.current === null) {
      sessionStartTimeRef.current = Date.now();
    }
  }, [status.connected]);

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
      if (hasGamepad && controlMode === 'joystick') {
        // Don't auto-switch, let user choose
      }
    };

    const interval = setInterval(checkGamepad, 1000);
    window.addEventListener('gamepadconnected', checkGamepad);
    window.addEventListener('gamepaddisconnected', checkGamepad);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('gamepadconnected', checkGamepad);
      window.removeEventListener('gamepaddisconnected', checkGamepad);
    };
  }, [controlMode]);

  useGamepad(
    (input) => {
      if (!status.connected || controlMode !== 'gamepad') return;
      const now = Date.now();
      if (now - lastSendTimeRef.current < sendIntervalMs) return;
      lastSendTimeRef.current = now;

      const forward = input.forward * 0.5;
      const turn = input.turn * -1.0;
      setCurrentSpeed({ forward, turn });
      sendCommand(forward, turn);
      setIsJoystickActive(forward !== 0 || turn !== 0);
    },
    status.connected && controlMode === 'gamepad'
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
    const now = Date.now();
    if (now - lastSendTimeRef.current < sendIntervalMs) return;
    lastSendTimeRef.current = now;

    const forward = change.y * 0.5;
    const turn = change.x * -1.0;
    setCurrentSpeed({ forward, turn });
    sendCommand(forward, turn);
  };

  const handleJoystickEnd = () => {
    setIsJoystickActive(false);
    setCurrentSpeed({ forward: 0, turn: 0 });
    if (status.connected) stopRobot();
  };

  const handleEndSession = () => {
    stopRobot();
    disconnect();
    const duration = sessionStartTimeRef.current !== null 
      ? Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
      : 0;
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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
            <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
          </svg>
          {formatTime(sessionTime)}
        </div>

        <div className={`teleop-status-badge ${status.connected ? 'connected' : status.connecting ? 'connecting' : 'disconnected'}`}>
          {status.connecting && <><LoadingWheel /> Connecting...</>}
          {status.connected && <><span className="status-dot"></span> Connected</>}
          {status.error && <><span className="status-dot error"></span> Disconnected</>}
        </div>
      </div>

      {status.error && (
        <div className="teleop-error-alert">
          <div className="error-content">
            <strong>Connection Error:</strong> {status.error}
            <div className="error-details">Check that WebSocket server is running at: {wsUrl}</div>
          </div>
          <button onClick={connect} className="retry-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
              <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
            </svg>
            Retry Connection
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
                    <svg width="64" height="64" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M0 5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 1.983 1.738l3.11-1.382A1 1 0 0 1 16 4.269v7.462a1 1 0 0 1-1.406.913l-3.111-1.382A2 2 0 0 1 9.5 13H2a2 2 0 0 1-2-2V5z"/>
                    </svg>
                    <span>Waiting for video stream...</span>
                  </div>
                ) : (
                  <div className="placeholder-content">
                    <svg width="64" height="64" viewBox="0 0 16 16" fill="currentColor">
                      <path fillRule="evenodd" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                      <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/>
                    </svg>
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
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4A.5.5 0 0 1 8 0zM0 8a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4A.5.5 0 0 1 0 8zm11.5-.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4zM8 11.5a.5.5 0 0 0-1 0v4a.5.5 0 0 0 1 0v-4z"/>
                  <circle cx="8" cy="8" r="2"/>
                </svg>
                Joystick
              </button>
              <button
                className={`mode-btn ${controlMode === 'gamepad' ? 'active' : ''}`}
                onClick={() => setControlMode('gamepad')}
              >
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 0a.5.5 0 0 1 .5.5V2h5V.5a.5.5 0 0 1 1 0V2h1.5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h1.5V.5a.5.5 0 0 1 .5-.5zM3 3a1 1 0 0 0-1 1v1h12V4a1 1 0 0 0-1-1H3zm9 4a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm-1 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7 8a1 1 0 1 0-2 0 1 1 0 0 0 2 0zM5 10a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
                </svg>
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
                <div 
                  className="speed-bar forward" 
                  style={{ 
                    width: `${Math.abs(currentSpeed.forward) * 100}%`,
                    backgroundColor: currentSpeed.forward > 0 ? '#28a745' : '#dc3545'
                  }}
                />
              </div>
              <div className="speed-value">{(currentSpeed.forward * 100).toFixed(0)}%</div>
            </div>
            <div className="speed-meter">
              <div className="speed-label">Turn</div>
              <div className="speed-bar-container">
                <div 
                  className="speed-bar turn" 
                  style={{ 
                    width: `${Math.abs(currentSpeed.turn) * 100}%`,
                    backgroundColor: currentSpeed.turn > 0 ? '#ffc107' : '#17a2b8'
                  }}
                />
              </div>
              <div className="speed-value">{(currentSpeed.turn * 100).toFixed(0)}%</div>
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
              <div className="gamepad-visual">
                <svg className="gamepad-icon" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M483.13,245.38C461.92,149.49,430,98.31,382.65,84.33A107.13,107.13,0,0,0,352,80c-13.71,0-25.65,3.34-38.28,6.88C298.5,91.15,281.21,96,256,96s-42.51-4.84-57.76-9.11C185.6,83.34,173.67,80,160,80a115.74,115.74,0,0,0-31.73,4.32c-47.1,13.92-79,65.08-100.52,161C4.61,348.54,16,413.71,59.69,428.83a56.62,56.62,0,0,0,18.64,3.22c29.93,0,53.93-24.93,70.33-45.34,18.53-23.1,40.22-34.82,107.34-34.82s88.8,11.72,107.33,34.82c16.4,20.41,40.5,45.34,70.34,45.34a56.62,56.62,0,0,0,18.64-3.22C496,413.71,507.4,348.54,483.13,245.38ZM208,240H176v32a16,16,0,0,1-32,0V240H112a16,16,0,0,1,0-32h32V176a16,16,0,0,1,32,0v32h32a16,16,0,0,1,0,32Zm84,4a20,20,0,1,1,20-20A20,20,0,0,1,292,244Zm44,44a20,20,0,1,1,20-20A20,20,0,0,1,336,288Zm0-88a20,20,0,1,1,20-20A20,20,0,0,1,336,200Zm44,44a20,20,0,1,1,20-20A20,20,0,0,1,380,244Z"/>
                </svg>
                <div className={`gamepad-status ${gamepadDetected ? 'detected' : 'not-detected-status'}`}>
                  {gamepadDetected ? (
                    <>
                      <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" className="status-check">
                        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
                      </svg>
                      <span>Gamepad Connected</span>
                      <div className="gamepad-hint">Use left stick to control</div>
                    </>
                  ) : (
                    <>
                      <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" className="status-warn">
                        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                        <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/>
                      </svg>
                      <span>No Gamepad Detected</span>
                      <div className="gamepad-hint">Connect a controller to use</div>
                    </>
                  )}
                </div>
              </div>
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
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0v2z"/>
              <path fillRule="evenodd" d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z"/>
            </svg>
            End Session
          </button>
        </div>
      </div>
    </div>
  );
}
