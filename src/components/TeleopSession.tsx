import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Joystick, { type JoystickChange } from "../components/Joystick";
import { LoadingWheel } from "../components/LoadingWheel";
import { useWebRTC, type DataChannelListener } from "../hooks/useWebRTC";
import { useGamepad } from "../hooks/useGamepad";
import { useKeyboardMovement } from "../hooks/useKeyboardMovement";
import { useUserCredits } from "../hooks/useUserCredits";
import { useToast, type ToastType } from "../hooks/useToast";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
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
  faCog,
  faGaugeHigh,
  faBolt,
  faSearch,
  faCrosshairs,
  faBoxOpen,
  faStop,
  faSync,
  faSpinner,
  faPlay,
  faHome,
} from '@fortawesome/free-solid-svg-icons';
import { InputBindingsModal } from '../components/InputBindingsModal';
import { useCustomCommandBindings } from '../hooks/useCustomCommandBindings';
import "../pages/Teleop.css";
import outputs from '../../amplify_outputs.json';
import { logger } from '../utils/logger';
import { PurchaseCreditsModal } from '../components/PurchaseCreditsModal';
import { isFeatureEnabled } from '../utils/featureFlags';
import {
  buildNavigationStartMessage,
  buildNavigationCancelMessage,
  buildLocationCreateMessage,
  type NavigationResponsePayload,
  type AgentErrorPayload,
} from '../utils/dataChannelMessageFormat';
import { fetchProducts, fetchProductPoses, type CactusProduct } from '../utils/cactusApi';

export interface TeleopSessionProps {
  robotId: string;
  embedded?: boolean;
  /** When true, do not connect on mount; show overlay until user clicks to connect (for embedded panel). */
  deferConnect?: boolean;
  /** When provided, end/back actions call this instead of navigating (e.g. embedded: just disconnect and show overlay). */
  onEndSession?: () => void;
  /** When true (e.g. robot offline), overlay "Start test session" button is disabled. */
  connectDisabled?: boolean;
  /** Optional content shown in the defer overlay above the button (e.g. robot online/check status). */
  overlayStatus?: React.ReactNode;
}

const client = generateClient<Schema>();

interface ProductLocation {
  productId: string;
  productName: string;
  coordinates?: { x: number; y: number; z: number };
}

interface NavigationState {
  correlationId: string;
  productId: string;
  productName: string;
  status: 'pending' | 'started' | 'completed' | 'cancelled' | 'failed';
}

interface LocationPanelProps {
  sendMessage: (msg: Record<string, unknown>) => void;
  addListener: (cb: DataChannelListener) => () => void;
  disabled: boolean;
  showToast: (message: string, type: ToastType, duration?: number) => void;
}

const NAV_TIMEOUT_MS = 120_000;
const NAV_ACTIVE_TIMEOUT_MS = 300_000;
const LOC_REGISTER_DELAY_MS = 200;

function LocationPanel({ sendMessage, addListener, disabled, showToast }: LocationPanelProps) {
  const [products, setProducts] = useState<ProductLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeNavigation, setActiveNavigation] = useState<NavigationState | null>(null);
  const activeNavigationRef = useRef<NavigationState | null>(null);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navStartTimeRef = useRef<number | null>(null);
  const [navElapsed, setNavElapsed] = useState(0);

  useEffect(() => { activeNavigationRef.current = activeNavigation; }, [activeNavigation]);

  useEffect(() => {
    if (!activeNavigation) {
      navStartTimeRef.current = null;
      setNavElapsed(0);
      return;
    }
    if (!navStartTimeRef.current) navStartTimeRef.current = Date.now();
    const id = setInterval(() => {
      if (navStartTimeRef.current) setNavElapsed(Math.floor((Date.now() - navStartTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [activeNavigation]);

  const clearNavTimeout = useCallback(() => {
    if (navTimeoutRef.current) { clearTimeout(navTimeoutRef.current); navTimeoutRef.current = null; }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw: CactusProduct[] = await fetchProducts();
      const merged: ProductLocation[] = raw.map(p => ({
        productId: p.productId,
        productName: p.productName,
      }));
      setProducts(merged);
      logger.log('[LOC] Loaded', merged.length, 'products from Cactus API');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      showToast(`Failed to load products: ${msg}`, 'error', 5000);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Clear navigation state on disconnect
  useEffect(() => {
    if (disabled && activeNavigation) { setActiveNavigation(null); clearNavTimeout(); }
  }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => clearNavTimeout, [clearNavTimeout]);

  useEffect(() => {
    return addListener((msg) => {
      const type = msg.type as string;
      const correlationId = msg.correlationId as string | undefined;
      const nav = activeNavigationRef.current;
      if (!nav || !correlationId || nav.correlationId !== correlationId) return;

      if (type === 'agent.navigation.response') {
        const payload = msg.payload as NavigationResponsePayload | undefined;
        if (!payload) return;
        switch (payload.status) {
          case 'started': {
            setActiveNavigation(prev => prev ? { ...prev, status: 'started' } : null);
            clearNavTimeout();
            const startedCorrId = correlationId;
            navTimeoutRef.current = setTimeout(() => {
              if (activeNavigationRef.current?.correlationId === startedCorrId) {
                setActiveNavigation(null);
                showToast('Navigation timed out — robot may still be moving', 'warning', 4000);
              }
            }, NAV_ACTIVE_TIMEOUT_MS);
            showToast(`Navigating to ${payload.name}...`, 'info', 3000);
            break;
          }
          case 'completed':
            setActiveNavigation(null);
            clearNavTimeout();
            showToast(`Arrived at ${payload.name}`, 'success', 3000);
            break;
          case 'cancelled':
            setActiveNavigation(null);
            clearNavTimeout();
            showToast('Navigation cancelled', 'info', 3000);
            break;
          case 'failed':
            setActiveNavigation(null);
            clearNavTimeout();
            showToast(`Navigation failed: ${payload.message || 'Unknown error'}`, 'error', 5000);
            break;
        }
      }

      if (type === 'agent.error') {
        const payload = msg.payload as AgentErrorPayload | undefined;
        if (!payload) return;
        setActiveNavigation(null);
        clearNavTimeout();
        showToast(`Navigation error: ${payload.message}`, 'error', 5000);
      }
    });
  }, [addListener, showToast, clearNavTimeout]);

  const filtered = products.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.productName.toLowerCase().includes(q) || p.productId.includes(search);
  });

  const handleNavigate = async (product: ProductLocation) => {
    clearNavTimeout();
    setActiveNavigation({
      correlationId: '',
      productId: product.productId,
      productName: product.productName,
      status: 'pending',
    });

    try {
      const poses = await fetchProductPoses([product.productId]);
      const pose = poses[product.productId];
      if (!pose) {
        setActiveNavigation(null);
        showToast(`No pose available for ${product.productName}`, 'warning', 3000);
        return;
      }

      // Convert Auki Y-up to ROS Z-up: nav_x = auki_x, nav_y = -auki_z, nav_z = auki_y
      const rosPose = { x: pose.x, y: -(pose.z ?? 0), z: pose.y };

      setProducts(prev => prev.map(p =>
        p.productId === product.productId ? { ...p, coordinates: rosPose } : p
      ));

      const locMsg = buildLocationCreateMessage(product.productName, rosPose, { sku: product.productId });
      sendMessage(locMsg);
      logger.log('[LOC] Pushed fresh pose for', product.productName, rosPose);

      await new Promise(resolve => setTimeout(resolve, LOC_REGISTER_DELAY_MS));

      const navMsg = buildNavigationStartMessage(product.productName);
      const corrId = navMsg.id as string;
      setActiveNavigation(prev => prev ? { ...prev, correlationId: corrId } : null);
      sendMessage(navMsg);
      logger.log('[NAV] Sent agent.navigation.start:', product.productName);

      navTimeoutRef.current = setTimeout(() => {
        if (activeNavigationRef.current?.correlationId === corrId) {
          setActiveNavigation(null);
          showToast('Navigation timed out — no response from robot', 'warning', 4000);
        }
      }, NAV_TIMEOUT_MS);
    } catch (err) {
      setActiveNavigation(null);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast(`Failed to fetch pose: ${msg}`, 'error', 4000);
    }
  };

  const handleCancel = () => {
    const cancelledProduct = activeNavigation?.productName;
    const msg = buildNavigationCancelMessage();
    sendMessage(msg);
    logger.log('[NAV] Sent agent.navigation.cancel');
    setActiveNavigation(null);
    clearNavTimeout();
    if (cancelledProduct) showToast(`Cancelled navigation to ${cancelledProduct}`, 'info', 2000);
  };

  const handleGoHome = () => {
    clearNavTimeout();
    const navMsg = buildNavigationStartMessage('home');
    const corrId = navMsg.id as string;
    setActiveNavigation({ correlationId: corrId, productId: '__home__', productName: 'Home', status: 'pending' });
    sendMessage(navMsg);
    logger.log('[NAV] Sent agent.navigation.start: home');

    navTimeoutRef.current = setTimeout(() => {
      if (activeNavigationRef.current?.correlationId === corrId) {
        setActiveNavigation(null);
        showToast('Navigation timed out — no response from robot', 'warning', 4000);
      }
    }, NAV_TIMEOUT_MS);
  };

  const isNavigating = activeNavigation !== null;
  const isHomeNavigating = isNavigating && activeNavigation.productId === '__home__';

  return (
    <div className="location-panel">
      <div className="location-panel-header">
        <FontAwesomeIcon icon={faMapMarkerAlt} className="location-panel-icon" />
        <span>Product Locations</span>
        <span className="location-panel-count">{filtered.length}</span>
        <button
          className="location-refresh-btn"
          onClick={loadProducts}
          disabled={loading}
          title="Fetch new product set"
        >
          <FontAwesomeIcon icon={faSync} spin={loading} />
        </button>
      </div>

      <div className="location-home-row">
        {isHomeNavigating ? (
          <div className="location-home-navigating">
            <span className="location-nav-status">
              {activeNavigation.status === 'pending' ? 'Waiting for robot…' : 'Navigating home…'}
              <span className="location-nav-elapsed">{navElapsed}s</span>
            </span>
            <button className="location-go-btn cancel" onClick={handleCancel} title="Cancel navigation">
              <FontAwesomeIcon icon={faStop} />
              <span>Cancel</span>
            </button>
          </div>
        ) : (
          <button
            className="location-home-btn"
            onClick={handleGoHome}
            disabled={disabled || isNavigating}
            title={disabled ? 'Connect to robot first' : isNavigating ? 'Navigation in progress' : 'Send robot home'}
          >
            <FontAwesomeIcon icon={faHome} />
            <span>Home</span>
          </button>
        )}
      </div>

      <div className="location-search-row">
        <div className="location-search-box">
          <FontAwesomeIcon icon={faSearch} className="location-search-icon" />
          <input
            type="text"
            placeholder="Search product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="location-product-list">
        {loading && products.length === 0 ? (
          <div className="location-loading">
            <FontAwesomeIcon icon={faSpinner} spin />
            <span>Loading products...</span>
          </div>
        ) : error && products.length === 0 ? (
          <div className="location-error">
            <FontAwesomeIcon icon={faCircleExclamation} />
            <span>{error}</span>
            <button className="location-retry-btn" onClick={loadProducts}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="location-empty">No products found</div>
        ) : (
          filtered.map(p => {
            const isThisNavigating = isNavigating && activeNavigation.productId === p.productId;
            return (
              <div key={p.productId} className={`location-product-item ${isThisNavigating ? 'navigating' : ''}`}>
                <div className="location-product-info">
                  <div className="location-product-icon">
                    <FontAwesomeIcon icon={faBoxOpen} />
                  </div>
                  <div className="location-product-text">
                    <span className="location-product-name">{p.productName}</span>
                    <span className="location-product-meta">
                      SKU: {p.productId}
                      {p.coordinates && ` · (${p.coordinates.x.toFixed(1)}, ${p.coordinates.y.toFixed(1)}, ${p.coordinates.z.toFixed(1)})`}
                    </span>
                  </div>
                </div>
                {isThisNavigating ? (
                  <div className="location-nav-active">
                    <span className="location-nav-status">
                      {activeNavigation.status === 'pending' ? 'Waiting for robot…' : 'Navigating…'}
                      <span className="location-nav-elapsed">{navElapsed}s</span>
                    </span>
                    <button
                      className="location-go-btn cancel"
                      onClick={handleCancel}
                      title="Cancel navigation"
                    >
                      <FontAwesomeIcon icon={faStop} />
                      <span>Cancel</span>
                    </button>
                  </div>
                ) : (
                  <button
                    className="location-go-btn"
                    onClick={() => handleNavigate(p)}
                    disabled={disabled || isNavigating}
                    title={disabled ? 'Connect to robot first' : isNavigating ? 'Navigation in progress' : `Navigate to ${p.productName}`}
                  >
                    <FontAwesomeIcon icon={faCrosshairs} />
                    <span>Go</span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function TeleopSession({ robotId, embedded = false, deferConnect = false, onEndSession, connectDisabled = false, overlayStatus }: TeleopSessionProps) {
  const navigate = useNavigate();
  const location = useLocation();
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
  /** Set when billing ends the session: insufficient credits vs free time cap (distinct UI). */
  const [billingTermination, setBillingTermination] = useState<
    null | 'insufficient_funds' | 'free_cap_exceeded'
  >(null);
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

  // Joystick/gamepad sensitivity (0 = most forgiving, 100 = raw input)
  const [steeringSensitivity, setSteeringSensitivity] = useState<number>(() => {
    const saved = localStorage.getItem('steeringSensitivity');
    return saved ? parseInt(saved, 10) : 30;
  });


  // Read WebSocket URL from amplify_outputs.json (AWS signaling server)
  // Falls back to local WebSocket for development
  const wsUrl = outputs?.custom?.signaling?.websocketUrl
    ? outputs.custom.signaling.websocketUrl
    : (import.meta.env.VITE_WS_URL || 'ws://192.168.132.19:8765');

  const { user } = useAuthStatus();
  const [isOwnerTest, setIsOwnerTest] = useState<boolean>(false);

  const { status, connect, disconnect, sendCommand, stopRobot, sendDataChannelMessage, addDataChannelListener } = useWebRTC({
    wsUrl,
    robotId,
  });

  const handleBackOrEndSession = useCallback(() => {
    if (onEndSession) {
      disconnect();
      onEndSession();
    } else {
      navigate('/robots');
    }
  }, [onEndSession, disconnect, navigate]);

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

  // Stop robot immediately when switching to a different robot
  const prevRobotIdRef = useRef<string>(robotId);
  useEffect(() => {
    if (prevRobotIdRef.current !== robotId && prevRobotIdRef.current) {
      stopRobot();
    }
    prevRobotIdRef.current = robotId;
  }, [robotId, stopRobot]);

  // Detect if current user is the robot owner (owner test = no charge, show "Test mode")
  // Align with backend: match partner cognitoUsername/contactEmail to username, email, and Cognito sub (userId)
  useEffect(() => {
    if (!robotId) {
      setIsOwnerTest(false);
      return;
    }
    let cancelled = false;
    const checkOwner = async () => {
      try {
        const { getCurrentUser } = await import('aws-amplify/auth');
        const currentUser = await getCurrentUser();
        const sub = currentUser?.userId;
        if (cancelled) return;

        const { data: robots } = await client.models.Robot.list({
          filter: { robotId: { eq: robotId } },
          limit: 1,
        });
        const robot = robots?.[0];
        if (cancelled || !robot?.partnerId) {
          if (!cancelled) setIsOwnerTest(false);
          return;
        }
        const { data: partner } = await client.models.Partner.get({ id: robot.partnerId });
        if (cancelled) return;
        const emailPrefix = user?.email?.split('@')[0] || '';
        const owner =
          partner &&
          (partner.cognitoUsername === user?.username ||
            partner.cognitoUsername === user?.email ||
            (sub && partner.cognitoUsername === sub) ||
            (emailPrefix && partner.cognitoUsername?.includes(emailPrefix)) ||
            (typeof partner.contactEmail === 'string' &&
              partner.contactEmail.trim().toLowerCase() === user?.email?.trim().toLowerCase()));
        if (!cancelled) setIsOwnerTest(!!owner);
      } catch (err) {
        logger.error('Error checking robot owner:', err);
        if (!cancelled) setIsOwnerTest(false);
      }
    };
    checkOwner();
    return () => { cancelled = true; };
  }, [robotId, user?.username, user?.email]);

  useEffect(() => {
    if (!deferConnect) {
      connect(); // Full Teleop page: connect on mount
    }
    return () => {
      stopRobot();
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robotId, deferConnect]);

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
            // Snapshot at session start (include 0 for free robots)
            if (session.hourlyRateCredits != null) {
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

  // Per-minute credit deduction timer (skipped for owner test – backend also returns 0)
  useEffect(() => {
    if (!status.connected || !sessionId || billingTermination !== null || isOwnerTest) return;

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
            const body = typeof response.body === 'string'
              ? JSON.parse(response.body)
              : response.body;

            logger.error('Session billing termination:', body);

            const isFreeCap = body.terminationReason === 'free_cap_exceeded';

            if (!isFreeCap) {
              await refreshCredits();
              window.dispatchEvent(new CustomEvent('creditsUpdated'));
            }

            showToast(
              isFreeCap
                ? 'Your free session time limit for this robot was reached. The session has ended.'
                : 'Session terminated due to insufficient credits. Please top up your account to continue.',
              'error',
              8000
            );

            warningShownRef.current = false;

            setBillingTermination(isFreeCap ? 'free_cap_exceeded' : 'insufficient_funds');
            stopRobot();
            disconnect();
            if (!isFreeCap) {
              setShowPurchaseModal(true);
            }
          }
        }
      } catch (err) {
        logger.error('Error deducting credits:', err);
      }
    }, 60000); // Every 60 seconds (1 minute)

    return () => clearInterval(deductionInterval);
  }, [status.connected, sessionId, billingTermination, isOwnerTest, refreshCredits, stopRobot, disconnect]);

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
      // Apply steering sensitivity (gamepad turn = x, forward = y)
      const adjusted = applySteeringSensitivity(input.turn, input.forward);
      const forward = adjusted.y * 0.5;
      const turn = adjusted.x * -1.0;
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

  // Stop robot when user clicks a link to navigate away (capture phase runs before navigation)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest('a[href^="/"]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;
      const currentFullPath = location.pathname + location.search;
      if (href !== currentFullPath) {
        stopRobot();
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [location.pathname, location.search, stopRobot]);

  const applySteeringSensitivity = useCallback((rawX: number, rawY: number): { x: number; y: number } => {
    const magnitude = Math.sqrt(rawX * rawX + rawY * rawY);
    if (magnitude < 0.1) return { x: 0, y: 0 };

    const angleDeg = Math.atan2(rawX, rawY) * (180 / Math.PI);
    const absAngle = Math.abs(angleDeg);
    const forwardZoneHalf = ((100 - steeringSensitivity) / 100) * 35;
    const transitionWidth = 25;

    let turnScale = 1;
    if (absAngle < forwardZoneHalf) {
      turnScale = 0;
    } else if (absAngle < forwardZoneHalf + transitionWidth) {
      turnScale = (absAngle - forwardZoneHalf) / transitionWidth;
    }

    const backAngle = 180 - absAngle;
    if (backAngle < forwardZoneHalf) {
      turnScale = 0;
    } else if (backAngle < forwardZoneHalf + transitionWidth) {
      turnScale = Math.min(turnScale, (backAngle - forwardZoneHalf) / transitionWidth);
    }

    return { x: rawX * turnScale, y: rawY };
  }, [steeringSensitivity]);

  const handleSensitivityChange = useCallback((value: number) => {
    setSteeringSensitivity(value);
    localStorage.setItem('steeringSensitivity', value.toString());
  }, []);

  const handleEndSession = useCallback(() => {
    stopRobot();
    disconnect();
    if (embedded && onEndSession) {
      onEndSession();
      return;
    }
    const endDuration = sessionStartTimeRef.current
      ? Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
      : sessionTime;
    sessionStorage.setItem('endSessionState', JSON.stringify({
      duration: Math.max(0, endDuration),
      sessionId: status.sessionId,
      robotId: robotId,
    }));
    window.location.href = '/endsession';
  }, [embedded, stopRobot, disconnect, onEndSession, sessionTime, status.sessionId, robotId]);

  const handleKeyboardInput = useCallback((input: { forward: number; turn: number }) => {
    const forward = input.forward;
    const turn = input.turn * -1.0;
    setCurrentSpeed({ forward, turn });
    setIsJoystickActive(forward !== 0 || turn !== 0);

    if (!status.connected || controlMode !== 'keyboard') return;
    const now = Date.now();
    if (now - lastSendTimeRef.current < sendIntervalMs) return;
    lastSendTimeRef.current = now;
    sendCommand(forward, turn);
  }, [status.connected, controlMode, sendCommand]);

  const handleKeyboardStop = useCallback(() => {
    setIsJoystickActive(false);
    setCurrentSpeed({ forward: 0, turn: 0 });
    if (status.connected) stopRobot();
  }, [status.connected, stopRobot]);

  const { pressedKeys } = useKeyboardMovement({
    enabled: true,
    controlMode,
    escWorksInAllModes: true,
    onInput: handleKeyboardInput,
    onStop: handleKeyboardStop,
    onEndSession: handleEndSession,
  });

  const handleJoystickChange = (change: JoystickChange) => {
    if (!status.connected || controlMode !== 'joystick') return;

    setIsJoystickActive(true);

    const adjusted = applySteeringSensitivity(change.x, change.y);
    const forward = adjusted.y * 0.5;
    const turn = adjusted.x * -1.0;
    setCurrentSpeed({ forward, turn });

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
                onClick={handleBackOrEndSession}
              >
                Browse Other Robots
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (billingTermination === 'free_cap_exceeded') {
    return (
      <div className="teleop-container">
        <div className="robot-busy-modal">
          <div className="busy-content">
            <FontAwesomeIcon icon={faExclamationTriangle} className="busy-icon" style={{ color: '#ff9800' }} />
            <h2>Free session time ended</h2>
            <p className="busy-message">
              You have used the maximum free time allowed for this robot. Start a new session later or choose another robot.
            </p>
            <div className="busy-actions">
              <button className="back-btn" onClick={handleBackOrEndSession}>
                Return to Robots
              </button>
            </div>
          </div>
        </div>
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

  if (billingTermination === 'insufficient_funds') {
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
                onClick={handleBackOrEndSession}
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
              setBillingTermination(null);
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
    <div className="teleop-container" style={{ position: 'relative' }}>
      {deferConnect && !status.connected && !status.connecting && (
        <div
          className="teleop-defer-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)',
            borderRadius: 'inherit',
          }}
        >
          <div style={{ textAlign: 'center', padding: '1.5rem' }}>
            {overlayStatus != null ? (
              <div style={{ marginBottom: '1rem', color: 'rgba(255,255,255,0.9)' }}>{overlayStatus}</div>
            ) : (
              <p style={{ marginBottom: '1rem', color: 'rgba(255,255,255,0.9)' }}>Start your test session to connect to the robot</p>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={connect}
              disabled={status.connecting || connectDisabled}
            >
              <FontAwesomeIcon icon={faPlay} />
              {' '}Start test session
            </button>
          </div>
        </div>
      )}
      {!embedded && (
        <>
          <div className="teleop-top-bar">
            <div className="connection-info">
              <span className="info-label">Robot:</span>
              <span className="info-value">{robotId}</span>
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
        </>
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
            
            {status.connected && status.videoStream && (
              <div className="viewport-stats-overlay">
                <div className="viewport-stats-group">
                  <div className="viewport-stat">
                    <FontAwesomeIcon 
                      icon={faBolt} 
                      className={`stat-icon ${status.stats.latencyMs !== null && status.stats.latencyMs < 100 ? 'good' : status.stats.latencyMs !== null && status.stats.latencyMs < 200 ? 'medium' : 'poor'}`}
                    />
                    <span className={`stat-value ${status.stats.latencyMs !== null && status.stats.latencyMs < 100 ? 'good' : status.stats.latencyMs !== null && status.stats.latencyMs < 200 ? 'medium' : 'poor'}`}>
                      {status.stats.latencyMs !== null ? status.stats.latencyMs : '--'}
                    </span>
                    <span className="stat-unit">ms</span>
                  </div>
                  <div className="stat-divider"></div>
                  <div className="viewport-stat">
                    <FontAwesomeIcon icon={faGaugeHigh} className="stat-icon" />
                    <span className="stat-value">
                      {status.stats.bitrate !== null ? status.stats.bitrate : '--'}
                    </span>
                    <span className="stat-unit">kbps</span>
                  </div>
                </div>
                <div className="viewport-stats-center">
                  <div className="live-indicator">
                    <span className="live-dot"></span>
                    <span className="live-text">
                      {isOwnerTest ? 'Test mode' : formatTime(sessionTime)}
                    </span>
                    {isOwnerTest && (
                      <span className="live-text test-mode-sub" style={{ opacity: 0.9, fontSize: '0.75em', display: 'block', marginTop: '0.15rem' }}>
                        No charge
                      </span>
                    )}
                  </div>
                </div>
                <div className="viewport-stats-group">
                  <div className="viewport-stat">
                    <span className="stat-value">
                      {status.stats.frameRate !== null ? status.stats.frameRate : '--'}
                    </span>
                    <span className="stat-unit">fps</span>
                  </div>
                  <div className="stat-divider"></div>
                  <div className="viewport-stat">
                    <span className="stat-value resolution">
                      {status.stats.frameWidth && status.stats.frameHeight 
                        ? `${status.stats.frameWidth}×${status.stats.frameHeight}` 
                        : '--'}
                    </span>
                  </div>
                </div>
              </div>
            )}

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
            <div className="controls-header-left">
              <div className={`status-indicator ${isJoystickActive ? 'active' : ''}`}>
                <span className={`status-dot ${isJoystickActive ? 'active' : 'idle'}`} />
              </div>
              <h3>Movement Control</h3>
              <span className={`status-badge ${isJoystickActive ? 'active' : 'idle'}`}>
                {isJoystickActive ? 'Moving' : 'Ready'}
              </span>
            </div>
          </div>

          <div className="controls-mode-row">
            <div className="control-mode-selector">
              <button
                className={`mode-btn ${controlMode === 'joystick' ? 'active' : ''}`}
                onClick={() => setControlMode('joystick')}
                title="Virtual Joystick"
              >
                <FontAwesomeIcon icon={faArrowsUpDownLeftRight} />
                <span>Joystick</span>
              </button>
              <button
                className={`mode-btn ${controlMode === 'keyboard' ? 'active' : ''}`}
                onClick={() => setControlMode('keyboard')}
                title="Keyboard (WASD)"
              >
                <FontAwesomeIcon icon={faKeyboard} />
                <span>Keyboard</span>
              </button>
              <button
                className={`mode-btn ${controlMode === 'gamepad' ? 'active' : ''}`}
                onClick={() => {
                  setControlMode('gamepad');
                  const gamepads = navigator.getGamepads();
                  const hasGamepad = Array.from(gamepads).some(g => g !== null);
                  setGamepadDetected(hasGamepad);
                }}
                title="Gamepad"
              >
                <FontAwesomeIcon icon={faGamepad} />
                <span>Gamepad</span>
              </button>
              <button
                className={`mode-btn ${controlMode === 'location' ? 'active' : ''}`}
                onClick={() => setControlMode('location')}
                title="Location"
              >
                <FontAwesomeIcon icon={faMapMarkerAlt} />
                <span>Location</span>
              </button>
            </div>
            <div className="mode-settings-row">
              <button
                className="settings-btn"
                onClick={() => {
                  if (isFeatureEnabled('CUSTOM_ROS_COMMANDS')) {
                    setShowInputBindingsModal(true);
                  } else {
                    showToast('Custom bindings coming soon', 'info');
                  }
                }}
                title="Settings"
              >
                <FontAwesomeIcon icon={faCog} />
                <span>Input Bindings</span>
              </button>
            </div>
          </div>

          <div className="control-info-panel">
            <div className="speed-gauges">
              <div className="speed-gauge">
                <div className="gauge-header">
                  <span className="gauge-label">FWD</span>
                  <span className={`gauge-value ${currentSpeed.forward !== 0 ? 'active' : ''}`}>
                    {((currentSpeed.forward / 0.5) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="gauge-track">
                  <div className="gauge-center" />
                  <div
                    className={`gauge-fill ${currentSpeed.forward > 0 ? 'forward' : currentSpeed.forward < 0 ? 'backward' : ''}`}
                    style={{
                      left: currentSpeed.forward < 0 ? `${50 + (currentSpeed.forward / 0.5) * 50}%` : '50%',
                      width: `${Math.abs(currentSpeed.forward / 0.5) * 50}%`,
                    }}
                  />
                </div>
              </div>
              <div className="speed-gauge">
                <div className="gauge-header">
                  <span className="gauge-label">TURN</span>
                  <span className={`gauge-value ${currentSpeed.turn !== 0 ? 'active' : ''}`}>
                    {((-currentSpeed.turn / 1.0) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="gauge-track">
                  <div className="gauge-center" />
                  <div
                    className={`gauge-fill ${currentSpeed.turn < 0 ? 'left' : currentSpeed.turn > 0 ? 'right' : ''}`}
                    style={{
                      left: -currentSpeed.turn < 0 ? `${50 + (-currentSpeed.turn / 1.0) * 50}%` : '50%',
                      width: `${Math.abs(currentSpeed.turn / 1.0) * 50}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {(controlMode === 'joystick' || controlMode === 'gamepad') && (
              <div className="sensitivity-row">
                <span className="sensitivity-label">Sensitivity</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={steeringSensitivity}
                  onChange={(e) => handleSensitivityChange(parseInt(e.target.value, 10))}
                  className="sensitivity-slider"
                />
                <span className="sensitivity-value">{steeringSensitivity}%</span>
              </div>
            )}
          </div>

          <div className="control-content-area">
            {controlMode === 'joystick' ? (
              <div className="joystick-wrapper">
                <svg className="joystick-zone-overlay" viewBox="0 0 220 220" width="220" height="220">
                  {(() => {
                    const forwardZoneHalf = ((100 - steeringSensitivity) / 100) * 35;
                    const transitionWidth = 25;
                    const cx = 110, cy = 110, r = 95;
                    const angleToPoint = (angle: number, radius: number) => {
                      const rad = (angle - 90) * Math.PI / 180;
                      return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
                    };
                    if (forwardZoneHalf < 1) return null;
                    const fwdLeft = angleToPoint(-forwardZoneHalf, r);
                    const fwdRight = angleToPoint(forwardZoneHalf, r);
                    const transLeft = angleToPoint(-(forwardZoneHalf + transitionWidth), r);
                    const transRight = angleToPoint(forwardZoneHalf + transitionWidth, r);
                    const bwdLeft = angleToPoint(180 - forwardZoneHalf, r);
                    const bwdRight = angleToPoint(180 + forwardZoneHalf, r);
                    return (
                      <>
                        <path d={`M ${cx} ${cy} L ${fwdLeft.x} ${fwdLeft.y} A ${r} ${r} 0 0 1 ${fwdRight.x} ${fwdRight.y} Z`} fill="rgba(76, 175, 80, 0.1)" />
                        <path d={`M ${cx} ${cy} L ${bwdRight.x} ${bwdRight.y} A ${r} ${r} 0 0 1 ${bwdLeft.x} ${bwdLeft.y} Z`} fill="rgba(76, 175, 80, 0.1)" />
                        <line x1={cx} y1={cy} x2={fwdLeft.x} y2={fwdLeft.y} stroke="rgba(76, 175, 80, 0.6)" strokeWidth="1.5" strokeDasharray="4 3" />
                        <line x1={cx} y1={cy} x2={fwdRight.x} y2={fwdRight.y} stroke="rgba(76, 175, 80, 0.6)" strokeWidth="1.5" strokeDasharray="4 3" />
                        <line x1={cx} y1={cy} x2={transLeft.x} y2={transLeft.y} stroke="rgba(255, 183, 0, 0.3)" strokeWidth="1" strokeDasharray="2 4" />
                        <line x1={cx} y1={cy} x2={transRight.x} y2={transRight.y} stroke="rgba(255, 183, 0, 0.3)" strokeWidth="1" strokeDasharray="2 4" />
                        <line x1={cx} y1={cy} x2={bwdLeft.x} y2={bwdLeft.y} stroke="rgba(76, 175, 80, 0.6)" strokeWidth="1.5" strokeDasharray="4 3" />
                        <line x1={cx} y1={cy} x2={bwdRight.x} y2={bwdRight.y} stroke="rgba(76, 175, 80, 0.6)" strokeWidth="1.5" strokeDasharray="4 3" />
                      </>
                    );
                  })()}
                </svg>
                <Joystick
                  onChange={handleJoystickChange}
                  onEnd={handleJoystickEnd}
                  size={200}
                  knobSize={80}
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
              <LocationPanel
                sendMessage={sendDataChannelMessage}
                addListener={addDataChannelListener}
                disabled={!status.connected}
                showToast={showToast}
              />
            ) : (
              <div className="gamepad-wrapper">
                {gamepadDetected ? (
                  <div className="joystick-display-wrapper">
                    <svg className="joystick-zone-overlay" viewBox="0 0 200 200" width="200" height="200">
                      {(() => {
                        const forwardZoneHalf = ((100 - steeringSensitivity) / 100) * 35;
                        const transitionWidth = 25;
                        const cx = 100, cy = 100, r = 85;
                        const angleToPoint = (angle: number, radius: number) => {
                          const rad = (angle - 90) * Math.PI / 180;
                          return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
                        };
                        if (forwardZoneHalf < 1) return null;
                        const fwdLeft = angleToPoint(-forwardZoneHalf, r);
                        const fwdRight = angleToPoint(forwardZoneHalf, r);
                        const transLeft = angleToPoint(-(forwardZoneHalf + transitionWidth), r);
                        const transRight = angleToPoint(forwardZoneHalf + transitionWidth, r);
                        const bwdLeft = angleToPoint(180 - forwardZoneHalf, r);
                        const bwdRight = angleToPoint(180 + forwardZoneHalf, r);
                        return (
                          <>
                            <path d={`M ${cx} ${cy} L ${fwdLeft.x} ${fwdLeft.y} A ${r} ${r} 0 0 1 ${fwdRight.x} ${fwdRight.y} Z`} fill="rgba(76, 175, 80, 0.1)" />
                            <path d={`M ${cx} ${cy} L ${bwdRight.x} ${bwdRight.y} A ${r} ${r} 0 0 1 ${bwdLeft.x} ${bwdLeft.y} Z`} fill="rgba(76, 175, 80, 0.1)" />
                            <line x1={cx} y1={cy} x2={fwdLeft.x} y2={fwdLeft.y} stroke="rgba(76, 175, 80, 0.6)" strokeWidth="1.5" strokeDasharray="4 3" />
                            <line x1={cx} y1={cy} x2={fwdRight.x} y2={fwdRight.y} stroke="rgba(76, 175, 80, 0.6)" strokeWidth="1.5" strokeDasharray="4 3" />
                            <line x1={cx} y1={cy} x2={transLeft.x} y2={transLeft.y} stroke="rgba(255, 183, 0, 0.3)" strokeWidth="1" strokeDasharray="2 4" />
                            <line x1={cx} y1={cy} x2={transRight.x} y2={transRight.y} stroke="rgba(255, 183, 0, 0.3)" strokeWidth="1" strokeDasharray="2 4" />
                            <line x1={cx} y1={cy} x2={bwdLeft.x} y2={bwdLeft.y} stroke="rgba(76, 175, 80, 0.6)" strokeWidth="1.5" strokeDasharray="4 3" />
                            <line x1={cx} y1={cy} x2={bwdRight.x} y2={bwdRight.y} stroke="rgba(76, 175, 80, 0.6)" strokeWidth="1.5" strokeDasharray="4 3" />
                          </>
                        );
                      })()}
                    </svg>
                    <div className="joystick-display" style={{ width: 200, height: 200 }}>
                      <div className="joystick-ring" />
                      <div
                        className="joystick-knob"
                        style={{
                          width: 80,
                          height: 80,
                          transform: `translate(calc(-50% + ${-currentSpeed.turn / 0.5 * 60}px), calc(-50% + ${currentSpeed.forward / 0.5 * -60}px))`,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="gamepad-visual">
                    <FontAwesomeIcon icon={faGamepad} className="gamepad-icon" size="4x" />
                    <div className="gamepad-hint">Press a button to start</div>
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
            setBillingTermination(null);
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
          showToast('Input bindings saved successfully!', 'success');
        }}
      />
    </div>
  );
}
