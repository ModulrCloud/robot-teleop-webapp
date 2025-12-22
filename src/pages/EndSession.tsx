import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { LoadingWheel } from "../components/LoadingWheel";
import "./EndSession.css";
import { usePageTitle } from "../hooks/usePageTitle";

const client = generateClient<Schema>();

export default function EndSession() {
  usePageTitle();
  const navigate = useNavigate();
  const [duration, setDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const result = await client.queries.getSessionLambda({});
        if (result.data?.durationSeconds != null) {
          setDuration(result.data.durationSeconds);
        } else {
          setDuration(0);
        }
      } catch {
        setDuration(0);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, []);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  if (loading) {
    return (
      <div className="endsession-container">
        <LoadingWheel />
      </div>
    );
  }

  return (
    <div className="endsession-container">
      <div className="success-icon">
        <svg width="64" height="64" viewBox="0 0 16 16" fill="currentColor">
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
        </svg>
      </div>
      
      <h2>Session Complete!</h2>
      
      <div className="session-stats">
        <div className="stat-item">
          <span className="stat-label">Duration</span>
          <span className="stat-value">{formatDuration(duration ?? 0)}</span>
        </div>
      </div>

      <p className="thank-you">Thank you for using Modulr!</p>

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
