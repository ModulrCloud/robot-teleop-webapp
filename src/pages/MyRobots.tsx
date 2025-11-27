import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { LoadingWheel } from "../components/LoadingWheel";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faRobot,
  faCircle,
  faEdit,
  faArrowLeft,
  faClock
} from '@fortawesome/free-solid-svg-icons';
import './MyRobots.css';

const client = generateClient<Schema>();

interface Robot {
  id: string;
  name: string;
  description: string;
  model: string;
  robotId: string;
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
  const [selectedRobot, setSelectedRobot] = useState<Robot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load user's robots
  useEffect(() => {
    const loadMyRobots = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Get user's partnerId by querying Partner table
        // First, we need to get the current user's partner record
        const partners = await client.models.Partner.list({
          filter: {
            cognitoUsername: { eq: user?.username || '' }
          }
        });

        if (partners.errors || !partners.data || partners.data.length === 0) {
          setError('No partner profile found. Please complete your user setup.');
          setIsLoading(false);
          return;
        }

        const partnerId = partners.data[0].id;

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
          .filter(robot => robot.id != null) // Filter out robots without IDs
          .map(robot => ({
            id: robot.id!,
            name: robot.name || '',
            description: robot.description || '',
            model: robot.model || '',
            robotId: robot.robotId || '',
            city: robot.city || undefined,
            state: robot.state || undefined,
            country: robot.country || undefined,
          }));

        setRobots(robotsList);

        // Load statuses for all robots
        if (robotsList.length > 0) {
          loadRobotStatuses(robotsList);
        }
      } catch (err) {
        console.error('Error loading robots:', err);
        setError(err instanceof Error ? err.message : 'Failed to load robots');
      } finally {
        setIsLoading(false);
      }
    };

    if (user?.username) {
      loadMyRobots();
    }
  }, [user]);

  // Load status for all robots
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
            console.error(`Error loading status for ${robot.robotId}:`, err);
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
      console.error('Error loading robot statuses:', err);
    }
  };

  // Refresh statuses periodically
  useEffect(() => {
    if (robots.length === 0) return;

    const interval = setInterval(() => {
      loadRobotStatuses(robots);
    }, 10000); // Every 10 seconds

    return () => clearInterval(interval);
  }, [robots]);

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
            <div className="connection-history-placeholder">
              <p>Connection history will be displayed here once tracking is implemented.</p>
              <p className="placeholder-note">This will show the last 10 connection/disconnection events with timestamps.</p>
            </div>
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
          Back
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


