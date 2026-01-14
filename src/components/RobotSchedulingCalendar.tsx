import { useState, useEffect, useRef } from 'react';
import { generateClient } from 'aws-amplify/api';
import { Schema } from '../../amplify/data/resource';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
import { logger } from '../utils/logger';
import { parseRecurrencePattern, expandRecurrencePattern } from '../utils/recurrence';
import { useToast } from '../hooks/useToast';
import './RobotSchedulingCalendar.css';

const client = generateClient<Schema>();

interface RobotSchedulingCalendarProps {
  robotId: string;
  onTimeSelect: (startTime: Date, endTime: Date) => void;
  selectedStartTime: Date | null;
  selectedEndTime: Date | null;
  durationMinutes: number;
  onDurationChange: (minutes: number) => void;
  mode?: 'scheduling' | 'availability'; // 'scheduling' for users, 'availability' for partners
  onAvailabilityBlockCreate?: (startTime: Date, endTime: Date, isRecurring: boolean, recurrencePattern?: string) => void;
}

export function RobotSchedulingCalendar({
  robotId,
  onTimeSelect,
  selectedStartTime,
  selectedEndTime,
  durationMinutes,
  onDurationChange,
  mode: _mode = 'scheduling',
  onAvailabilityBlockCreate: _onAvailabilityBlockCreate,
}: RobotSchedulingCalendarProps) {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [reservations, setReservations] = useState<any[]>([]);
  const [availabilityBlocks, setAvailabilityBlocks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hoveredTime, setHoveredTime] = useState<{ day: number; hour: number; minute: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ day: Date; hour: number; minute: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ day: Date; hour: number; minute: number } | null>(null);
  const calendarGridRef = useRef<HTMLDivElement>(null);
  const { toast, showToast } = useToast();

  // Get start of week (Sunday) - create clean date to avoid timezone/rollover issues
  const getWeekStart = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.getFullYear(), d.getMonth(), diff, 0, 0, 0, 0);
  };

  const weekStart = getWeekStart(currentWeek);
  // Create clean dates for each day of the week to avoid timezone/rollover issues
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i, 0, 0, 0, 0);
  });

  // Load reservations and availability blocks for the current week
  useEffect(() => {
    loadWeekData();
  }, [robotId, currentWeek]);

  // Scroll to 6am when calendar loads
  useEffect(() => {
    if (!isLoading && calendarGridRef.current) {
      // Find the 6am time slot (index 24 in the timeSlots array: 6 hours * 4 segments)
      const timeSlotElements = calendarGridRef.current.querySelectorAll('.time-slot');
      if (timeSlotElements.length > 24) {
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
          timeSlotElements[24].scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 100);
      }
    }
  }, [isLoading, currentWeek]);

  const loadWeekData = async () => {
    try {
      setIsLoading(true);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      // Load reservations
      const reservationsResult = await client.queries.listRobotReservationsLambda({
        robotId,
        startTime: weekStart.toISOString(),
        endTime: weekEnd.toISOString(),
        limit: 100,
      });

      if (reservationsResult.data) {
        const parsed = JSON.parse(reservationsResult.data as string);
        if (parsed.statusCode === 200) {
          const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
          setReservations(body.reservations || []);
        }
      }

      // Load availability blocks - filter by robotId
      try {
        const { data: blocks } = await client.models.RobotAvailability.list({
          filter: {
            robotId: { eq: robotId },
          },
        });
        setAvailabilityBlocks(blocks || []);
      } catch (err) {
        logger.warn('Error loading availability blocks:', err);
        setAvailabilityBlocks([]);
      }
    } catch (err) {
      logger.error('Error loading week data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(newWeek.getDate() + (direction === 'next' ? 7 : -7));
    setCurrentWeek(newWeek);
  };

  const goToToday = () => {
    setCurrentWeek(new Date());
  };

  // Check if a time is in the past (less than 1 hour from now)
  const isTimeInPast = (day: Date, hour: number, minute: number) => {
    const now = new Date();
    const minAdvanceDate = new Date(now);
    minAdvanceDate.setHours(minAdvanceDate.getHours() + 1);
    const slotTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
    return slotTime < minAdvanceDate;
  };

  const isTimeBlocked = (day: Date, hour: number, minute: number) => {
    // Create a clean date at midnight first to avoid timezone/rollover issues
    const time = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
    const slotEnd = new Date(time.getTime() + 15 * 60000); // 15 minutes later

    // Check reservations - check if this 15-minute slot overlaps with any reservation
    for (const reservation of reservations) {
      if (reservation.status === 'pending' || reservation.status === 'confirmed' || reservation.status === 'active') {
        const start = new Date(reservation.startTime);
        const end = new Date(reservation.endTime);
        // Check if this 15-minute slot overlaps with the reservation
        if (time < end && slotEnd > start) {
          return { type: 'reservation', reservation };
        }
      }
    }

    // Check availability blocks - check if this 15-minute slot overlaps with any block
    for (const block of availabilityBlocks) {
      if (block.isRecurring && block.recurrencePattern) {
        // Handle recurring blocks
        const pattern = parseRecurrencePattern(block.recurrencePattern);
        if (pattern) {
          const originalStart = new Date(block.startTime);
          const originalEnd = new Date(block.endTime);
          
          // Expand the pattern for the current week
          const weekStart = new Date(day);
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);
          
          const instances = expandRecurrencePattern(pattern, originalStart, originalEnd, weekStart, weekEnd);
          
          for (const instance of instances) {
            if (time < instance.endTime && slotEnd > instance.startTime) {
              return { type: 'blocked', block };
            }
          }
        }
      } else {
        // Handle one-time blocks
        const start = new Date(block.startTime);
        const end = new Date(block.endTime);
        // Check if this 15-minute slot overlaps with the block
        if (time < end && slotEnd > start) {
          return { type: 'blocked', block };
        }
      }
    }

    return null;
  };

  const handleTimeMouseDown = (day: Date, hour: number, minute: number) => {
    // Create a clean date at midnight first to avoid timezone/rollover issues
    const clickedTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);

    // Check if time is available - don't allow selection of blocked/reserved times
    const blocked = isTimeBlocked(day, hour, minute);
    if (blocked) {
      return; // Don't allow selection of blocked or reserved times
    }

    // Validate booking window
    const now = new Date();
    const maxAdvanceDate = new Date(now);
    maxAdvanceDate.setDate(maxAdvanceDate.getDate() + 30);
    
    if (clickedTime > maxAdvanceDate) {
      return; // Too far in advance
    }

    const minAdvanceDate = new Date(now);
    minAdvanceDate.setHours(minAdvanceDate.getHours() + 1);
    
    if (clickedTime < minAdvanceDate) {
      return; // Too soon
    }

    // Start dragging
    setIsDragging(true);
    setDragStart({ day, hour, minute });
    setDragEnd({ day, hour, minute });
  };

  const handleTimeMouseEnter = (day: Date, hour: number, minute: number) => {
    if (isDragging && dragStart) {
      // Check if this time is valid for selection
      const blocked = isTimeBlocked(day, hour, minute);
      if (!blocked) {
        setDragEnd({ day, hour, minute });
      }
    } else {
      // Normal hover behavior
      const dayIndex = weekDays.findIndex(d => d.toDateString() === day.toDateString());
      if (dayIndex !== -1) {
        setHoveredTime({ day: dayIndex, hour, minute });
      }
    }
  };


  // Handle mouse up anywhere on the document
  useEffect(() => {
    if (!isDragging || !dragStart || !dragEnd) return;

    const handleGlobalMouseUp = () => {
      // Calculate the actual start and end times - create clean dates to avoid timezone/rollover issues
      const startTime = new Date(dragStart.day.getFullYear(), dragStart.day.getMonth(), dragStart.day.getDate(), dragStart.hour, dragStart.minute, 0, 0);
      
      const endTime = new Date(dragEnd.day.getFullYear(), dragEnd.day.getMonth(), dragEnd.day.getDate(), dragEnd.hour, dragEnd.minute, 0, 0);
      
      // Ensure start is before end
      let finalStart = startTime;
      let finalEnd = endTime;
      
      if (finalEnd < finalStart) {
        // Swap if dragged backwards
        [finalStart, finalEnd] = [finalEnd, finalStart];
      }
      
      // Add 15 minutes to end time to include the selected segment
      finalEnd = new Date(finalEnd.getTime() + 15 * 60000);
      
      // Validate the selection
      const now = new Date();
      const maxAdvanceDate = new Date(now);
      maxAdvanceDate.setDate(maxAdvanceDate.getDate() + 30);
      
      const minAdvanceDate = new Date(now);
      minAdvanceDate.setHours(minAdvanceDate.getHours() + 1);
      
      if (finalStart >= minAdvanceDate && finalStart <= maxAdvanceDate) {
        // Check minimum duration (15 minutes)
        const duration = (finalEnd.getTime() - finalStart.getTime()) / 60000;
        if (duration >= 15) {
          // Round duration to nearest 15 minutes
          const roundedDuration = Math.ceil(duration / 15) * 15;
          finalEnd = new Date(finalStart.getTime() + roundedDuration * 60000);
          
          onTimeSelect(finalStart, finalEnd);
          // Update duration selector to match
          onDurationChange(roundedDuration);
        }
      }
      
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragStart, dragEnd, onTimeSelect, onDurationChange]);

  const handleTimeClick = (day: Date, hour: number, minute: number) => {
    // If not dragging, use the old click behavior
    if (!isDragging) {
      // Create a clean date at midnight first to avoid timezone/rollover issues
      const clickedTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);

      // Check if time is available
      const blocked = isTimeBlocked(day, hour, minute);
      if (blocked) {
        return;
      }

      // Validate booking window
      const now = new Date();
      const maxAdvanceDate = new Date(now);
      maxAdvanceDate.setDate(maxAdvanceDate.getDate() + 30);
      
      if (clickedTime > maxAdvanceDate) {
        return;
      }

      const minAdvanceDate = new Date(now);
      minAdvanceDate.setHours(minAdvanceDate.getHours() + 1);
      
      if (clickedTime < minAdvanceDate) {
        showToast('Cannot schedule times in the past. Please select a time at least 1 hour from now.', 'warning');
        return;
      }

      // Set start time with duration
      const endTime = new Date(clickedTime.getTime() + durationMinutes * 60000);
      onTimeSelect(clickedTime, endTime);
    }
  };

  const formatTime = (hour: number, minute: number = 0) => {
    if (hour === 0 && minute === 0) return '12 AM';
    if (hour < 12) {
      if (minute === 0) return `${hour} AM`;
      return `${hour}:${minute.toString().padStart(2, '0')} AM`;
    }
    if (hour === 12 && minute === 0) return '12 PM';
    if (minute === 0) return `${hour - 12} PM`;
    return `${hour - 12}:${minute.toString().padStart(2, '0')} PM`;
  };

  // Generate 15-minute intervals (96 slots per day: 24 hours * 4 segments)
  const timeSlots = Array.from({ length: 96 }, (_, i) => {
    const hour = Math.floor(i / 4);
    const minute = (i % 4) * 15;
    return { hour, minute, index: i };
  });

  if (isLoading) {
    return <div className="calendar-loading">Loading calendar...</div>;
  }

  return (
    <div className={`scheduling-calendar ${isDragging ? 'dragging' : ''}`}>
      <div className="calendar-header">
        <button className="nav-button" onClick={() => navigateWeek('prev')}>
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
        <button className="today-button" onClick={goToToday}>
          Today
        </button>
        <button className="nav-button" onClick={() => navigateWeek('next')}>
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
        <div className="week-range">
          {weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} -{' '}
          {weekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>

      <div className="calendar-grid-container" ref={calendarGridRef}>
        <div className="calendar-grid">
          <div className="time-column sticky-column">
            <div className="time-header sticky-header"></div>
          {timeSlots.map((slot, index) => {
            // Only show label on the first segment of each hour (when minute is 0)
            if (slot.minute === 0) {
              return (
                <div key={index} className="time-slot hour-label">
                  {formatTime(slot.hour)}
                </div>
              );
            }
            return (
              <div key={index} className="time-slot quarter-slot">
                {/* Empty for visual spacing */}
              </div>
            );
          })}
        </div>

        {weekDays.map((day, dayIndex) => {
          const isToday = day.toDateString() === new Date().toDateString();
          return (
            <div key={dayIndex} className="day-column">
              <div className={`day-header sticky-header ${isToday ? 'today' : ''}`}>
                <div className="day-name">{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                <div className="day-number">{day.getDate()}</div>
              </div>
              <div className="day-time-slots">
                {timeSlots.map((slot, slotIndex) => {
                  const blocked = isTimeBlocked(day, slot.hour, slot.minute);
                  const isPast = isTimeInPast(day, slot.hour, slot.minute);
                  // Create a clean date at midnight first to avoid timezone/rollover issues
                  const slotTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.hour, slot.minute, 0, 0);
                  
                  // Check if selected (either from props or from drag)
                  let isSelected = false;
                  if (selectedStartTime && selectedEndTime) {
                    isSelected = slotTime >= selectedStartTime && slotTime < selectedEndTime;
                  } else if (isDragging && dragStart && dragEnd) {
                    // Show drag selection - create clean dates to avoid timezone/rollover issues
                    const dragStartTime = new Date(dragStart.day.getFullYear(), dragStart.day.getMonth(), dragStart.day.getDate(), dragStart.hour, dragStart.minute, 0, 0);
                    
                    const dragEndTime = new Date(dragEnd.day.getFullYear(), dragEnd.day.getMonth(), dragEnd.day.getDate(), dragEnd.hour, dragEnd.minute, 0, 0);
                    
                    const minTime = dragStartTime < dragEndTime ? dragStartTime : dragEndTime;
                    const maxTime = dragStartTime > dragEndTime ? dragStartTime : dragEndTime;
                    const maxTimeEnd = new Date(maxTime.getTime() + 15 * 60000); // Include the end segment
                    
                    isSelected = slotTime >= minTime && slotTime < maxTimeEnd;
                  }
                  
                  const isHovered = hoveredTime &&
                    hoveredTime.day === dayIndex &&
                    hoveredTime.hour === slot.hour &&
                    hoveredTime.minute === slot.minute;

                  // Build title tooltip
                  let titleText = `${formatTime(slot.hour, slot.minute)} - Available`;
                  if (blocked) {
                    titleText = blocked.type === 'reservation' ? 'Reserved' : 'Blocked by partner';
                  } else if (isPast) {
                    titleText = `${formatTime(slot.hour, slot.minute)} - Past time (cannot schedule)`;
                  }

                  return (
                    <div
                      key={slotIndex}
                      className={`time-cell quarter-cell ${blocked ? 'blocked' : ''} ${isPast ? 'past-time' : ''} ${isSelected ? 'selected' : ''} ${isHovered && !isDragging ? 'hovered' : ''} ${isDragging ? 'dragging' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (!isPast) {
                          handleTimeMouseDown(day, slot.hour, slot.minute);
                        }
                      }}
                      onMouseEnter={() => {
                        if (!isPast) {
                          handleTimeMouseEnter(day, slot.hour, slot.minute);
                        }
                      }}
                      onMouseLeave={() => {
                        if (!isDragging) {
                          setHoveredTime(null);
                        }
                      }}
                      onClick={() => {
                        if (!isPast) {
                          handleTimeClick(day, slot.hour, slot.minute);
                        }
                      }}
                      title={titleText}
                    >
                      {blocked && (
                        <div className={`block-indicator ${blocked.type === 'reservation' ? 'reserved' : 'blocked'}`} />
                      )}
                      {isPast && !blocked && (
                        <div className="block-indicator past-time" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      <div className="calendar-legend">
        <div className="legend-item">
          <div className="legend-color available"></div>
          <span>Available</span>
        </div>
        <div className="legend-item">
          <div className="legend-color reserved"></div>
          <span>Reserved</span>
        </div>
        <div className="legend-item">
          <div className="legend-color blocked"></div>
          <span>Blocked</span>
        </div>
        <div className="legend-item">
          <div className="legend-color selected"></div>
          <span>Selected</span>
        </div>
      </div>

      <div className="duration-selector">
        <label>Duration (minutes):</label>
        <div className="duration-input-wrapper">
          <input
            type="number"
            min="15"
            step="15"
            value={durationMinutes}
            onChange={(e) => onDurationChange(Math.max(15, parseInt(e.target.value) || 15))}
          />
          <div className="spinner-buttons">
            <button
              type="button"
              className="spinner-btn spinner-up"
              onClick={() => onDurationChange(durationMinutes + 15)}
              aria-label="Increase duration"
            >
              ▲
            </button>
            <button
              type="button"
              className="spinner-btn spinner-down"
              onClick={() => onDurationChange(Math.max(15, durationMinutes - 15))}
              aria-label="Decrease duration"
            >
              ▼
            </button>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {toast.visible && (
        <div className={`toast-notification ${toast.type}`}>
          <FontAwesomeIcon icon={faCircleExclamation} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

