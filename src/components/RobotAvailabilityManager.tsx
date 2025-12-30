import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faCalendarAlt, 
  faPlus, 
  faTrash, 
  faEdit, 
  faClock,
  faInfoCircle,
  faCheckCircle,
  faExclamationCircle,
  faTimes
} from '@fortawesome/free-solid-svg-icons';
import { logger } from '../utils/logger';
import { RobotSchedulingCalendar } from './RobotSchedulingCalendar';
import { DateTimePicker } from './DateTimePicker';
import './RobotAvailabilityManager.css';

const client = generateClient<Schema>();

interface AvailabilityBlock {
  id?: string;
  startTime: string;
  endTime: string;
  reason?: string;
  isRecurring?: boolean;
  recurrencePattern?: string;
}

interface RobotAvailabilityManagerProps {
  robotId: string; // robotId string (robot-XXXXXXXX)
  robotUuid?: string; // Optional UUID for relationship
}

export function RobotAvailabilityManager({ robotId }: RobotAvailabilityManagerProps) {
  const [availabilityBlocks, setAvailabilityBlocks] = useState<AvailabilityBlock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedStartTime, setSelectedStartTime] = useState<Date | null>(null);
  const [selectedEndTime, setSelectedEndTime] = useState<Date | null>(null);

  // Form state
  const [formData, setFormData] = useState<AvailabilityBlock>({
    startTime: '',
    endTime: '',
    reason: '',
    isRecurring: false,
  });

  // Handle time selection from calendar
  const handleTimeSelect = (startTime: Date, endTime: Date) => {
    setSelectedStartTime(startTime);
    setSelectedEndTime(endTime);
    setFormData({
      startTime: startTime.toISOString().slice(0, 16),
      endTime: endTime.toISOString().slice(0, 16),
      reason: '',
      isRecurring: false,
    });
    setShowBlockModal(true);
  };

  // Load availability blocks
  useEffect(() => {
    loadAvailabilityBlocks();
  }, [robotId]);

  const loadAvailabilityBlocks = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Query availability blocks for this robot
      const { data: blocks } = await client.models.RobotAvailability.list({
        filter: { robotId: { eq: robotId } },
      });

      setAvailabilityBlocks((blocks || []).filter(block => block !== null) as AvailabilityBlock[]);
    } catch (err) {
      logger.error('Error loading availability blocks:', err);
      setError('Failed to load availability blocks');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.startTime || !formData.endTime) {
      setError('Start time and end time are required');
      return;
    }

    const start = new Date(formData.startTime);
    const end = new Date(formData.endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setError('Invalid date format');
      return;
    }

    if (end <= start) {
      setError('End time must be after start time');
      return;
    }

    try {
      setIsCreating(true);
      setError(null);
      setSuccess(null);

      const result = await client.mutations.manageRobotAvailabilityLambda({
        robotId,
        action: editingId ? 'update' : 'create',
        availabilityId: editingId || undefined,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        reason: formData.reason || undefined,
        isRecurring: formData.isRecurring || false,
        recurrencePattern: formData.recurrencePattern || undefined,
      });

      if (result.data) {
        const parsed = JSON.parse(result.data as string);
        if (parsed.statusCode === 200) {
          setSuccess(editingId ? 'Availability block updated successfully' : 'Availability block created successfully');
          setFormData({ startTime: '', endTime: '', reason: '', isRecurring: false });
          setEditingId(null);
          setSelectedStartTime(null);
          setSelectedEndTime(null);
          setShowBlockModal(false);
          await loadAvailabilityBlocks();
        } else {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setError(body.error || 'Failed to save availability block');
        }
      } else if (result.errors) {
        setError(result.errors[0]?.message || 'Failed to save availability block');
      }
    } catch (err) {
      logger.error('Error saving availability block:', err);
      setError(err instanceof Error ? err.message : 'Failed to save availability block');
    } finally {
      setIsCreating(false);
    }
  };

  const handleEdit = (block: AvailabilityBlock) => {
    setFormData({
      startTime: block.startTime ? new Date(block.startTime).toISOString().slice(0, 16) : '',
      endTime: block.endTime ? new Date(block.endTime).toISOString().slice(0, 16) : '',
      reason: block.reason || '',
      isRecurring: block.isRecurring || false,
      recurrencePattern: block.recurrencePattern || undefined,
    });
    setEditingId(block.id || null);
  };

  const handleDelete = async (blockId: string) => {
    if (!confirm('Are you sure you want to delete this availability block?')) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);

      const result = await client.mutations.manageRobotAvailabilityLambda({
        robotId,
        action: 'delete',
        availabilityId: blockId,
      });

      if (result.data) {
        const parsed = JSON.parse(result.data as string);
        if (parsed.statusCode === 200) {
          setSuccess('Availability block deleted successfully');
          await loadAvailabilityBlocks();
        } else {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setError(body.error || 'Failed to delete availability block');
        }
      } else if (result.errors) {
        setError(result.errors[0]?.message || 'Failed to delete availability block');
      }
    } catch (err) {
      logger.error('Error deleting availability block:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete availability block');
    }
  };

  const handleCancel = () => {
    setFormData({ startTime: '', endTime: '', reason: '', isRecurring: false });
    setEditingId(null);
    setError(null);
    setSuccess(null);
  };

  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  if (isLoading && availabilityBlocks.length === 0) {
    return (
      <div className="availability-manager">
        <p>Loading availability blocks...</p>
      </div>
    );
  }

  return (
    <div className="availability-manager">
      <div className="availability-header">
        <h3>
          <FontAwesomeIcon icon={faCalendarAlt} />
          Robot Availability
        </h3>
        <p className="availability-description">
          Block dates and times when your robot is unavailable for scheduling.
        </p>
      </div>

      {error && (
        <div className="availability-message error">
          <FontAwesomeIcon icon={faExclamationCircle} />
          {error}
        </div>
      )}

      {success && (
        <div className="availability-message success">
          <FontAwesomeIcon icon={faCheckCircle} />
          {success}
        </div>
      )}

      {/* Calendar for visual selection */}
      <div className="availability-calendar-section">
        <h4>Select Time to Block</h4>
        <p className="calendar-help-text">
          Click and drag on the calendar to select a time range, or click a single time slot.
        </p>
        <RobotSchedulingCalendar
          robotId={robotId}
          onTimeSelect={handleTimeSelect}
          selectedStartTime={selectedStartTime}
          selectedEndTime={selectedEndTime}
          durationMinutes={15}
          onDurationChange={() => {}}
          mode="availability"
        />
      </div>

      {/* Modal for block details */}
      {showBlockModal && (
        <div className="block-modal-overlay" onClick={() => setShowBlockModal(false)}>
          <div className="block-modal" onClick={(e) => e.stopPropagation()}>
            <div className="block-modal-header">
              <h3>Create Availability Block</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setShowBlockModal(false);
                  setSelectedStartTime(null);
                  setSelectedEndTime(null);
                  setFormData({ startTime: '', endTime: '', reason: '', isRecurring: false });
                }}
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
            <div className="availability-form">
        <div className="form-row">
          <div className="form-group">
            <DateTimePicker
              value={formData.startTime}
              onChange={(value) => setFormData(prev => ({ ...prev, startTime: value }))}
              label="Start Time"
              required
              disabled={isCreating}
            />
          </div>

          <div className="form-group">
            <DateTimePicker
              value={formData.endTime}
              onChange={(value) => setFormData(prev => ({ ...prev, endTime: value }))}
              label="End Time"
              required
              disabled={isCreating}
              min={formData.startTime || undefined}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="reason">Reason (Optional)</label>
          <textarea
            id="reason"
            name="reason"
            value={formData.reason}
            onChange={handleInputChange}
            placeholder="e.g., Maintenance, Private use, etc."
            rows={2}
            disabled={isCreating}
          />
        </div>

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              name="isRecurring"
              checked={formData.isRecurring}
              onChange={handleInputChange}
              disabled={isCreating}
            />
            <span>Recurring block</span>
          </label>
        </div>

        {formData.isRecurring && (
          <div className="form-group recurring-pattern">
            <label>Recurrence Pattern</label>
            <div className="recurring-options">
              <div className="recurring-type">
                <strong>Repeat every week on:</strong>
                <div className="days-of-week">
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => (
                    <label key={index} className="day-checkbox">
                      <input
                        type="checkbox"
                        checked={formData.recurrencePattern ? JSON.parse(formData.recurrencePattern).daysOfWeek?.includes(index) : false}
                        onChange={(e) => {
                          const currentPattern = formData.recurrencePattern ? JSON.parse(formData.recurrencePattern) : { type: 'weekly', daysOfWeek: [] };
                          const daysOfWeek = currentPattern.daysOfWeek || [];
                          if (e.target.checked) {
                            daysOfWeek.push(index);
                          } else {
                            const idx = daysOfWeek.indexOf(index);
                            if (idx > -1) daysOfWeek.splice(idx, 1);
                          }
                          setFormData(prev => ({
                            ...prev,
                            recurrencePattern: JSON.stringify({ type: 'weekly', daysOfWeek: daysOfWeek.sort() }),
                          }));
                        }}
                        disabled={isCreating}
                      />
                      <span>{day.substring(0, 3)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="recurrenceEndDate">End Date (Optional)</label>
                <input
                  id="recurrenceEndDate"
                  type="date"
                  value={formData.recurrencePattern ? (JSON.parse(formData.recurrencePattern).endDate || '') : ''}
                  onChange={(e) => {
                    const currentPattern = formData.recurrencePattern ? JSON.parse(formData.recurrencePattern) : { type: 'weekly', daysOfWeek: [] };
                    setFormData(prev => ({
                      ...prev,
                      recurrencePattern: JSON.stringify({ ...currentPattern, endDate: e.target.value || undefined }),
                    }));
                  }}
                  disabled={isCreating}
                />
                <p className="form-help-text">
                  <FontAwesomeIcon icon={faInfoCircle} />
                  Leave empty for no end date (recurring indefinitely)
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="form-actions">
          {editingId && (
            <button
              type="button"
              onClick={handleCancel}
              className="btn-secondary"
              disabled={isCreating}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              const fakeEvent = {
                preventDefault: () => {},
              } as React.FormEvent;
              await handleSubmit(fakeEvent);
              if (!error) {
                setShowBlockModal(false);
              }
            }}
            className="btn-primary"
            disabled={isCreating || !formData.startTime || !formData.endTime}
          >
            {isCreating ? (
              'Saving...'
            ) : editingId ? (
              <>
                <FontAwesomeIcon icon={faEdit} />
                Update Block
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faPlus} />
                Create Block
              </>
            )}
          </button>
        </div>
            </div>
          </div>
        </div>
      )}

      <div className="availability-blocks">
        <h4>Current Availability Blocks</h4>
        {availabilityBlocks.length === 0 ? (
          <p className="no-blocks">No availability blocks set. Your robot is available for scheduling at all times.</p>
        ) : (
          <div className="blocks-list">
            {availabilityBlocks.map((block) => (
              <div key={block.id} className="availability-block-card">
                <div className="block-info">
                  <div className="block-time">
                    <FontAwesomeIcon icon={faClock} />
                    <div>
                      <strong>{formatDateTime(block.startTime || '')}</strong>
                      <span> to </span>
                      <strong>{formatDateTime(block.endTime || '')}</strong>
                    </div>
                  </div>
                  {block.reason && (
                    <div className="block-reason">
                      <strong>Reason:</strong> {block.reason}
                    </div>
                  )}
                  {block.isRecurring && block.recurrencePattern && (
                    <div className="block-recurring">
                      <FontAwesomeIcon icon={faCalendarAlt} />
                      {(() => {
                        try {
                          const pattern = JSON.parse(block.recurrencePattern);
                          if (pattern.type === 'weekly' && pattern.daysOfWeek) {
                            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                            const days = pattern.daysOfWeek.map((d: number) => dayNames[d]).join(', ');
                            return `Recurring: Every ${days}`;
                          }
                        } catch (e) {
                          return 'Recurring';
                        }
                        return 'Recurring';
                      })()}
                    </div>
                  )}
                </div>
                <div className="block-actions">
                  <button
                    onClick={() => handleEdit(block)}
                    className="btn-icon"
                    title="Edit block"
                  >
                    <FontAwesomeIcon icon={faEdit} />
                  </button>
                  <button
                    onClick={() => block.id && handleDelete(block.id)}
                    className="btn-icon danger"
                    title="Delete block"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

