import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClock, faCalendarAlt } from '@fortawesome/free-solid-svg-icons';
import { logger } from '../utils/logger';
import { formatCreditsAsCurrencySync } from '../utils/credits';
import './UserReservations.css';

const client = generateClient<Schema>();

interface UserReservationsProps {
  robotId: string;
  userCurrency: string;
  exchangeRates?: Record<string, number>;
  refreshTrigger?: number; // Key to force refresh
}

interface Reservation {
  id: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  status: string;
  depositCredits: number;
  totalCostCredits: number;
}

export function UserReservations({
  robotId,
  userCurrency,
  exchangeRates,
  refreshTrigger,
}: UserReservationsProps) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadReservations();
  }, [robotId, refreshTrigger]);

  const loadReservations = async () => {
    try {
      setIsLoading(true);
      const result = await client.queries.listRobotReservationsLambda({
        robotId,
        limit: 50,
      });

      if (result.data) {
        const parsed = JSON.parse(result.data as string);
        if (parsed.statusCode === 200) {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          // Filter to only show pending, confirmed, and active reservations
          const activeStatuses = ['pending', 'confirmed', 'active'];
          const filtered = (body.reservations || []).filter((r: Reservation) => 
            activeStatuses.includes(r.status.toLowerCase())
          );
          setReservations(filtered);
        }
      }
    } catch (err) {
      logger.error('Error loading reservations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  if (isLoading) {
    return (
      <div className="user-reservations">
        <p>Loading reservations...</p>
      </div>
    );
  }

  if (reservations.length === 0) {
    return null; // Don't show section if no reservations
  }

  return (
    <div className="user-reservations">
      <h3>
        <FontAwesomeIcon icon={faCalendarAlt} />
        Your Reservations
      </h3>
      <div className="reservations-list">
        {reservations.map((reservation) => (
          <div key={reservation.id} className="reservation-card">
            <div className="reservation-info">
              <div className="reservation-time">
                <FontAwesomeIcon icon={faClock} />
                <div>
                  <strong>{formatDate(reservation.startTime)}</strong>
                  <span>{formatTime(reservation.startTime)} - {formatTime(reservation.endTime)}</span>
                </div>
              </div>
              <div className="reservation-details">
                <span className="duration">{reservation.durationMinutes} minutes</span>
                <span className={`status status-${reservation.status}`}>{reservation.status}</span>
              </div>
              <div className="reservation-cost">
                <span>Deposit: {formatCreditsAsCurrencySync(reservation.depositCredits, userCurrency as any, exchangeRates)}</span>
                <span>Total: {formatCreditsAsCurrencySync(reservation.totalCostCredits, userCurrency as any, exchangeRates)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

