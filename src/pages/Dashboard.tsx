import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatGroupName, capitalizeName } from "../utils/formatters";
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
import { generateClient } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import "./Dashboard.css";
import { UnderConstruction } from "../components/UnderConstruction";
import { logger } from '../utils/logger';

const client = generateClient<Schema>();

interface DashboardStats {
  totalSessions: number;
  totalTime: number;
  favoriteRobot: string;
  avgSessionTime: number;
}

interface RecentSession {
  id: string;
  robotName: string;
  robotId: string;
  date: Date;
  duration: number;
  status: 'completed' | 'active' | 'disconnected';
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
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState<DashboardStats>({
    totalSessions: 0,
    totalTime: 0,
    favoriteRobot: "None yet",
    avgSessionTime: 0,
  });

  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);

  const [systemStatus] = useState<SystemStatus>({
    webrtc: true,
    signaling: true,
    database: true,
  });

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const authSession = await fetchAuthSession();
      const username = authSession.tokens?.idToken?.payload?.['cognito:username'] as string;
      const groups = authSession.tokens?.idToken?.payload?.['cognito:groups'] as string[] | undefined;
      const isAdmin = groups?.includes('ADMINS');

      let result;
      if (isAdmin) {
        result = await client.models.Session.list();
      } else {
        result = await client.models.Session.list({
          filter: { userId: { eq: username } }
        });
      }

      const sessions = result.data || [];

      const completedSessions = sessions.filter(s => s.status === 'completed');
      const totalTime = completedSessions.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
      const avgTime = completedSessions.length > 0 ? Math.round(totalTime / completedSessions.length) : 0;

      const robotCounts: Record<string, number> = {};
      sessions.forEach(s => {
        const name = s.robotName || s.robotId;
        robotCounts[name] = (robotCounts[name] || 0) + 1;
      });
      const favoriteRobot = Object.entries(robotCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || "None yet";

      setStats({
        totalSessions: sessions.length,
        totalTime,
        avgSessionTime: avgTime,
        favoriteRobot,
      });

      const recent = sessions
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .slice(0, 5)
        .map(s => ({
          id: s.id || '',
          robotName: s.robotName || s.robotId,
          robotId: s.robotId,
          date: new Date(s.startedAt),
          duration: s.durationSeconds || 0,
          status: (s.status as 'completed' | 'active' | 'disconnected') || 'completed',
        }));

      setRecentSessions(recent);
    } catch (err) {
      logger.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  };

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
          <h1>Welcome back, {capitalizeName(user?.email?.split('@')[0]) || 'User'}!</h1>
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
          <UnderConstruction 
            mode="banner" 
            message="System status monitoring coming soon"
          />
          <div className="status-indicator" style={{ opacity: 0.5 }}>
            <div className={`status-dot ${allSystemsOperational ? 'online' : 'offline'}`}></div>
            <span>Mock Data - Not Live</span>
          </div>
          <div className="status-details" style={{ opacity: 0.5 }}>
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
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">
              <FontAwesomeIcon icon={faChartLine} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{loading ? '—' : stats.totalSessions}</div>
              <div className="stat-label">Total Sessions</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <FontAwesomeIcon icon={faClock} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{loading ? '—' : formatDuration(stats.totalTime)}</div>
              <div className="stat-label">Total Time</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <FontAwesomeIcon icon={faGaugeHigh} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{loading ? '—' : formatDuration(stats.avgSessionTime)}</div>
              <div className="stat-label">Avg Session</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <FontAwesomeIcon icon={faRobot} />
            </div>
            <div className="stat-content">
              <div className="stat-value truncate">{loading ? '—' : stats.favoriteRobot}</div>
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

        {loading ? (
          <div className="empty-state">
            <p>Loading sessions...</p>
          </div>
        ) : recentSessions.length > 0 ? (
          <div className="sessions-list">
            {recentSessions.map((session) => (
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
