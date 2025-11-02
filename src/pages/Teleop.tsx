import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Joystick, { type JoystickChange } from "../components/Joystick";
import { LoadingWheel } from "../components/LoadingWheel";
import { useWebRTC } from "../hooks/useWebRTC";
import "./Teleop.css";

export default function Teleop() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSendTimeRef = useRef<number>(0);
  const sessionStartTimeRef = useRef<number>(Date.now());
  const [sessionTime, setSessionTime] = useState(0);
  const [isJoystickActive, setIsJoystickActive] = useState(false);
  const sendIntervalMs = 100; // 10 Hz

  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://192.168.132.19:8765';
  const robotId = import.meta.env.VITE_ROBOT_ID || 'robot1';

  const { status, connect, disconnect, sendCommand, stopRobot } = useWebRTC({
    wsUrl,
    robotId,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setSessionTime(Math.floor((Date.now() - sessionStartTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    sessionStartTimeRef.current = Date.now();
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
    if (!status.connected) return;
    
    setIsJoystickActive(true);
    const now = Date.now();
    if (now - lastSendTimeRef.current < sendIntervalMs) return;
    lastSendTimeRef.current = now;

    const forward = change.y * 0.5;
    const turn = change.x * -1.0;
    sendCommand(forward, turn);
  };

  const handleJoystickEnd = () => {
    setIsJoystickActive(false);
    if (status.connected) stopRobot();
  };

  const handleEndSession = () => {
    stopRobot();
    disconnect();
    const duration = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000);
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
            <div className={`joystick-indicator ${isJoystickActive ? 'active' : ''}`}>
              {isJoystickActive ? 'Moving' : 'Ready'}
            </div>
          </div>
          
          <div className="joystick-wrapper">
            <Joystick 
              onChange={handleJoystickChange} 
              onEnd={handleJoystickEnd}
              size={240}
              knobSize={100}
            />
          </div>

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
