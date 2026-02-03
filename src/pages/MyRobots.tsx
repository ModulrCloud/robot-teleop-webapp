import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { LoadingWheel } from "../components/LoadingWheel";
import { RobotMessageLogger } from "../components/RobotMessageLogger";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faRobot,
  faCircle,
  faEdit,
  faArrowLeft,
  faClock,
  faDollarSign
} from '@fortawesome/free-solid-svg-icons';
import outputs from '../../amplify_outputs.json';
import './MyRobots.css';
import { logger } from '../utils/logger';

const client = generateClient<Schema>();

interface Robot {
  id: string;
  name: string;
  description: string;
  model: string;
  robotType?: string;
  robotId: string;
  imageUrl?: string;
  city?: string;
  state?: string;
  country?: string;
}

interface RobotStatus {
  isOnline: boolean;
  lastSeen?: number;
}

export default function MyRobots() {
  usePageTitle();
  const navigate = useNavigate();
  const { user } = useAuthStatus();
  const [robots, setRobots] = useState<Robot[]>([]);
  const [robotStatuses, setRobotStatuses] = useState<Record<string, RobotStatus>>({});
  const [robotRevenues, setRobotRevenues] = useState<Record<string, number>>({});
  const [selectedRobot, setSelectedRobot] = useState<Robot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionHistorySessions, setConnectionHistorySessions] = useState<Array<{
    id?: string;
    userId?: string;
    clientDisplay?: string;
    startedAt?: string;
    endedAt?: string | null;
    durationSeconds?: number | null;
    status?: string | null;
    creditsCharged?: number | null;
    partnerEarnings?: number | null;
  }>>([]);
  const [connectionHistoryLoading, setConnectionHistoryLoading] = useState(false);
  const [connectionHistoryNextToken, setConnectionHistoryNextToken] = useState<string | null>(null);

  const loadConnectionHistory = async (robotId: string, nextToken?: string | null) => {
    if (!user?.username) return;
    const isLoadMore = !!nextToken;
    if (!isLoadMore) setConnectionHistoryLoading(true);
    try {
      const result = await client.queries.listSessionsByRobotLambda({
        robotId,
        limit: 20,
        nextToken: nextToken ?? undefined,
      });
      let sessionsData: { success?: boolean; sessions?: typeof connectionHistorySessions; nextToken?: string | null } | null = null;
      const raw = result.data;
      if (typeof raw === 'string') {
        try {
          const firstParse = JSON.parse(raw);
          if (firstParse?.statusCode === 200 && firstParse?.body != null) {
            sessionsData = typeof firstParse.body === 'string' ? JSON.parse(firstParse.body) : firstParse.body;
          } else {
            sessionsData = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
          }
        } catch (e) {
          logger.warn('[MyRobots] loadConnectionHistory: parse error', e);
        }
      } else if (raw && typeof raw === 'object') {
        const lambdaRes = raw as { statusCode?: number; body?: string | object; success?: boolean; sessions?: unknown[]; nextToken?: string | null };
        if (lambdaRes.statusCode === 200 && lambdaRes.body != null) {
          const body = typeof lambdaRes.body === 'string' ? JSON.parse(lambdaRes.body) : lambdaRes.body;
          sessionsData = (typeof body === 'object' && body !== null && 'success' in body) ? (body as { success?: boolean; sessions?: typeof connectionHistorySessions; nextToken?: string | null }) : null;
        } else if ('sessions' in lambdaRes && Array.isArray(lambdaRes.sessions)) {
          // API returned body directly (e.g. { success, sessions, nextToken })
          sessionsData = { success: !!lambdaRes.success, sessions: lambdaRes.sessions as typeof connectionHistorySessions, nextToken: lambdaRes.nextToken ?? null };
        } else {
          sessionsData = (raw as { success?: boolean; sessions?: typeof connectionHistorySessions; nextToken?: string | null }) || null;
        }
      }
      if (sessionsData?.success && Array.isArray(sessionsData.sessions)) {
        if (isLoadMore) {
          setConnectionHistorySessions((prev) => {
            const merged = [...prev, ...sessionsData!.sessions!];
            merged.sort((a, b) => {
              const tA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
              const tB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
              return tB - tA;
            });
            return merged;
          });
        } else {
          setConnectionHistorySessions(sessionsData.sessions);
        }
        setConnectionHistoryNextToken(sessionsData.nextToken ?? null);
      } else {
        if (!isLoadMore) setConnectionHistorySessions([]);
        setConnectionHistoryNextToken(null);
      }
    } catch (err) {
      logger.error('[MyRobots] loadConnectionHistory failed:', err);
      if (!isLoadMore) setConnectionHistorySessions([]);
    } finally {
      if (!isLoadMore) setConnectionHistoryLoading(false);
    }
  };

  useEffect(() => {
    const loadMyRobots = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const allPartners = await client.models.Partner.list({ limit: 100 });
        const emailPrefix = user?.email?.split('@')[0] || '';
        const matchingPartner = allPartners.data?.find(p => 
          p.cognitoUsername === user?.username ||
          p.cognitoUsername === user?.email ||
          (emailPrefix && p.cognitoUsername?.includes(emailPrefix))
        );

        if (!matchingPartner) {
          setError('No partner profile found. Please complete your user setup.');
          setIsLoading(false);
          return;
        }

        const partnerId = matchingPartner.id;

        if (!partnerId) {
          setError('Partner ID not found. Please complete your user setup.');
          setIsLoading(false);
          return;
        }

        // Get all robots for this partner
        const robotsResponse = await client.models.Robot.list({
          filter: {
            partnerId: { eq: partnerId }
          }
        });

        if (robotsResponse.errors) {
          throw new Error(robotsResponse.errors[0]?.message || 'Failed to load robots');
        }

        const robotsList = (robotsResponse.data || [])
          .filter(robot => robot.id != null)
          .map(robot => ({
            id: robot.id!,
            name: robot.name || '',
            description: robot.description || '',
            model: robot.model || '',
            robotType: robot.robotType || undefined,
            robotId: robot.robotId || '',
            imageUrl: robot.imageUrl || undefined,
            city: robot.city || undefined,
            state: robot.state || undefined,
            country: robot.country || undefined,
          }));

        setRobots(robotsList);

        // Load statuses and revenues for all robots
        if (robotsList.length > 0) {
          loadRobotStatuses(robotsList);
          loadRobotRevenues(robotsList);
        }
      } catch (err) {
        logger.error('Error loading robots:', err);
        setError(err instanceof Error ? err.message : 'Failed to load robots');
      } finally {
        setIsLoading(false);
      }
    };

    if (user?.username) {
      loadMyRobots();
    }
  }, [user]);

  const loadRobotRevenues = async (_robotsList: Robot[]) => {
    try {
      if (!user?.username) return;

      const partners = await client.models.Partner.list({
        filter: {
          cognitoUsername: { eq: user.username }
        }
      });

      if (!partners.data || partners.data.length === 0) return;

      const payoutsResult = await client.queries.listPartnerPayoutsLambda({
        partnerId: user.username,
        limit: 1000, // Get all payouts
      });

      let payoutsData: { success?: boolean; payouts?: any[] } | null = null;
      const raw = payoutsResult.data;
      if (typeof raw === 'string') {
        try {
          const firstParse = JSON.parse(raw);
          if (firstParse?.statusCode === 200 && firstParse?.body != null) {
            payoutsData = typeof firstParse.body === 'string' ? JSON.parse(firstParse.body) : firstParse.body;
          } else {
            payoutsData = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
          }
        } catch (e) {
          logger.warn('[MyRobots] loadRobotRevenues: parse error', e);
          payoutsData = { success: false };
        }
      } else if (raw && typeof raw === 'object') {
        const lambdaRes = raw as { statusCode?: number; body?: string | object };
        if (lambdaRes.statusCode === 200 && lambdaRes.body != null) {
          const body = typeof lambdaRes.body === 'string' ? JSON.parse(lambdaRes.body) : lambdaRes.body;
          payoutsData = (body && typeof body === 'object' && 'success' in body) ? body as { success: boolean; payouts?: unknown[] } : { success: false };
        } else {
          payoutsData = (raw as { success?: boolean; payouts?: unknown[] }) ?? { success: false };
        }
      }

      if (!payoutsData?.success || !payoutsData.payouts) return;

      const revenueMap: Record<string, number> = {};
      payoutsData.payouts.forEach((payout: any) => {
        if (payout.robotId && payout.creditsEarnedDollars) {
          revenueMap[payout.robotId] = (revenueMap[payout.robotId] || 0) + payout.creditsEarnedDollars;
        }
      });

      setRobotRevenues(revenueMap);
    } catch (err) {
      logger.error('Error loading robot revenues:', err);
    }
  };

  const loadRobotStatuses = async (robotsList: Robot[]) => {
    try {
      const statusPromises = robotsList
        .filter(r => r.robotId)
        .map(async (robot) => {
          try {
            const status = await client.queries.getRobotStatusLambda({
              robotId: robot.robotId,
            });
            return {
              robotId: robot.robotId,
              status: {
                isOnline: status.data?.isOnline ?? false,
                lastSeen: status.data?.lastSeen ?? undefined,
              }
            };
          } catch (err) {
            logger.error(`Error loading status for ${robot.robotId}:`, err);
            return {
              robotId: robot.robotId,
              status: { isOnline: false }
            };
          }
        });

      const statuses = await Promise.all(statusPromises);
      const statusMap: Record<string, RobotStatus> = {};
      statuses.forEach(({ robotId, status }) => {
        statusMap[robotId] = status;
      });
      setRobotStatuses(statusMap);
    } catch (err) {
      logger.error('Error loading robot statuses:', err);
    }
  };

  useEffect(() => {
    if (robots.length === 0) return;

    const interval = setInterval(() => {
      loadRobotStatuses(robots);
    }, 10000); // Every 10 seconds

    return () => clearInterval(interval);
  }, [robots]);

  useEffect(() => {
    if (selectedRobot?.robotId && user?.username) {
      loadConnectionHistory(selectedRobot.robotId);
    } else {
      setConnectionHistorySessions([]);
      setConnectionHistoryNextToken(null);
    }
  }, [selectedRobot?.robotId, user?.username]);

  const handleRobotClick = (robot: Robot) => {
    setSelectedRobot(robot);
  };

  const handleEdit = (robotId: string) => {
    navigate(`/edit-robot?robotId=${robotId}`);
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  const getRobotImage = (robotType?: string, imageUrl?: string): string => {
    if (imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('/'))) {
      return imageUrl;
    }
    
    const typeImages: Record<string, string> = {
      'rover': '/default/rover.png',
      'humanoid': '/default/robot.png',
      'drone': '/default/drone.png',
      'sub': '/default/sub.png',
      'robodog': '/default/robodog.png',
      'robot': '/default/humanoid.png',
    };
    
    return typeImages[robotType?.toLowerCase() || ''] || '/default/humanoid.png';
  };

  if (isLoading) {
    return (
      <div className="my-robots-page">
        <LoadingWheel />
      </div>
    );
  }

  if (error) {
    return (
      <div className="my-robots-page">
        <div className="my-robots-header">
          <button onClick={() => navigate('/robots')} className="back-button">
            <FontAwesomeIcon icon={faArrowLeft} />
            Back
          </button>
          <h1>My Robots</h1>
        </div>
        <div className="error-message">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (selectedRobot) {
    const status = robotStatuses[selectedRobot.robotId] || { isOnline: false };
    
    return (
      <div className="my-robots-page">
        <div className="my-robots-header">
          <button onClick={() => setSelectedRobot(null)} className="back-button">
            <FontAwesomeIcon icon={faArrowLeft} />
            Back to My Robots
          </button>
          <h1>{selectedRobot.name}</h1>
        </div>

        <div className="robot-detail-container">
          <div className="robot-detail-card">
            <div className="robot-detail-header">
              <div className="robot-detail-title">
                <FontAwesomeIcon icon={faRobot} />
                <h2>Robot Information</h2>
              </div>
              <div className="robot-detail-actions">
                <button 
                  onClick={() => handleEdit(selectedRobot.id)}
                  className="action-button edit-button"
                >
                  <FontAwesomeIcon icon={faEdit} />
                  Edit
                </button>
              </div>
            </div>

            <div className="robot-detail-content">
              <div className="detail-row">
                <span className="detail-label">Status:</span>
                <span className={`detail-value status ${status.isOnline ? 'online' : 'offline'}`}>
                  <FontAwesomeIcon 
                    icon={faCircle} 
                    style={{ 
                      fontSize: '0.6rem',
                      color: status.isOnline ? '#ffb700' : '#666',
                      marginRight: '0.5rem'
                    }} 
                  />
                  {status.isOnline ? 'Online' : 'Offline'}
                </span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Robot ID:</span>
                <span className="detail-value">{selectedRobot.robotId || 'N/A'}</span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Model:</span>
                <span className="detail-value">{selectedRobot.model || 'N/A'}</span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Description:</span>
                <span className="detail-value">{selectedRobot.description || 'No description'}</span>
              </div>

              {selectedRobot.city || selectedRobot.state || selectedRobot.country ? (
                <div className="detail-row">
                  <span className="detail-label">Location:</span>
                  <span className="detail-value">
                    {[selectedRobot.city, selectedRobot.state, selectedRobot.country]
                      .filter(Boolean)
                      .join(', ') || 'Not specified'}
                  </span>
                </div>
              ) : null}

              {status.lastSeen ? (
                <div className="detail-row">
                  <span className="detail-label">Last Seen:</span>
                  <span className="detail-value">
                    <FontAwesomeIcon icon={faClock} style={{ marginRight: '0.5rem' }} />
                    {formatDate(status.lastSeen)}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="robot-detail-card">
            <div className="robot-detail-title">
              <FontAwesomeIcon icon={faClock} />
              <h2>Connection History</h2>
            </div>
            {connectionHistoryLoading ? (
              <div className="connection-history-placeholder">
                <p>Loading connection history...</p>
              </div>
            ) : connectionHistorySessions.length === 0 ? (
              <div className="connection-history-placeholder">
                <p>No connection history yet for this robot.</p>
                <p className="placeholder-note">Completed teleop sessions will appear here (client, when, duration, earnings).</p>
              </div>
            ) : (
              <div className="connection-history-table-wrap">
                <table className="connection-history-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>When</th>
                      <th>Duration</th>
                      <th>Status</th>
                      <th>Partner earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connectionHistorySessions.map((session) => (
                      <tr key={session.id ?? session.startedAt ?? Math.random()}>
                        <td>{session.clientDisplay ?? '—'}</td>
                        <td>{session.startedAt ? new Date(session.startedAt).toLocaleString() : '—'}</td>
                        <td>
                          {session.durationSeconds != null
                            ? `${Math.floor(session.durationSeconds / 60)}m ${session.durationSeconds % 60}s`
                            : session.endedAt && session.startedAt
                              ? (() => {
                                  const d = (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000;
                                  return `${Math.floor(d / 60)}m ${Math.floor(d % 60)}s`;
                                })()
                              : '—'}
                        </td>
                        <td>{session.status ?? '—'}</td>
                        <td>
                          {session.partnerEarnings != null
                            ? `$${((session.partnerEarnings ?? 0) / 100).toFixed(2)}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {connectionHistoryNextToken && (
                  <div className="connection-history-show-more">
                    <button
                      type="button"
                      className="show-more-button"
                      onClick={() => selectedRobot && loadConnectionHistory(selectedRobot.robotId, connectionHistoryNextToken)}
                      disabled={connectionHistoryLoading}
                    >
                      Show more
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="robot-detail-card">
            <RobotMessageLogger 
              robotId={selectedRobot.robotId}
              wsUrl={outputs?.custom?.signaling?.websocketUrl || (import.meta.env.VITE_WS_URL || 'ws://localhost:8765')}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="my-robots-page">
      <div className="my-robots-header">
        <button onClick={() => navigate('/robots')} className="back-button">
          <FontAwesomeIcon icon={faArrowLeft} />
          Back to Robots
        </button>
        <h1>My Robots</h1>
        <p className="subtitle">Manage your registered robots</p>
      </div>

      {robots.length === 0 ? (
        <div className="empty-state">
          <FontAwesomeIcon icon={faRobot} size="3x" />
          <h2>No Robots Yet</h2>
          <p>You haven't registered any robots yet.</p>
          <button 
            onClick={() => navigate('/create-robot-listing')}
            className="create-button"
          >
            Create Your First Robot
          </button>
        </div>
      ) : (
        <div className="robots-grid">
          {robots.map((robot) => {
            const status = robotStatuses[robot.robotId] || { isOnline: false };
            return (
              <div 
                key={robot.id} 
                className="robot-card"
                onClick={() => handleRobotClick(robot)}
              >
                <div className="robot-card-image">
                  <img src={getRobotImage(robot.robotType, robot.imageUrl)} alt={robot.name} />
                </div>
                <div className="robot-card-header">
                  <div className="robot-card-title">
                    <FontAwesomeIcon icon={faRobot} />
                    <h3>{robot.name}</h3>
                  </div>
                  <div className={`robot-status-badge ${status.isOnline ? 'online' : 'offline'}`}>
                    <FontAwesomeIcon 
                      icon={faCircle} 
                      style={{ 
                        fontSize: '0.5rem',
                        color: status.isOnline ? '#ffb700' : '#666'
                      }} 
                    />
                    {status.isOnline ? 'Online' : 'Offline'}
                  </div>
                </div>
                <p className="robot-card-description">{robot.description || 'No description'}</p>
                {robotRevenues[robot.robotId] !== undefined && (
                  <div className="robot-card-revenue" style={{
                    marginTop: '0.5rem',
                    padding: '0.5rem',
                    backgroundColor: 'rgba(255, 183, 0, 0.1)',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(255, 183, 0, 0.2)',
                  }}>
                    <FontAwesomeIcon icon={faDollarSign} style={{ marginRight: '0.5rem', color: '#ffb700' }} />
                    <strong style={{ color: '#ffb700' }}>
                      Revenue: ${robotRevenues[robot.robotId].toFixed(2)}
                    </strong>
                  </div>
                )}
                <div className="robot-card-footer">
                  <span className="robot-card-id">ID: {robot.robotId || 'N/A'}</span>
                  <div className="robot-card-actions">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(robot.id);
                      }}
                      className="icon-button"
                      title="Edit Robot"
                    >
                      <FontAwesomeIcon icon={faEdit} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


