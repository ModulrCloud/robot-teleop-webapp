import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { logger } from '../utils/logger';
import { RobotRating } from '../components/RobotRating';
import "./EndSession.css";
import { usePageTitle } from "../hooks/usePageTitle";

const client = generateClient<Schema>();

interface LocationState {
  duration?: number;
  sessionId?: string | null;
  robotId?: string | null;
}

// Cache first read so it survives React Strict Mode double-mount (second mount would otherwise get null after we remove from sessionStorage).
let endSessionStateCache: LocationState | null = null;

function readEndSessionState(location: { state: unknown }): LocationState | null {
  if (endSessionStateCache !== null) return endSessionStateCache;
  const routerState = location.state as LocationState | null;
  if (routerState?.sessionId != null) {
    endSessionStateCache = routerState;
    return routerState;
  }
  try {
    const stored = sessionStorage.getItem('endSessionState');
    if (stored) {
      const parsed = JSON.parse(stored) as LocationState;
      sessionStorage.removeItem('endSessionState');
      endSessionStateCache = parsed;
      return parsed;
    }
  } catch (e) {
    logger.error('[END_SESSION] Failed to parse sessionStorage state:', e);
  }
  return null;
}

export default function EndSession() {
  usePageTitle();
  const navigate = useNavigate();
  const location = useLocation();

  // Persist end-session state in React state so it survives re-renders (e.g. Strict Mode).
  const [endSessionState] = useState<LocationState | null>(() => readEndSessionState(location));

  const clientDuration = endSessionState?.duration ?? 0;
  const sessionId = endSessionState?.sessionId ?? null;
  const robotId = endSessionState?.robotId ?? null;

  const [serverDuration, setServerDuration] = useState<number | null>(null);
  const [robotIdFromSession, setRobotIdFromSession] = useState<string | null>(null);

  // Clear cache when leaving so next visit gets fresh state
  useEffect(() => () => { endSessionStateCache = null; }, []);

  useEffect(() => {
    const fetchSession = async () => {
      if (!sessionId) return;

      try {
        const result = await client.queries.getSessionLambda({ sessionId });
        const data = result.data;

        if (data?.robotId) {
          setRobotIdFromSession(data.robotId);
        }
        if (data?.durationSeconds != null) {
          setServerDuration(data.durationSeconds);
          return;
        }

        const startedAt = data?.startedAt;
        const endedAt = data?.endedAt;
        if (startedAt) {
          const startMs = new Date(startedAt).getTime();
          const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
          const computed = Math.max(0, Math.floor((endMs - startMs) / 1000));
          setServerDuration(computed);
        }
      } catch (err) {
        logger.error('[END_SESSION] Failed to fetch session:', err);
      }
    };

    fetchSession();
  }, [sessionId]);

  const displayDuration = Math.max(0, serverDuration ?? clientDuration);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="endsession-container">
      <div className="success-icon">
        <svg width="64" height="64" viewBox="0 0 16 16" fill="currentColor">
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z" />
        </svg>
      </div>

      <h2>Session Complete!</h2>

      <div className="session-stats">
        <div className="stat-item">
          <span className="stat-label">Duration</span>
          <span className="stat-value">{formatDuration(displayDuration)}</span>
        </div>
      </div>

      <p className="thank-you">Thank you for using Modulr.Robotics!</p>

      {(sessionId && (robotId ?? robotIdFromSession)) && (
        <div className="endsession-experience">
          <RobotRating
            robotId={robotId ?? robotIdFromSession ?? ''}
            sessionId={sessionId}
          />
        </div>
      )}

      <div className="action-buttons">
        <button onClick={() => navigate('/robots')} className="btn-primary">
          Start New Session
        </button>
        <button onClick={() => navigate('/')} className="btn-secondary">
          Return Home
        </button>
      </div>
    </div>
  );
}
