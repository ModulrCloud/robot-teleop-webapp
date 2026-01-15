import { useState, useRef, useEffect, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarAlt, faClock } from '@fortawesome/free-solid-svg-icons';
import './DateTimePicker.css';

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
}

export function DateTimePicker({
  value,
  onChange,
  label,
  required = false,
  disabled = false,
  min,
  max,
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<{ hour: number; minute: number; ampm: 'AM' | 'PM' } | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const pickerRef = useRef<HTMLDivElement>(null);

  const minDateTime = useMemo(() => (min ? new Date(min) : null), [min]);
  const maxDateTime = useMemo(() => (max ? new Date(max) : null), [max]);

  useEffect(() => {
    if (value) {
      const dateStr = value.includes('T') ? value : `${value}T00:00`;
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        setSelectedDate(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
        const hours = date.getHours();
        const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        setSelectedTime({
          hour: hour12,
          minute: date.getMinutes(),
          ampm: hours >= 12 ? 'PM' : 'AM',
        });
        setCurrentMonth(date);
      }
    } else {
      setSelectedDate(null);
      setSelectedTime(null);
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const formatDisplayValue = (): string => {
    if (!selectedDate || !selectedTime) return '';
    
    const month = selectedDate.toLocaleDateString('en-US', { month: 'short' });
    const day = selectedDate.getDate();
    const year = selectedDate.getFullYear();
    const hour = selectedTime.hour;
    const minute = selectedTime.minute.toString().padStart(2, '0');
    const ampm = selectedTime.ampm;
    
    return `${month} ${day}, ${year} ${hour}:${minute} ${ampm}`;
  };

  const isDateDisabled = (date: Date) => {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
    if (minDateTime && dayEnd < minDateTime) return true;
    if (maxDateTime && dayStart > maxDateTime) return true;
    return false;
  };

  const isDateTimeAllowed = (candidate: Date) => {
    if (minDateTime && candidate < minDateTime) return false;
    if (maxDateTime && candidate > maxDateTime) return false;
    return true;
  };

  const toDateTimeLocalString = (date: Date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hoursStr = date.getHours().toString().padStart(2, '0');
    const minutesStr = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hoursStr}:${minutesStr}`;
  };

  const handleDateSelect = (date: Date) => {
    if (isDateDisabled(date)) return;
    setSelectedDate(date);
    if (!selectedTime) {
      const now = new Date();
      const hours = now.getHours();
      const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      const newTime: { hour: number; minute: number; ampm: 'AM' | 'PM' } = {
        hour: hour12,
        minute: now.getMinutes(),
        ampm: hours >= 12 ? 'PM' : 'AM',
      };
      setSelectedTime(newTime);
      
      const dateWithTime = new Date(date);
      dateWithTime.setHours(hours, newTime.minute, 0, 0);
      if (isDateTimeAllowed(dateWithTime)) {
        onChange(toDateTimeLocalString(dateWithTime));
      }
    } else {
      const dateWithTime = new Date(date);
      let hours = selectedTime.hour;
      if (selectedTime.ampm === 'PM' && hours !== 12) {
        hours += 12;
      } else if (selectedTime.ampm === 'AM' && hours === 12) {
        hours = 0;
      }
      dateWithTime.setHours(hours, selectedTime.minute, 0, 0);
      if (isDateTimeAllowed(dateWithTime)) {
        onChange(toDateTimeLocalString(dateWithTime));
      }
    }
  };

  const handleTimeSelect = (hour: number, minute: number, ampm: 'AM' | 'PM') => {
    setSelectedTime({ hour, minute, ampm });
    
    if (selectedDate) {
      const date = new Date(selectedDate);
      let hours = hour;
      if (ampm === 'PM' && hours !== 12) {
        hours += 12;
      } else if (ampm === 'AM' && hours === 12) {
        hours = 0;
      }
      date.setHours(hours, minute, 0, 0);
      
      if (isDateTimeAllowed(date)) {
        onChange(toDateTimeLocalString(date));
      }
    }
  };

  const handleConfirm = () => {
    if (selectedDate && selectedTime) {
      const date = new Date(selectedDate);
      let hours = selectedTime.hour;
      if (selectedTime.ampm === 'PM' && hours !== 12) {
        hours += 12;
      } else if (selectedTime.ampm === 'AM' && hours === 12) {
        hours = 0;
      }
      date.setHours(hours, selectedTime.minute, 0, 0);
      
      if (isDateTimeAllowed(date)) {
        onChange(toDateTimeLocalString(date));
        setIsOpen(false);
      }
    }
  };

  const handleClear = () => {
    setSelectedDate(null);
    setSelectedTime(null);
    onChange('');
    setIsOpen(false);
  };

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(newDate.getMonth() - 1);
      } else {
        newDate.setMonth(newDate.getMonth() + 1);
      }
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentMonth(new Date());
    const today = new Date();
    setSelectedDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  };

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 60 }, (_, i) => i).filter(m => m % 15 === 0);

  return (
    <div className="datetime-picker-wrapper" ref={pickerRef}>
      <label>
        {label} {required && <span className="required">*</span>}
      </label>
      <div className="datetime-input" onClick={() => !disabled && setIsOpen(!isOpen)}>
        <input
          type="text"
          value={formatDisplayValue()}
          readOnly
          placeholder="Select date and time"
          disabled={disabled}
          className={disabled ? 'disabled' : ''}
        />
        <FontAwesomeIcon icon={faCalendarAlt} className="calendar-icon" />
      </div>

      {isOpen && (
        <div className="datetime-picker-modal">
          <div className="picker-content">
            <div className="date-picker-section">
              <div className="date-picker-header">
                <button type="button" className="nav-button" onClick={() => navigateMonth('prev')}>
                  ‹
                </button>
                <div className="month-year">{monthName}</div>
                <button type="button" className="nav-button" onClick={() => navigateMonth('next')}>
                  ›
                </button>
              </div>

              <div className="calendar-grid">
                <div className="calendar-weekdays">
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                    <div key={day} className="weekday">{day}</div>
                  ))}
                </div>
                <div className="calendar-days">
                  {Array.from({ length: firstDay }).map((_, i) => (
                    <div key={`empty-${i}`} className="calendar-day empty"></div>
                  ))}
                  {days.map(day => {
                    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
                    const isSelected = selectedDate && 
                      date.getDate() === selectedDate.getDate() &&
                      date.getMonth() === selectedDate.getMonth() &&
                      date.getFullYear() === selectedDate.getFullYear();
                    const isToday = date.toDateString() === new Date().toDateString();
                    const isDisabled = isDateDisabled(date);
                    
                    return (
                      <div
                        key={day}
                        className={`calendar-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${isDisabled ? 'disabled' : ''}`}
                        onClick={() => !isDisabled && handleDateSelect(date)}
                        style={isDisabled ? { opacity: 0.3, cursor: 'not-allowed' } : {}}
                      >
                        {day}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="picker-actions">
                <button type="button" className="action-link" onClick={goToToday}>
                  Today
                </button>
                <button type="button" className="action-link" onClick={handleClear}>
                  Clear
                </button>
              </div>
            </div>

            <div className="time-picker-section">
              <div className="time-picker-header">
                <FontAwesomeIcon icon={faClock} />
                <span>Time</span>
              </div>

              <div className="time-selectors">
                <div className="time-column">
                  <div className="time-label">Hour</div>
                  <div className="time-options">
                    {hours.map(hour => (
                      <button
                        key={hour}
                        type="button"
                        className={`time-option ${selectedTime?.hour === hour ? 'selected' : ''}`}
                        onClick={() => selectedTime && handleTimeSelect(hour, selectedTime.minute, selectedTime.ampm)}
                      >
                        {hour}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="time-column">
                  <div className="time-label">Minute</div>
                  <div className="time-options">
                    {minutes.map(minute => (
                      <button
                        key={minute}
                        type="button"
                        className={`time-option ${selectedTime?.minute === minute ? 'selected' : ''}`}
                        onClick={() => selectedTime && handleTimeSelect(selectedTime.hour, minute, selectedTime.ampm)}
                      >
                        {minute.toString().padStart(2, '0')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="time-column">
                  <div className="time-label">AM/PM</div>
                  <div className="time-options">
                    <button
                      type="button"
                      className={`time-option ${selectedTime?.ampm === 'AM' ? 'selected' : ''}`}
                      onClick={() => selectedTime && handleTimeSelect(selectedTime.hour, selectedTime.minute, 'AM')}
                    >
                      AM
                    </button>
                    <button
                      type="button"
                      className={`time-option ${selectedTime?.ampm === 'PM' ? 'selected' : ''}`}
                      onClick={() => selectedTime && handleTimeSelect(selectedTime.hour, selectedTime.minute, 'PM')}
                    >
                      PM
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="picker-footer">
            <button type="button" className="btn-secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirm}
              disabled={!selectedDate || !selectedTime}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

