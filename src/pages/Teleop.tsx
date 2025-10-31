import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Joystick, { type JoystickChange } from "../components/Joystick";
import { LoadingWheel } from "../components/LoadingWheel";
import { useWebRTC } from "../hooks/useWebRTC";
import "./Teleop.css";

export default function Teleop() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSendTimeRef = useRef<number>(0);
  const sendIntervalMs = 100; // 10 Hz

  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://192.168.132.19:8765';
  const robotId = import.meta.env.VITE_ROBOT_ID || 'robot1';

  const { status, connect, disconnect, sendCommand, stopRobot } = useWebRTC({
    wsUrl,
    robotId,
  });

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
    if (!status.connected) return;
    const now = Date.now();
    if (now - lastSendTimeRef.current < sendIntervalMs) return;
    lastSendTimeRef.current = now;

    const forward = change.y * 0.5;
    const turn = change.x * -1.0;
    sendCommand(forward, turn);
  };

  const handleJoystickEnd = () => {
    if (status.connected) stopRobot();
  };

  const handleEndSession = () => {
    stopRobot();
    disconnect();
    navigate('/endsession');
  };

  return (
    <div className="teleop-container">
      {/* Status Badge */}
      <div className={`teleop-status-badge ${status.connected ? 'connected' : status.connecting ? 'connecting' : 'disconnected'}`}>
        {status.connecting && <><LoadingWheel /> Connecting...</>}
        {status.connected && <><span className="status-dot"></span> Connected</>}
        {status.error && <><span className="status-dot error"></span> Disconnected</>}
      </div>

      {/* Error Alert */}
      {status.error && (
        <div className="teleop-error-alert">
          <div className="error-content">
            <strong>Connection Error:</strong> {status.error}
          </div>
          <button onClick={connect} className="retry-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
              <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
            </svg>
            Retry
          </button>
        </div>
      )}

      {/* Main Control Panel */}
      <div className="teleop-panel">
        {/* Video Feed */}
        <div className="teleop-video-container">
          <div className="video-wrapper">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="teleop-video"
            />
            {!status.videoStream && (
              <div className="video-placeholder">
                {status.connecting ? (
                  <><LoadingWheel /> Waiting for video...</>
                ) : status.connected ? (
                  <>No video feed</>
                ) : (
                  <>Camera offline</>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Controls Panel */}
        <div className="teleop-controls-panel">
          <div className="controls-header">
            <h3>Movement Control</h3>
          </div>
          <div className="joystick-wrapper">
            <Joystick 
              onChange={handleJoystickChange} 
              onEnd={handleJoystickEnd}
              size={240}
              knobSize={100}
            />
          </div>
          <button onClick={handleEndSession} className="end-session-btn">
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
