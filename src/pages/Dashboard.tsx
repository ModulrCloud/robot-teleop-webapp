import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatGroupName } from "../utils/formatters";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faRocket,
  faRobot,
  faClockRotateLeft,
  faClock,
  faCheckCircle,
  faExclamationTriangle,
  faChartLine,
  faGaugeHigh,
  faArrowRight
} from '@fortawesome/free-solid-svg-icons';
import "./Dashboard.css";
import { UnderConstruction } from "../components/UnderConstruction";

interface DashboardStats {
  totalSessions: number;
  totalTime: number;
  favoriteRobot: string;
  avgSessionTime: number;
}

interface RecentSession {
  id: string;
  robotName: string;
  date: Date;
  duration: number;
  status: 'completed' | 'error';
}

interface SystemStatus {
  webrtc: boolean;
  signaling: boolean;
  database: boolean;
}

export const Dashboard = () => {
  usePageTitle();
  const { user } = useAuthStatus();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());

  // Mock data - replace with actual API calls when sessions are implemented
  const [stats] = useState<DashboardStats>({
    totalSessions: 0, // TODO: Fetch from database
    totalTime: 0,
    favoriteRobot: "None yet",
    avgSessionTime: 0,
  });

  const [recentSessions] = useState<RecentSession[]>([
    // TODO: Fetch from database when Session model is implemented
  ]);

  const [systemStatus] = useState<SystemStatus>({
    webrtc: true,
    signaling: true,
    database: true,
  });

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  };

  const allSystemsOperational = Object.values(systemStatus).every(status => status);

  return (
    <div className="dashboard-container">
      <div className="dashboard-welcome">
        <div className="welcome-content">
          <h1>Welcome back, {user?.email?.split('@')[0] || 'User'}!</h1>
          <p className="welcome-subtitle">
            {formatGroupName(user?.group)} • {currentTime.toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
        </div>
        <div className="system-status-card">
          <div className="status-indicator">
            <div className={`status-dot ${allSystemsOperational ? 'online' : 'offline'}`}></div>
            <span>{allSystemsOperational ? 'All Systems Operational' : 'System Issues Detected'}</span>
          </div>
          <div className="status-details">
            <div className="status-item">
              <span>WebRTC</span>
              <FontAwesomeIcon 
                icon={systemStatus.webrtc ? faCheckCircle : faExclamationTriangle} 
                className={systemStatus.webrtc ? 'status-ok' : 'status-error'}
              />
            </div>
            <div className="status-item">
              <span>Signaling</span>
              <FontAwesomeIcon 
                icon={systemStatus.signaling ? faCheckCircle : faExclamationTriangle}
                className={systemStatus.signaling ? 'status-ok' : 'status-error'}
              />
            </div>
            <div className="status-item">
              <span>Database</span>
              <FontAwesomeIcon 
                icon={systemStatus.database ? faCheckCircle : faExclamationTriangle}
                className={systemStatus.database ? 'status-ok' : 'status-error'}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <h2 className="section-title">Quick Actions</h2>
        <div className="quick-actions-grid">
          <button 
            className="action-card primary"
            onClick={() => navigate('/robots')}
          >
            <div className="action-icon">
              <FontAwesomeIcon icon={faRocket} />
            </div>
            <div className="action-content">
              <h3>Start Session</h3>
              <p>Connect to a robot and start teleoperating</p>
            </div>
            <FontAwesomeIcon icon={faArrowRight} className="action-arrow" />
          </button>

          <button 
            className="action-card"
            onClick={() => navigate('/robots')}
          >
            <div className="action-icon">
              <FontAwesomeIcon icon={faRobot} />
            </div>
            <div className="action-content">
              <h3>Browse Robots</h3>
              <p>View available robots and services</p>
            </div>
            <FontAwesomeIcon icon={faArrowRight} className="action-arrow" />
          </button>

          <button 
            className="action-card"
            onClick={() => navigate('/sessions')}
          >
            <div className="action-icon">
              <FontAwesomeIcon icon={faClockRotateLeft} />
            </div>
            <div className="action-content">
              <h3>View History</h3>
              <p>Check your past sessions and stats</p>
            </div>
            <FontAwesomeIcon icon={faArrowRight} className="action-arrow" />
          </button>
        </div>
      </div>

      <div className="dashboard-section">
        <h2 className="section-title">Your Stats</h2>
        <UnderConstruction 
          mode="banner" 
          message="Real-time stats coming soon! Data will be available once session tracking is implemented."
        />
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">
              <FontAwesomeIcon icon={faChartLine} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{stats.totalSessions}</div>
              <div className="stat-label">Total Sessions</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <FontAwesomeIcon icon={faClock} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{formatDuration(stats.totalTime)}</div>
              <div className="stat-label">Total Time</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <FontAwesomeIcon icon={faGaugeHigh} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{formatDuration(stats.avgSessionTime)}</div>
              <div className="stat-label">Avg Session</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <FontAwesomeIcon icon={faRobot} />
            </div>
            <div className="stat-content">
              <div className="stat-value truncate">{stats.favoriteRobot}</div>
              <div className="stat-label">Favorite Robot</div>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <div className="section-header">
          <h2 className="section-title">Recent Sessions</h2>
          <button 
            className="view-all-btn"
            onClick={() => navigate('/sessions')}
          >
            View All <FontAwesomeIcon icon={faArrowRight} />
          </button>
        </div>

        {recentSessions.length > 0 ? (
          <div className="sessions-list">
            {recentSessions.slice(0, 5).map((session) => (
              <div key={session.id} className="session-item">
                <div className="session-icon">
                  <FontAwesomeIcon icon={faRobot} />
                </div>
                <div className="session-content">
                  <div className="session-name">{session.robotName}</div>
                  <div className="session-meta">
                    {session.date.toLocaleDateString()} • {formatDuration(session.duration)}
                  </div>
                </div>
                <div className={`session-status ${session.status}`}>
                  <FontAwesomeIcon 
                    icon={session.status === 'completed' ? faCheckCircle : faExclamationTriangle} 
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <FontAwesomeIcon icon={faClockRotateLeft} className="empty-icon" />
            <h3>No Sessions Yet</h3>
            <p>Start your first teleoperation session to see it here!</p>
            <button 
              className="empty-action-btn"
              onClick={() => navigate('/robots')}
            >
              <FontAwesomeIcon icon={faRocket} /> Start Your First Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
};