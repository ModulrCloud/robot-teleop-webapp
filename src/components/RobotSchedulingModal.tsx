import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faTimes,
  faCalendarAlt,
  faClock,
  faCheckCircle,
  faExclamationCircle,
  faDollarSign,
  faInfoCircle
} from '@fortawesome/free-solid-svg-icons';
import { logger } from '../utils/logger';
import { formatCreditsAsCurrencySync } from '../utils/credits';
import { RobotSchedulingCalendar } from './RobotSchedulingCalendar';
import './RobotSchedulingModal.css';

const client = generateClient<Schema>();

interface RobotSchedulingModalProps {
  isOpen: boolean;
  onClose: () => void;
  robotId: string;
  robotUuid?: string;
  hourlyRateCredits: number;
  platformMarkup: number;
  userCurrency: string;
  exchangeRates?: Record<string, number>;
  userCredits: number;
  onReservationCreated?: () => void;
}

export function RobotSchedulingModal({
  isOpen,
  onClose,
  robotId,
  hourlyRateCredits,
  platformMarkup,
  userCurrency,
  exchangeRates,
  userCredits,
  onReservationCreated,
}: RobotSchedulingModalProps) {
  const [selectedStartTime, setSelectedStartTime] = useState<Date | null>(null);
  const [selectedEndTime, setSelectedEndTime] = useState<Date | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [step, setStep] = useState<'calendar' | 'confirm'>('calendar');

  // Calculate costs
  const durationHours = durationMinutes / 60;
  const baseCostCredits = hourlyRateCredits * durationHours;
  const platformFeeCredits = baseCostCredits * (platformMarkup / 100);
  const totalCostCredits = baseCostCredits + platformFeeCredits;
  const oneMinuteCost = (hourlyRateCredits / 60) * (1 + platformMarkup / 100);
  const depositCredits = Math.max(oneMinuteCost, totalCostCredits * 0.1);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedStartTime(null);
      setSelectedEndTime(null);
      setDurationMinutes(15);
      setIsAvailable(null);
      setAvailabilityError(null);
      setError(null);
      setSuccess(null);
      setStep('calendar');
    }
  }, [isOpen]);

  // Update end time when start time or duration changes
  useEffect(() => {
    if (selectedStartTime && durationMinutes) {
      const end = new Date(selectedStartTime.getTime() + durationMinutes * 60000);
      setSelectedEndTime(end);
    }
  }, [selectedStartTime, durationMinutes]);

  const handleTimeSelect = (startTime: Date, endTime: Date) => {
    setSelectedStartTime(startTime);
    setSelectedEndTime(endTime);
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationMins = Math.floor(durationMs / 60000);
    setDurationMinutes(Math.max(15, durationMins));
    setIsAvailable(null);
    setAvailabilityError(null);
  };

  const checkAvailability = async () => {
    if (!selectedStartTime || !selectedEndTime) {
      setAvailabilityError('Please select a time slot');
      return;
    }

    const start = selectedStartTime;
    const end = selectedEndTime;

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
          } else {
            // Move to confirmation step
            setStep('confirm');
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
    if (!selectedStartTime || !selectedEndTime) {
      setError('Please select both start and end times');
      return;
    }

    if (!isAvailable) {
      setError('Please check availability first and ensure the robot is available');
      return;
    }

    if (userCredits < depositCredits) {
      setError(`Insufficient credits. You need ${formatCreditsAsCurrencySync(depositCredits, userCurrency as any, exchangeRates)} for the deposit, but you only have ${formatCreditsAsCurrencySync(userCredits, userCurrency as any, exchangeRates)}.`);
      return;
    }

    const start = selectedStartTime;
    const end = selectedEndTime;
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
          setSuccess(`Reservation created successfully! Deposit of ${formatCreditsAsCurrencySync(body.depositCredits, userCurrency as any, exchangeRates)} has been charged.`);
          
          // Close modal after a short delay
          setTimeout(() => {
            if (onReservationCreated) {
              onReservationCreated();
            }
            onClose();
          }, 2000);
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

  if (!isOpen) return null;

  return (
    <div className="scheduling-modal-overlay" onClick={onClose}>
      <div className="scheduling-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scheduling-modal-header">
          <h2>
            <FontAwesomeIcon icon={faCalendarAlt} />
            Schedule Robot Time
          </h2>
          <button className="close-button" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="scheduling-modal-content">
          {step === 'calendar' && (
            <>
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

              <RobotSchedulingCalendar
                robotId={robotId}
                onTimeSelect={handleTimeSelect}
                selectedStartTime={selectedStartTime}
                selectedEndTime={selectedEndTime}
                durationMinutes={durationMinutes}
                onDurationChange={setDurationMinutes}
              />

              {selectedStartTime && selectedEndTime && (
                <div className="selected-time-info">
                  <div className="time-display">
                    <strong>Selected Time:</strong>
                    <span>
                      {selectedStartTime.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })} - {selectedEndTime.toLocaleString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </span>
                  </div>
                  <div className="duration-display">
                    <strong>Duration:</strong> {durationMinutes} minutes
                  </div>
                  <div className="cost-preview">
                    <strong>Estimated Cost:</strong> {formatCreditsAsCurrencySync(totalCostCredits, userCurrency as any, exchangeRates)}
                    <span className="deposit-note">(Deposit: {formatCreditsAsCurrencySync(depositCredits, userCurrency as any, exchangeRates)})</span>
                  </div>
                  <div className="deposit-warning">
                    <FontAwesomeIcon icon={faInfoCircle} />
                    <span>Note: Deposit is non-refundable for user-initiated cancellations</span>
                  </div>
                </div>
              )}

              {availabilityError && (
                <div className="availability-message error">
                  <FontAwesomeIcon icon={faExclamationCircle} />
                  {availabilityError}
                </div>
              )}

              {selectedStartTime && selectedEndTime && (
                <div className="modal-actions">
                  <button
                    type="button"
                    onClick={checkAvailability}
                    className="btn-check"
                    disabled={isCheckingAvailability}
                  >
                    {isCheckingAvailability ? (
                      'Checking...'
                    ) : (
                      <>
                        <FontAwesomeIcon icon={faCalendarAlt} />
                        Schedule
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}

          {step === 'confirm' && (
            <>
              <div className="confirmation-step">
                <h3>Confirm Reservation</h3>
                
                <div className="reservation-summary">
                  <div className="summary-item">
                    <strong>Start Time:</strong>
                    <span>
                      {selectedStartTime?.toLocaleString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </span>
                  </div>
                  <div className="summary-item">
                    <strong>End Time:</strong>
                    <span>
                      {selectedEndTime?.toLocaleString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </span>
                  </div>
                  <div className="summary-item">
                    <strong>Duration:</strong>
                    <span>{durationMinutes} minutes</span>
                  </div>
                </div>

                <div className="cost-breakdown">
                  <h4>Cost Breakdown</h4>
                  <div className="cost-item">
                    <span>Base Rate ({durationMinutes} min):</span>
                    <span>{formatCreditsAsCurrencySync(baseCostCredits, userCurrency as any, exchangeRates)}</span>
                  </div>
                  <div className="cost-item">
                    <span>Platform Fee ({platformMarkup}%):</span>
                    <span>{formatCreditsAsCurrencySync(platformFeeCredits, userCurrency as any, exchangeRates)}</span>
                  </div>
                  <div className="cost-item total">
                    <span>Total Cost:</span>
                    <span>{formatCreditsAsCurrencySync(totalCostCredits, userCurrency as any, exchangeRates)}</span>
                  </div>
                  <div className="cost-item deposit">
                    <span>Deposit (charged now):</span>
                    <span>{formatCreditsAsCurrencySync(depositCredits, userCurrency as any, exchangeRates)}</span>
                  </div>
                  <div className="deposit-warning">
                    <FontAwesomeIcon icon={faInfoCircle} />
                    <span>Note: Deposit is non-refundable for user-initiated cancellations</span>
                  </div>
                  {userCredits < depositCredits && (
                    <div className="insufficient-credits-warning">
                      <FontAwesomeIcon icon={faExclamationCircle} />
                      Insufficient credits for deposit. Please top up your account.
                    </div>
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

                <div className="modal-actions">
                  <button
                    type="button"
                    onClick={() => setStep('calendar')}
                    className="btn-secondary"
                    disabled={isCreating}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateReservation}
                    className="btn-primary"
                    disabled={isCreating || userCredits < depositCredits}
                  >
                    {isCreating ? (
                      'Creating Reservation...'
                    ) : (
                      <>
                        <FontAwesomeIcon icon={faCalendarAlt} />
                        Confirm & Book
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

