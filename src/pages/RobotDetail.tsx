import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { useUserCredits } from "../hooks/useUserCredits";
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { getUrl } from 'aws-amplify/storage';
import { logger } from '../utils/logger';
import { formatCreditsAsCurrencySync, fetchExchangeRates } from '../utils/credits';
import { PurchaseCreditsModal } from '../components/PurchaseCreditsModal';
import { RobotRating } from '../components/RobotRating';
import { ReviewsDisplay } from '../components/ReviewsDisplay';
import { RobotSchedulingModal } from '../components/RobotSchedulingModal';
import { UserReservations } from '../components/UserReservations';
import { InputBindingsModal } from '../components/InputBindingsModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faMapMarkerAlt, faUser, faCircle, faStar, faCalendarAlt, faKeyboard, faCog, faTools, faLock } from '@fortawesome/free-solid-svg-icons';
import { isFeatureEnabled } from '../utils/featureFlags';
import "./RobotDetail.css";

const client = generateClient<Schema>();

const getRobotImage = (model: string, imageUrl?: string): string => {
  if (imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('/'))) {
    return imageUrl;
  }

  const modelImages: Record<string, string> = {
    'rover': '/default/rover.png',
    'humanoid': '/default/humanoid.png',
    'drone': '/default/drone.png',
    'sub': '/default/sub.png',
    'robodog': '/default/robodog.png',
    'robot': '/default/robot.png',
  };

  return modelImages[model?.toLowerCase() || ''] || '/default/humanoid.png';
};

export default function RobotDetail() {
  usePageTitle();
  const { robotId } = useParams<{ robotId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStatus();
  const { credits, refreshCredits } = useUserCredits();

  const [robot, setRobot] = useState<any>(null);
  const [robotImage, setRobotImage] = useState<string>('');
  const [partner, setPartner] = useState<any>(null);
  const [robotStatus, setRobotStatus] = useState<{ isOnline: boolean; status?: string } | null>(null);
  const [isInUse, setIsInUse] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformMarkup, setPlatformMarkup] = useState<number>(30);
  const [userCurrency, setUserCurrency] = useState<string>('USD');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(null);
  const [insufficientFundsError, setInsufficientFundsError] = useState<string | null>(null);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [isPartnerOwner, setIsPartnerOwner] = useState(false);
  const [partnerIdForResponse, setPartnerIdForResponse] = useState<string | null>(null);
  const [recentSessionId, setRecentSessionId] = useState<string | null>(null);
  const [ratingsRefreshKey, setRatingsRefreshKey] = useState(0);
  const [showSchedulingModal, setShowSchedulingModal] = useState(false);
  const [reservationsRefreshKey, setReservationsRefreshKey] = useState(0);
  const [showInputBindingsModal, setShowInputBindingsModal] = useState(false);
  const [showPricingDetails, setShowPricingDetails] = useState(false);
  const servicesSubtotalCredits = 0;

  // Load platform settings and user currency
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Load platform markup
        const { data: settings } = await client.models.PlatformSettings.list({
          filter: { settingKey: { eq: 'platformMarkupPercent' } },
        });
        if (settings && settings.length > 0) {
          setPlatformMarkup(parseFloat(settings[0].settingValue || '30'));
        }

        // Load user's currency preference
        if (user?.username) {
          const { data: partners } = await client.models.Partner.list({
            filter: { cognitoUsername: { eq: user.username } },
          });
          if (partners && partners.length > 0 && partners[0].preferredCurrency) {
            setUserCurrency(partners[0].preferredCurrency.toUpperCase());
          } else {
            const { data: clients } = await client.models.Client.list({
              filter: { cognitoUsername: { eq: user.username } },
            });
            if (clients && clients.length > 0 && clients[0].preferredCurrency) {
              setUserCurrency(clients[0].preferredCurrency.toUpperCase());
            }
          }
        }

        // Fetch exchange rates
        const rates = await fetchExchangeRates();
        setExchangeRates(rates);
      } catch (err) {
        logger.error("Error loading settings:", err);
      }
    };

    loadSettings();
  }, [user?.username]);

  // Load robot data
  useEffect(() => {
    const loadRobot = async () => {
      if (!robotId) {
        setError('Robot ID is required');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Get robot by robotId
        const { data: robots, errors } = await client.models.Robot.list({
          filter: { robotId: { eq: robotId } },
        });

        if (errors && errors.length > 0) {
          throw new Error(errors[0].message || 'Failed to load robot');
        }

        if (!robots || robots.length === 0) {
          setError('Robot not found');
          setIsLoading(false);
          return;
        }

        const robotData = robots[0];
        setRobot(robotData);

        // Load robot image
        if (robotData.imageUrl) {
          // Check if it's already a URL or local path
          if (robotData.imageUrl.startsWith('http') || robotData.imageUrl.startsWith('/')) {
            setRobotImage(robotData.imageUrl);
          } else {
            // It's an S3 key - resolve it
            try {
              const imageUrl = await getUrl({
                path: robotData.imageUrl,
                options: { expiresIn: 3600 },
              });
              setRobotImage(imageUrl.url.toString());
            } catch (err) {
              logger.warn('Failed to load robot image from S3:', err);
              // Fall back to model-based default
              setRobotImage(getRobotImage(robotData.model || 'humanoid'));
            }
          }
        } else {
          setRobotImage(getRobotImage(robotData.model || 'humanoid'));
        }

        // Load partner information
        if (robotData.partnerId) {
          try {
            const { data: partners } = await client.models.Partner.list({
              filter: { id: { eq: robotData.partnerId } },
            });
            if (partners && partners.length > 0) {
              setPartner(partners[0]);

              // Check if current user is the partner owner
              if (user?.username && partners[0].cognitoUsername === user.username) {
                setIsPartnerOwner(true);
                setPartnerIdForResponse(partners[0].id);
              }
            }
          } catch (err) {
            logger.warn('Failed to load partner:', err);
          }
        }

        setIsLoading(false);
      } catch (err) {
        logger.error('Error loading robot:', err);
        setError(err instanceof Error ? err.message : 'Failed to load robot');
        setIsLoading(false);
      }
    };

    loadRobot();
  }, [robotId]);

  // Load robot status
  useEffect(() => {
    const loadRobotStatus = async () => {
      if (!robotId) return;

      try {
        const status = await client.queries.getRobotStatusLambda({
          robotId: robotId,
        });

        if (status.data) {
          setRobotStatus({
            isOnline: status.data.isOnline || false,
            status: status.data.status || undefined,
          });
        } else {
          setRobotStatus({ isOnline: false });
        }
      } catch (err) {
        logger.error('Error loading robot status:', err);
        setRobotStatus({ isOnline: false });
      }
    };

    loadRobotStatus();

    // Poll status every 10 seconds
    const interval = setInterval(loadRobotStatus, 10000);
    return () => clearInterval(interval);
  }, [robotId]);

  // Check if robot is in use (has active session)
  useEffect(() => {
    const checkIfInUse = async () => {
      if (!robotId || !user?.username) return;

      try {
        const { data: sessions } = await client.models.Session.list({
          filter: {
            robotId: { eq: robotId },
            status: { eq: 'active' },
          },
        });

        // Check if there's an active session by another user
        const activeSession = sessions?.find(
          session => session.userId !== user.username && session.status === 'active'
        );

        setIsInUse(!!activeSession);
      } catch (err) {
        logger.warn('Error checking if robot is in use:', err);
      }
    };

    checkIfInUse();

    // Poll every 5 seconds
    const interval = setInterval(checkIfInUse, 5000);
    return () => clearInterval(interval);
  }, [robotId, user?.username]);

  // Find recent session for this robot by current user (for rating validation)
  useEffect(() => {
    const findRecentSession = async () => {
      if (!robotId || !user?.username) return;

      try {
        const { data: sessions } = await client.models.Session.list({
          filter: {
            robotId: { eq: robotId },
            userId: { eq: user.username },
          },
        });

        // Find the most recent completed session (duration >= 5 minutes)
        const recentSession = sessions
          ?.filter(s => s.status === 'completed' && (s.durationSeconds || 0) >= 300)
          ?.sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
          })?.[0];

        if (recentSession?.id) {
          setRecentSessionId(recentSession.id);
        }
      } catch (err) {
        logger.warn('Error finding recent session:', err);
      }
    };

    findRecentSession();
  }, [robotId, user?.username]);

  const handleStartSession = async () => {
    if (!robot) return;

    setInsufficientFundsError(null);

    // Calculate cost for 1 minute (minimum session time)
    const hourlyRateCredits = robot.hourlyRateCredits || 100;
    const durationMinutes = 1;
    const durationHours = durationMinutes / 60;
    const baseCostCredits = hourlyRateCredits * durationHours;
    const platformFeeCredits = baseCostCredits * (platformMarkup / 100);
    const totalCreditsForMinute = baseCostCredits + platformFeeCredits;

    // Check if user has enough credits for at least 1 minute
    if (credits < totalCreditsForMinute) {
      const formattedCost = formatCreditsAsCurrencySync(
        totalCreditsForMinute,
        userCurrency as any,
        exchangeRates || undefined
      );
      const formattedBalance = formatCreditsAsCurrencySync(
        credits,
        userCurrency as any,
        exchangeRates || undefined
      );
      setInsufficientFundsError(
        `Insufficient credits. You need at least ${formattedCost} for a 1-minute session, but you only have ${formattedBalance}. Please top up your account.`
      );
      setShowPurchaseModal(true);
      return;
    }

    // User has enough credits - proceed to teleop
    navigate(`/teleop?robotId=${robot.robotId || robot.id}`);
  };

  const getStatusDisplay = (): { text: string; color: string; icon: any } => {
    if (isInUse) {
      return { text: 'In Use', color: '#ff9800', icon: faCircle };
    }
    if (robotStatus?.isOnline) {
      return { text: 'Online', color: '#4caf50', icon: faCircle };
    }
    return { text: 'Offline', color: '#f44336', icon: faCircle };
  };

  if (isLoading) {
    return (
      <div className="robot-detail-container">
        <div className="loading-container">
          <p>Loading robot details...</p>
        </div>
      </div>
    );
  }

  if (error || !robot) {
    return (
      <div className="robot-detail-container">
        <button className="back-button" onClick={() => navigate('/robots')}>
          <FontAwesomeIcon icon={faArrowLeft} /> Back to Robots
        </button>
        <div className="error-container">
          <p>{error || 'Robot not found'}</p>
        </div>
      </div>
    );
  }

  const statusDisplay = getStatusDisplay();
  // Calculate total hourly rate including platform markup (like Steam - show total price)
  const baseRateCredits = robot.hourlyRateCredits || 100;
  const totalRateCredits = baseRateCredits * (1 + platformMarkup / 100);
  const hourlyRateFormatted = formatCreditsAsCurrencySync(
    totalRateCredits,
    userCurrency as any,
    exchangeRates || undefined
  );

  const locationParts = [robot.city, robot.state, robot.country].filter(Boolean);
  const locationDisplay = locationParts.length > 0 ? locationParts.join(', ') : 'Location not specified';

  return (
    <div className="robot-detail-container">
      <div className="robot-detail-topbar">
        <button className="back-button" onClick={() => navigate('/robots')}>
          <FontAwesomeIcon icon={faArrowLeft} /> Back to Robots
        </button>
        <button
          className="start-session-button"
          onClick={handleStartSession}
          disabled={!robotStatus?.isOnline || isInUse}
        >
          Start Session
        </button>
      </div>

      {insufficientFundsError && (
        <div className="insufficient-funds-error">
          {insufficientFundsError}
        </div>
      )}

      {user && robot.robotId && (
        <div className="robot-detail-reservation-banner">
          <UserReservations
            robotId={robot.robotId}
            userCurrency={userCurrency}
            exchangeRates={exchangeRates || undefined}
            refreshTrigger={reservationsRefreshKey}
            variant="banner"
            limit={1}
          />
        </div>
      )}

      <div className="robot-detail-content">
        <div className="robot-detail-main">
          <div className="robot-image-section">
            <img src={robotImage} alt={robot.name || 'Robot'} className="robot-detail-image" />
          </div>

          <div className="robot-info-section">
            <h1 className="robot-detail-name">{robot.name || 'Unnamed Robot'}</h1>

            {robot.description && (
              <p className="robot-detail-description">{robot.description}</p>
            )}

            <div className="robot-info-boxes">
              <div className="robot-detail-meta">
                <div className="robot-meta-item">
                  <span className="robot-meta-label">Model:</span>
                  <span className="robot-meta-value">{robot.model || 'N/A'}</span>
                </div>

                <div className="robot-meta-item">
                  <span className="robot-meta-label">Hourly Rate:</span>
                  <span className="robot-meta-value price">{hourlyRateFormatted}/hour</span>
                </div>

                <div className="robot-meta-item">
                  <span className="robot-meta-label">Status:</span>
                  <span className="robot-meta-value status">
                    <FontAwesomeIcon icon={statusDisplay.icon} style={{ color: statusDisplay.color, marginRight: '0.5rem' }} />
                    {statusDisplay.text}
                  </span>
                </div>

                <div className="robot-meta-item">
                  <FontAwesomeIcon icon={faMapMarkerAlt} className="meta-icon" />
                  <span className="robot-meta-value">{locationDisplay}</span>
                </div>

                {partner && (
                  <div className="robot-meta-item">
                    <FontAwesomeIcon icon={faUser} className="meta-icon" />
                    <span className="robot-meta-value">Partner: {partner.name || 'Unknown'}</span>
                  </div>
                )}
              </div>

              {/* Configure Section */}
              {robot && robot.robotId && (
                <div className="robot-scheduling-section">
                  <h2>
                    <FontAwesomeIcon icon={faCog} />
                    Configure
                  </h2>
                  <p className="scheduling-description">
                    Manage scheduling, input bindings, and services for this robot.
                  </p>
                  <div className="configure-buttons">
                    <button
                      className="schedule-button"
                      onClick={() => setShowSchedulingModal(true)}
                    >
                      <FontAwesomeIcon icon={faCalendarAlt} />
                      Schedule Robot Time
                    </button>
                    {isFeatureEnabled('CUSTOM_ROS_COMMANDS') ? (
                      <button
                        className="schedule-button"
                        onClick={() => setShowInputBindingsModal(true)}
                      >
                        <FontAwesomeIcon icon={faKeyboard} />
                        Input Bindings
                      </button>
                    ) : (
                      <button
                        className="schedule-button schedule-button-disabled"
                        disabled
                        aria-disabled="true"
                        title="Input bindings are coming soon"
                      >
                        <FontAwesomeIcon icon={faLock} />
                        Input Bindings (coming soon)
                      </button>
                    )}
                    <button
                      className="schedule-button schedule-button-disabled"
                      disabled
                      aria-disabled="true"
                      title="Services selection is coming soon"
                    >
                      <FontAwesomeIcon icon={faTools} />
                      Services (coming soon)
                    </button>
                  </div>
                  <div className="services-placeholder">
                    Services can be added here before teleop starts. We'll show pricing in advance.
                  </div>
                  <div className="cost-summary compact">
                    <div className="cost-summary-row total">
                      <span>Estimated cost per hour</span>
                      <span>
                        {formatCreditsAsCurrencySync(
                          ((robot.hourlyRateCredits || 0) + servicesSubtotalCredits) * (1 + platformMarkup / 100),
                          userCurrency as any,
                          exchangeRates || undefined
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="cost-summary-toggle"
                      onClick={() => setShowPricingDetails((prev) => !prev)}
                    >
                      {showPricingDetails ? 'Hide details' : 'View details'}
                    </button>
                    {showPricingDetails && (
                      <>
                        <div className="cost-summary-row">
                          <span>Robot rate</span>
                          <span>
                            {formatCreditsAsCurrencySync(
                              (robot.hourlyRateCredits || 0) * (1 + platformMarkup / 100),
                              userCurrency as any,
                              exchangeRates || undefined
                            )}
                          </span>
                        </div>
                        <div className="cost-summary-row">
                          <span>Services subtotal</span>
                          <span>
                            {formatCreditsAsCurrencySync(
                              servicesSubtotalCredits * (1 + platformMarkup / 100),
                              userCurrency as any,
                              exchangeRates || undefined
                            )}
                          </span>
                        </div>
                        <p className="cost-summary-note">
                          Services pricing will appear here before teleop starts.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="robot-specs-section">
          <h2>Specifications</h2>
          <p className="specs-placeholder">Specifications will be available soon.</p>
        </div>

        {user && robot.robotId && (
          <UserReservations
            robotId={robot.robotId}
            userCurrency={userCurrency}
            exchangeRates={exchangeRates || undefined}
            refreshTrigger={reservationsRefreshKey}
            variant="section"
          />
        )}

        <div className="robot-reviews-section">
          <h2>Ratings & Reviews</h2>

          {/* Average Rating Display */}
          {robot.averageRating && (
            <div className="average-rating-display">
              <div className="average-rating-value">
                <FontAwesomeIcon icon={faStar} className="star-icon" />
                <span className="rating-number">{robot.averageRating.toFixed(1)}</span>
                <span className="rating-out-of">/ 5.0</span>
              </div>
            </div>
          )}

          {/* Rating Form - requires a completed session */}
          {user && robot.robotId && (
            recentSessionId || user.email?.toLowerCase().endsWith('@modulr.cloud') ? (
              <RobotRating
                robotId={robot.robotId}
                sessionId={recentSessionId}
                onRatingSubmitted={() => {
                  setRatingsRefreshKey(prev => prev + 1);
                  if (robotId) {
                    client.models.Robot.list({
                      filter: { robotId: { eq: robotId } },
                    }).then(({ data: robots }) => {
                      if (robots && robots.length > 0) {
                        setRobot(robots[0]);
                      }
                    });
                  }
                }}
              />
            ) : (
              <div className="rating-gate-message">
                <p>Complete a session with this robot to leave a rating.</p>
              </div>
            )
          )}

          {/* Reviews Display */}
          {robot.robotId && (
            <ReviewsDisplay
              key={ratingsRefreshKey}
              robotId={robot.robotId}
              isPartner={isPartnerOwner}
              partnerId={partnerIdForResponse || undefined}
              onResponseSubmitted={() => {
                setRatingsRefreshKey(prev => prev + 1);
              }}
            />
          )}
        </div>
      </div>

      <RobotSchedulingModal
        isOpen={showSchedulingModal}
        onClose={() => setShowSchedulingModal(false)}
        robotId={robot?.robotId || ''}
        robotUuid={robot?.id}
        hourlyRateCredits={robot?.hourlyRateCredits || 100}
        platformMarkup={platformMarkup}
        userCurrency={userCurrency}
        exchangeRates={exchangeRates || undefined}
        userCredits={credits}
        onReservationCreated={() => {
          refreshCredits();
          setReservationsRefreshKey(prev => prev + 1);
        }}
      />

      <PurchaseCreditsModal
        isOpen={showPurchaseModal}
        onClose={() => {
          setShowPurchaseModal(false);
          setInsufficientFundsError(null);
          refreshCredits();
        }}
      />

      <InputBindingsModal
        isOpen={showInputBindingsModal}
        onClose={() => setShowInputBindingsModal(false)}
        robotId={robot?.robotId || ''}
      />
    </div>
  );
}

