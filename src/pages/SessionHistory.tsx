import { useEffect, useState } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { generateClient } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClock, faRobot, faCalendar } from '@fortawesome/free-solid-svg-icons';
import "./SessionHistory.css";

const client = generateClient<Schema>();

interface Session {
  id: string;
  robotId: string;
  robotName?: string | null;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds?: number | null;
  status?: string | null;
}

const STALE_SESSION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export const SessionHistory = () => {
  usePageTitle();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [userGroup, setUserGroup] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const authSession = await fetchAuthSession();
      const groups = authSession.tokens?.idToken?.payload?.['cognito:groups'] as string[] | undefined;
      const username = authSession.tokens?.idToken?.payload?.['cognito:username'] as string;
      
      const group = groups?.[0] || null;
      setUserGroup(group);

      let result;
      if (group === 'ADMINS') {
        // Admins see all sessions
        result = await client.models.Session.list();
      } else {
        // Users see their own sessions
        result = await client.models.Session.list({
          filter: { userId: { eq: username } }
        });
      }

      const sessions = result.data || [];
      const now = Date.now();

      // Auto-cleanup: Mark stale active sessions as disconnected
      for (const session of sessions) {
        if (session.status === 'active') {
          const startTime = new Date(session.startedAt).getTime();
          const elapsed = now - startTime;
          
          // If session is active but older than threshold, mark as disconnected
          if (elapsed > STALE_SESSION_THRESHOLD_MS) {
            try {
              await client.models.Session.update({
                id: session.id,
                endedAt: new Date().toISOString(),
                durationSeconds: Math.floor(elapsed / 1000),
                status: 'disconnected',
              });
              session.status = 'disconnected';
              session.durationSeconds = Math.floor(elapsed / 1000);
            } catch (err) {
              console.error('Failed to cleanup stale session:', err);
            }
          }
        }
      }

      const sessionData = sessions.map(s => ({
        id: s.id,
        robotId: s.robotId,
        robotName: s.robotName,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationSeconds: s.durationSeconds,
        status: s.status,
      }));

      // Sort by most recent first
      sessionData.sort((a, b) => 
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );

      setSessions(sessionData as Session[]);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number | null | undefined) => {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="session-history-page">
        <div className="loading">Loading sessions...</div>
      </div>
    );
  }

  return (
    <div className="session-history-page">
      <div className="page-header">
        <h1>Session History</h1>
        <p className="subtitle">
          {userGroup === 'ADMINS' ? 'All user sessions' : 'Your teleoperation sessions'}
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <FontAwesomeIcon icon={faRobot} />
          <h3>No sessions yet</h3>
          <p>Your completed sessions will appear here</p>
        </div>
      ) : (
        <div className="sessions-list">
          {sessions.map(session => (
            <div key={session.id} className="session-card">
              <div className="session-robot">
                <FontAwesomeIcon icon={faRobot} />
                <span>{session.robotName || session.robotId}</span>
              </div>
              
              <div className="session-details">
                <div className="session-stat">
                  <FontAwesomeIcon icon={faCalendar} />
                  <span>{formatDate(session.startedAt)}</span>
                </div>
                <div className="session-stat">
                  <FontAwesomeIcon icon={faClock} />
                  <span>{formatDuration(session.durationSeconds)}</span>
                </div>
              </div>

              <div className={`session-status ${session.status || 'unknown'}`}>
                {session.status || 'unknown'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
