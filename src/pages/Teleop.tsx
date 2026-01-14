import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Joystick, { type JoystickChange } from "../components/Joystick";
import { LoadingWheel } from "../components/LoadingWheel";
import { useWebRTC } from "../hooks/useWebRTC";
import { useGamepad } from "../hooks/useGamepad";
import { useKeyboardMovement } from "../hooks/useKeyboardMovement";
import { useUserCredits } from "../hooks/useUserCredits";
import { useToast } from "../hooks/useToast";
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
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
  faLock,
  faUserLock,
  faCoins,
      faExclamationTriangle,
      faKeyboard,
      faMapMarkerAlt,
      faCog
    } from '@fortawesome/free-solid-svg-icons';
import { InputBindingsModal } from '../components/InputBindingsModal';
import { useCustomCommandBindings } from '../hooks/useCustomCommandBindings';
import "./Teleop.css";
import { usePageTitle } from "../hooks/usePageTitle";
import outputs from '../../amplify_outputs.json';
import { logger } from '../utils/logger';
import { PurchaseCreditsModal } from '../components/PurchaseCreditsModal';

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
  const [controlMode, setControlMode] = useState<'joystick' | 'gamepad' | 'keyboard' | 'location'>('joystick');
  const [gamepadDetected, setGamepadDetected] = useState(false);
  const sendIntervalMs = 100; // 10 Hz
  const { credits, refreshCredits } = useUserCredits();
  const { toast, showToast } = useToast();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showInputBindingsModal, setShowInputBindingsModal] = useState(false);
  const [clientBindings, setClientBindings] = useState<{
    keyboard: Record<string, string>;
    gamepad: Record<string, string>;
  }>({ keyboard: {}, gamepad: {} });
  const lastDeductionTimeRef = useRef<number | null>(null);
  
  // Low credits warning state
  const [lowCreditsWarningMinutes, setLowCreditsWarningMinutes] = useState<number>(1);
  const [sessionHourlyRate, setSessionHourlyRate] = useState<number | null>(null);
  const [platformMarkup, setPlatformMarkup] = useState<number>(30);
  const warningShownRef = useRef<boolean>(false);


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

  // Set up custom command bindings
  useCustomCommandBindings({
    robotId,
    enabled: status.connected,
    clientKeyboardBindings: clientBindings.keyboard,
    clientGamepadBindings: clientBindings.gamepad,
    onCommandExecute: (result) => {
      showToast(
        `Command executed: ${result.commandName} (${result.inputMethod})`,
        'success',
        3000
      );
    },
  });

  // Status changes are handled by the useWebRTC hook - no need to log here

  useEffect(() => {
    connect();
    
    return () => {
      stopRobot();
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robotId]);

  useEffect(() => {
    if (status.connected && sessionStartTimeRef.current === null) {
      sessionStartTimeRef.current = Date.now();
      lastDeductionTimeRef.current = Date.now();
      logger.log('Session started for robot:', robotId);
      
      // Find the active session ID and load settings
      const findSessionId = async () => {
        try {
          const { getCurrentUser } = await import('aws-amplify/auth');
          const currentUser = await getCurrentUser();
          const { data: sessions } = await client.models.Session.list({
            filter: {
              userId: { eq: currentUser.username },
              status: { eq: 'active' },
              robotId: { eq: robotId },
            },
          });
          if (sessions && sessions.length > 0) {
            const session = sessions[0];
            setSessionId(session.id || null);
            // Get hourly rate from session (snapshot at session start)
            if (session.hourlyRateCredits) {
              setSessionHourlyRate(session.hourlyRateCredits);
            }
            logger.log('Found session ID:', session.id);
          }
        } catch (err) {
          logger.error('Failed to find session ID:', err);
        }
      };
      
      // Load low credits warning setting
      const loadWarningSetting = async () => {
        try {
          const { data: settings } = await client.models.PlatformSettings.list({
            filter: { settingKey: { eq: 'lowCreditsWarningMinutes' } },
          });
          if (settings && settings.length > 0) {
            setLowCreditsWarningMinutes(parseFloat(settings[0].settingValue || '1'));
          }
        } catch (err) {
          logger.error('Failed to load warning setting:', err);
        }
      };
      
      // Load platform markup
      const loadPlatformMarkup = async () => {
        try {
          const { data: settings } = await client.models.PlatformSettings.list({
            filter: { settingKey: { eq: 'platformMarkupPercent' } },
          });
          if (settings && settings.length > 0) {
            setPlatformMarkup(parseFloat(settings[0].settingValue || '30'));
          }
        } catch (err) {
          logger.error('Failed to load platform markup:', err);
        }
      };
      
      findSessionId();
      loadWarningSetting();
      loadPlatformMarkup();
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

  // Reset warning flag when session starts
  useEffect(() => {
    if (status.connected && sessionId) {
      warningShownRef.current = false;
    }
  }, [status.connected, sessionId]);

  // Per-minute credit deduction timer
  useEffect(() => {
    if (!status.connected || !sessionId || insufficientFunds) return;

    const deductionInterval = setInterval(async () => {
      if (!sessionId || !status.connected) return;

      try {
        const result = await client.mutations.deductSessionCreditsLambda({
          sessionId,
        });

        if (result.data) {
          const response = typeof result.data === 'string' 
            ? JSON.parse(result.data) 
            : result.data;
          
          if (response.statusCode === 200) {
            const body = typeof response.body === 'string' 
              ? JSON.parse(response.body) 
              : response.body;
            
            logger.log('Credits deducted:', body);
            lastDeductionTimeRef.current = Date.now();
            // Refresh credits and notify navbar
            await refreshCredits();
            // Trigger custom event for navbar update
            window.dispatchEvent(new CustomEvent('creditsUpdated'));
            
            // Check for low credits warning
            // Use remainingCredits from the response (most accurate)
            if (body.remainingCredits !== undefined && body.remainingCredits > 0 && sessionHourlyRate && platformMarkup) {
              // Calculate cost per minute
              const hourlyRateCredits = sessionHourlyRate;
              const durationHours = 1 / 60; // 1 minute
              const baseCostCredits = hourlyRateCredits * durationHours;
              const platformFeeCredits = baseCostCredits * (platformMarkup / 100);
              const costPerMinute = baseCostCredits + platformFeeCredits;
              
              // Calculate remaining minutes
              const remainingCredits = body.remainingCredits;
              const remainingMinutes = remainingCredits / costPerMinute;
              
              // Show warning if below threshold and haven't shown it yet this session
              if (remainingMinutes <= lowCreditsWarningMinutes && remainingMinutes > 0 && !warningShownRef.current) {
                const minutesText = remainingMinutes < 1 
                  ? 'less than 1 minute' 
                  : remainingMinutes < 2
                  ? 'about 1 minute'
                  : `${Math.floor(remainingMinutes)} minutes`;
                
                showToast(
                  `Low credits warning: You have approximately ${minutesText} of session time remaining. Please top up your account to continue.`,
                  'warning',
                  10000
                );
                warningShownRef.current = true;
              } else if (remainingMinutes > lowCreditsWarningMinutes) {
                // Reset warning flag if credits are back above threshold
                warningShownRef.current = false;
              }
            }
          } else if (response.statusCode === 402) {
            // Insufficient funds
            const body = typeof response.body === 'string' 
              ? JSON.parse(response.body) 
              : response.body;
            
            logger.error('Insufficient funds:', body);
            
            // Refresh credits to show updated balance (should be 0 or very low)
            await refreshCredits();
            // Trigger custom event for navbar update
            window.dispatchEvent(new CustomEvent('creditsUpdated'));
            
            // Show toast notification
            showToast(
              'Session terminated due to insufficient credits. Please top up your account to continue.',
              'error',
              8000
            );
            
            // Reset warning flag
            warningShownRef.current = false;
            
            setInsufficientFunds(true);
            stopRobot();
            disconnect();
            setShowPurchaseModal(true);
          }
        }
      } catch (err) {
        logger.error('Error deducting credits:', err);
      }
    }, 60000); // Every 60 seconds (1 minute)

    return () => clearInterval(deductionInterval);
  }, [status.connected, sessionId, insufficientFunds, refreshCredits, stopRobot, disconnect]);

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
    if (videoRef.current && status.videoStream) {
      videoRef.current.srcObject = status.videoStream;
    }
  }, [status.videoStream]);

  const handleEndSession = useCallback(() => {
    stopRobot();
    disconnect();
    // Store state in sessionStorage for EndSession page to read
    sessionStorage.setItem('endSessionState', JSON.stringify({
      duration: sessionTime,
      sessionId: status.sessionId
    }));
    // Use window.location.href for reliable navigation from keyboard event handlers
    // React Router's navigate() doesn't always work reliably when called from keyboard events
    // This causes a full page reload, but ensures navigation always works
    window.location.href = '/endsession';
  }, [stopRobot, disconnect, sessionTime, status.sessionId]);

  // Memoize keyboard input handler to prevent infinite re-renders
  const handleKeyboardInput = useCallback((input: { forward: number; turn: number }) => {
    const forward = input.forward;
    const turn = input.turn;
    setCurrentSpeed({ forward, turn });
    setIsJoystickActive(forward !== 0 || turn !== 0);
    
    // Only send commands when actually connected
    if (!status.connected || controlMode !== 'keyboard') return;
    const now = Date.now();
    if (now - lastSendTimeRef.current < sendIntervalMs) return;
    lastSendTimeRef.current = now;
    sendCommand(forward, turn);
  }, [status.connected, controlMode, sendCommand]);

  // Memoize keyboard stop handler to prevent infinite re-renders
  const handleKeyboardStop = useCallback(() => {
    setIsJoystickActive(false);
    setCurrentSpeed({ forward: 0, turn: 0 });
    if (status.connected) stopRobot();
  }, [status.connected, stopRobot]);

  // Keyboard movement (WASD)
  // Note: enabled is always true for keyboard mode to allow visual feedback even when not connected
  const { pressedKeys } = useKeyboardMovement({
    enabled: true, // Always enabled for visual feedback (movement only sent when connected)
    controlMode,
    escWorksInAllModes: true, // ESC works in all modes
    onInput: handleKeyboardInput,
    onStop: handleKeyboardStop,
    onEndSession: handleEndSession,
  });

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


  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (status.robotBusy) {
    return (
      <div className="teleop-container">
        <div className="robot-busy-modal">
          <div className="busy-content">
            <FontAwesomeIcon icon={faUserLock} className="busy-icon" />
            <h2>Robot Currently in Use</h2>
            <p className="busy-message">
              Oops, sorry but this robot is being controlled by <strong>{status.busyUser}</strong>.
            </p>
            <p className="busy-hint">
              I will let you know once their session is closed.
            </p>
            <div className="busy-actions">
              <button 
                className="retry-btn"
                onClick={() => window.location.reload()}
              >
                <FontAwesomeIcon icon={faRotate} />
                Check Again
              </button>
              <button 
                className="back-btn"
                onClick={() => navigate('/robots')}
              >
                Browse Other Robots
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (insufficientFunds) {
    return (
      <div className="teleop-container">
        <div className="robot-busy-modal">
          <div className="busy-content">
            <FontAwesomeIcon icon={faExclamationTriangle} className="busy-icon" style={{ color: '#ff9800' }} />
            <h2>Insufficient Credits</h2>
            <p className="busy-message">
              Your session has been paused due to insufficient credits. Please top up your account to continue.
            </p>
            <div className="busy-actions">
              <button 
                className="retry-btn"
                onClick={() => setShowPurchaseModal(true)}
              >
                <FontAwesomeIcon icon={faCoins} />
                Purchase Credits
              </button>
              <button 
                className="back-btn"
                onClick={() => navigate('/robots')}
              >
                Return to Robots
              </button>
            </div>
          </div>
        </div>
        <PurchaseCreditsModal
          isOpen={showPurchaseModal}
          onClose={async () => {
            setShowPurchaseModal(false);
            await refreshCredits();
            // Trigger custom event for navbar update
            window.dispatchEvent(new CustomEvent('creditsUpdated'));
            // If user has enough credits now, allow them to continue
            // Otherwise they'll need to start a new session
            if (credits > 0) {
              setInsufficientFunds(false);
            }
          }}
        />

        {/* Toast Notification */}
        {toast.visible && (
          <div className={`toast-notification ${toast.type}`}>
            <FontAwesomeIcon 
              icon={
                toast.type === 'error' ? faExclamationTriangle :
                toast.type === 'success' ? faCheckCircle :
                toast.type === 'warning' ? faCircleExclamation :
                faCheckCircle
              } 
            />
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    );
  }

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

      {(status.error || (!status.connected && !status.connecting)) && (
        <div className="teleop-error-alert">
          <div className="error-content">
            <strong>Connection Error:</strong> {status.error || 'Unable to connect to robot'}
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
                className={`mode-btn ${controlMode === 'keyboard' ? 'active' : ''}`}
                onClick={() => setControlMode('keyboard')}
              >
                <FontAwesomeIcon icon={faKeyboard} />
                Keyboard
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
              <button
                className={`mode-btn ${controlMode === 'location' ? 'active' : ''}`}
                onClick={() => setControlMode('location')}
              >
                <FontAwesomeIcon icon={faMapMarkerAlt} />
                Location
              </button>
            </div>
          </div>

          <div className="control-status">
            <div className="status-row">
              <span className="status-label">Mode:</span>
              <span className="status-value">
                {controlMode === 'joystick' ? 'Virtual Joystick' : 
                 controlMode === 'keyboard' ? 'Keyboard (WASD)' : 
                 controlMode === 'location' ? 'Location' :
                 'Gamepad'}
              </span>
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
          ) : controlMode === 'keyboard' ? (
            <div className="keyboard-controls-hint">
              <div className="keyboard-hint-content">
                <h3>Keyboard Controls</h3>
                <div className="keyboard-layout">
                  <div className="key-row">
                    <div className={`key-hint ${pressedKeys.includes('KeyW') ? 'pressed' : ''}`}>
                      <kbd>W</kbd>
                      <span>Forward</span>
                    </div>
                  </div>
                  <div className="key-row">
                    <div className={`key-hint ${pressedKeys.includes('KeyA') ? 'pressed' : ''}`}>
                      <kbd>A</kbd>
                      <span>Turn Left</span>
                    </div>
                    <div className={`key-hint ${pressedKeys.includes('KeyS') ? 'pressed' : ''}`}>
                      <kbd>S</kbd>
                      <span>Backward</span>
                    </div>
                    <div className={`key-hint ${pressedKeys.includes('KeyD') ? 'pressed' : ''}`}>
                      <kbd>D</kbd>
                      <span>Turn Right</span>
                    </div>
                  </div>
                  <div className="key-row">
                    <div className={`key-hint ${pressedKeys.includes('Escape') ? 'pressed' : ''}`}>
                      <kbd>ESC</kbd>
                      <span>End Session</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : controlMode === 'location' ? (
            <div className="location-controls-hint">
              <div className="location-hint-content">
                <FontAwesomeIcon icon={faMapMarkerAlt} className="location-icon" size="4x" />
                <h3>Location Control</h3>
                <p className="coming-soon-message">Coming Soon</p>
                <p className="location-description">
                  Navigate your robot to specific locations using map-based controls.
                </p>
              </div>
            </div>
          ) : controlMode === 'location' ? (
            <div className="location-controls-hint">
              <div className="location-hint-content">
                <FontAwesomeIcon icon={faMapMarkerAlt} className="location-icon" size="4x" />
                <h3>Location Control</h3>
                <p className="coming-soon-message">Coming Soon</p>
                <p className="location-description">
                  Navigate your robot to specific locations using map-based controls.
                </p>
              </div>
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

        {/* Settings Card */}
        <div className="teleop-settings-card">
          <div className="settings-header">
            <FontAwesomeIcon icon={faCog} />
            <h3>Settings</h3>
          </div>
          <div className="settings-content">
            <button
              type="button"
              className="settings-button"
              onClick={() => setShowInputBindingsModal(true)}
            >
              <FontAwesomeIcon icon={faKeyboard} />
              <span>Input Bindings</span>
            </button>
          </div>
        </div>
      </div>

      <PurchaseCreditsModal
        isOpen={showPurchaseModal}
        onClose={async () => {
          setShowPurchaseModal(false);
          await refreshCredits();
          // Trigger custom event for navbar update
          window.dispatchEvent(new CustomEvent('creditsUpdated'));
          // If user has enough credits now, allow them to continue
          // Otherwise they'll need to start a new session
          if (credits > 0) {
            setInsufficientFunds(false);
          }
        }}
      />

      {/* Toast Notification */}
      {toast.visible && (
        <div className={`toast-notification ${toast.type}`}>
          <FontAwesomeIcon 
            icon={
              toast.type === 'error' ? faExclamationTriangle :
              toast.type === 'success' ? faCheckCircle :
              toast.type === 'warning' ? faCircleExclamation :
              faCheckCircle
            } 
          />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Input Bindings Modal */}
      <InputBindingsModal
        isOpen={showInputBindingsModal}
        onClose={() => setShowInputBindingsModal(false)}
        robotId={robotId}
        clientBindings={clientBindings}
        onSaveClientBindings={(bindings) => {
          setClientBindings(bindings);
          // In real implementation, save to backend/localStorage
          // For now, just update state
          showToast('success', 'Input bindings saved successfully!');
        }}
      />
    </div>
  );
}
