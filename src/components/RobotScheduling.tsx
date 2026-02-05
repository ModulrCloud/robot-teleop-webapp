import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faCalendarAlt, 
  faClock, 
  faCheckCircle, 
  faExclamationCircle,
  faInfoCircle,
  faDollarSign
} from '@fortawesome/free-solid-svg-icons';
import { logger } from '../utils/logger';
import { formatCreditsAsCurrencySync } from '../utils/credits';
import './RobotScheduling.css';

const client = generateClient<Schema>();

interface RobotSchedulingProps {
  robotId: string; // robotId string (robot-XXXXXXXX)
  robotUuid?: string; // Optional UUID
  hourlyRateCredits: number;
  platformMarkup: number;
  userCurrency: string;
  exchangeRates?: Record<string, number>;
  userCredits: number;
  onReservationCreated?: () => void;
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

export function RobotScheduling({
  robotId,
  hourlyRateCredits,
  platformMarkup,
  userCurrency,
  exchangeRates,
  userCredits,
  onReservationCreated,
}: RobotSchedulingProps) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userReservations, setUserReservations] = useState<Reservation[]>([]);
  const [isLoadingReservations, setIsLoadingReservations] = useState(true);

  // Calculate costs
  const durationHours = durationMinutes / 60;
  const baseCostCredits = hourlyRateCredits * durationHours;
  const platformFeeCredits = baseCostCredits * (platformMarkup / 100);
  const totalCostCredits = baseCostCredits + platformFeeCredits;
  const oneMinuteCost = (hourlyRateCredits / 60) * (1 + platformMarkup / 100);
  const depositCredits = Math.max(oneMinuteCost, totalCostCredits * 0.1);

  // Load user's reservations for this robot
  useEffect(() => {
    loadUserReservations();
  }, [robotId]);

  // Update end time when start time or duration changes
  useEffect(() => {
    if (startTime && durationMinutes) {
      try {
        const start = new Date(startTime);
        if (!isNaN(start.getTime())) {
          const end = new Date(start.getTime() + durationMinutes * 60000);
          setEndTime(end.toISOString().slice(0, 16));
        }
      } catch (err) {
        // Invalid date, ignore
      }
    } else if (!startTime) {
      setEndTime('');
    }
  }, [startTime, durationMinutes]);

  const loadUserReservations = async () => {
    try {
      setIsLoadingReservations(true);
      // Load reservations without status filter to get all user's reservations
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
          setUserReservations(filtered);
        }
      }
    } catch (err) {
      logger.error('Error loading reservations:', err);
    } finally {
      setIsLoadingReservations(false);
    }
  };

  const checkAvailability = async () => {
    if (!startTime || !endTime) {
      setAvailabilityError('Please select both start and end times');
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (end <= start) {
      setAvailabilityError('End time must be after start time');
      return;
    }

    // Validate booking window
    const now = new Date();
    const maxAdvanceDate = new Date(now);
    maxAdvanceDate.setDate(maxAdvanceDate.getDate() + 30);
    
    if (start > maxAdvanceDate) {
      setAvailabilityError('Cannot book more than 30 days in advance');
      return;
    }

    const minAdvanceDate = new Date(now);
    minAdvanceDate.setHours(minAdvanceDate.getHours() + 1);
    
    if (start < minAdvanceDate) {
      setAvailabilityError('Cannot book within 1 hour of current time');
      return;
    }

    // Validate minimum duration
    const durationMs = end.getTime() - start.getTime();
    const durationMins = Math.floor(durationMs / 60000);
    if (durationMins < 15) {
      setAvailabilityError('Minimum reservation duration is 15 minutes');
      return;
    }

    try {
      setIsCheckingAvailability(true);
      setAvailabilityError(null);
      setIsAvailable(null);

      const result = await client.queries.checkRobotAvailabilityLambda({
        robotId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });

      if (result.data) {
        const parsed = JSON.parse(result.data as string);
        if (parsed.statusCode === 200) {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setIsAvailable(body.available);
          if (!body.available) {
            setAvailabilityError(body.reason || 'Robot is not available during this time');
          }
        } else {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setAvailabilityError(body.error || 'Failed to check availability');
          setIsAvailable(false);
        }
      }
    } catch (err) {
      logger.error('Error checking availability:', err);
      setAvailabilityError(err instanceof Error ? err.message : 'Failed to check availability');
      setIsAvailable(false);
    } finally {
      setIsCheckingAvailability(false);
    }
  };

  const handleCreateReservation = async () => {
    if (!startTime || !endTime) {
      setError('Please select both start and end times');
      return;
    }

    if (!isAvailable) {
      setError('Please check availability first and ensure the robot is available');
      return;
    }

    if (userCredits < depositCredits) {
      setError(`Insufficient credits. You need ${formatCreditsAsCurrencySync(depositCredits, userCurrency, exchangeRates)} for the deposit, but you only have ${formatCreditsAsCurrencySync(userCredits, userCurrency, exchangeRates)}.`);
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end.getTime() - start.getTime();
    const durationMins = Math.floor(durationMs / 60000);

    try {
      setIsCreating(true);
      setError(null);
      setSuccess(null);

      const result = await client.mutations.createRobotReservationLambda({
        robotId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        durationMinutes: durationMins,
      });

      if (result.data) {
        const parsed = JSON.parse(result.data as string);
        if (parsed.statusCode === 200) {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setSuccess(`Reservation created successfully! Deposit of ${formatCreditsAsCurrencySync(body.depositCredits, userCurrency, exchangeRates)} has been charged.`);
          setStartTime('');
          setEndTime('');
          setDurationMinutes(15);
          setIsAvailable(null);
          setAvailabilityError(null);
          await loadUserReservations();
          if (onReservationCreated) {
            onReservationCreated();
          }
        } else {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setError(body.error || 'Failed to create reservation');
        }
      } else if (result.errors) {
        setError(result.errors[0]?.message || 'Failed to create reservation');
      }
    } catch (err) {
      logger.error('Error creating reservation:', err);
      setError(err instanceof Error ? err.message : 'Failed to create reservation');
    } finally {
      setIsCreating(false);
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

  return (
    <div className="robot-scheduling">
      <h2>
        <FontAwesomeIcon icon={faCalendarAlt} />
        Schedule Time
      </h2>

      <div className="scheduling-info">
        <div className="info-item">
          <FontAwesomeIcon icon={faInfoCircle} />
          <span>Book up to 1 month in advance</span>
        </div>
        <div className="info-item">
          <FontAwesomeIcon icon={faClock} />
          <span>Minimum 15-minute reservation</span>
        </div>
        <div className="info-item">
          <FontAwesomeIcon icon={faDollarSign} />
          <span>Deposit required to secure your slot</span>
        </div>
      </div>

      <div className="scheduling-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="start-time">Start Time *</label>
            <input
              id="start-time"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)}
              max={new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)}
              disabled={isCreating}
            />
          </div>

          <div className="form-group">
            <label htmlFor="duration">Duration (minutes) *</label>
            <input
              id="duration"
              type="number"
              min="15"
              step="15"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Math.max(15, parseInt(e.target.value) || 15))}
              disabled={isCreating}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="end-time">End Time (auto-calculated)</label>
          <input
            id="end-time"
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            disabled={isCreating}
            readOnly
          />
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={checkAvailability}
            className="btn-check"
            disabled={!startTime || !endTime || isCheckingAvailability || isCreating}
          >
            {isCheckingAvailability ? (
              'Checking...'
            ) : (
              <>
                <FontAwesomeIcon icon={faCheckCircle} />
                Check Availability
              </>
            )}
          </button>
        </div>

        {availabilityError && (
          <div className="availability-message error">
            <FontAwesomeIcon icon={faExclamationCircle} />
            {availabilityError}
          </div>
        )}

        {isAvailable === true && (
          <div className="availability-message success">
            <FontAwesomeIcon icon={faCheckCircle} />
            Robot is available during this time!
          </div>
        )}

        {isAvailable === true && (
          <div className="cost-breakdown">
            <h4>Cost Breakdown</h4>
            <div className="cost-item">
              <span>Base Rate ({durationMinutes} min):</span>
              <span>{formatCreditsAsCurrencySync(baseCostCredits, userCurrency, exchangeRates)}</span>
            </div>
            <div className="cost-item">
              <span>Platform Fee ({platformMarkup}%):</span>
              <span>{formatCreditsAsCurrencySync(platformFeeCredits, userCurrency, exchangeRates)}</span>
            </div>
            <div className="cost-item total">
              <span>Total Cost:</span>
              <span>{formatCreditsAsCurrencySync(totalCostCredits, userCurrency, exchangeRates)}</span>
            </div>
            <div className="cost-item deposit">
              <span>Deposit (charged now):</span>
              <span>{formatCreditsAsCurrencySync(depositCredits, userCurrency, exchangeRates)}</span>
            </div>
            {userCredits < depositCredits && (
              <div className="insufficient-credits-warning">
                <FontAwesomeIcon icon={faExclamationCircle} />
                Insufficient credits for deposit. Please top up your account.
              </div>
            )}
          </div>
        )}

        {isAvailable === true && (
          <button
            type="button"
            onClick={handleCreateReservation}
            className="btn-create"
            disabled={isCreating || userCredits < depositCredits}
          >
            {isCreating ? (
              'Creating Reservation...'
            ) : (
              <>
                <FontAwesomeIcon icon={faCalendarAlt} />
                Create Reservation
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="message error">
          <FontAwesomeIcon icon={faExclamationCircle} />
          {error}
        </div>
      )}

      {success && (
        <div className="message success">
          <FontAwesomeIcon icon={faCheckCircle} />
          {success}
        </div>
      )}

      <div className="user-reservations">
        <h3>Your Reservations</h3>
        {isLoadingReservations ? (
          <p>Loading reservations...</p>
        ) : userReservations.length === 0 ? (
          <p className="no-reservations">You don't have any reservations for this robot.</p>
        ) : (
          <div className="reservations-list">
            {userReservations.map((reservation) => (
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
                    <span>Deposit: {formatCreditsAsCurrencySync(reservation.depositCredits, userCurrency, exchangeRates)}</span>
                    <span>Total: {formatCreditsAsCurrencySync(reservation.totalCostCredits, userCurrency, exchangeRates)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

