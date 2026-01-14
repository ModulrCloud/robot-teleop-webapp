import { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarAlt } from '@fortawesome/free-solid-svg-icons';
import './DateTimePicker.css';

interface DatePickerProps {
  value: string; // YYYY-MM-DD format or empty
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  disabled?: boolean;
  min?: string; // YYYY-MM-DD format
  max?: string; // YYYY-MM-DD format
}

export function DatePicker({
  value,
  onChange,
  label,
  required = false,
  disabled = false,
  min,
  max,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [openUpward, setOpenUpward] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  // Parse initial value
  useEffect(() => {
    if (value) {
      const date = new Date(value + 'T00:00:00'); // Add time to avoid timezone issues
      if (!isNaN(date.getTime())) {
        setSelectedDate(date);
        setCurrentMonth(date);
      }
    } else {
      setSelectedDate(null);
    }
  }, [value]);

  // Calculate if picker should open upward
  useEffect(() => {
    if (isOpen && inputRef.current) {
      const inputRect = inputRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - inputRect.bottom;
      const spaceAbove = inputRect.top;
      const pickerHeight = 350; // Approximate height of the date picker modal

      setOpenUpward(spaceBelow < pickerHeight && spaceAbove > spaceBelow);
    }
  }, [isOpen]);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  const formatDisplayValue = (): string => {
    if (!selectedDate) return '';
    return selectedDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    // Format as YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    onChange(`${year}-${month}-${day}`);
    setIsOpen(false);
  };

  const handleClear = () => {
    setSelectedDate(null);
    onChange('');
    setIsOpen(false);
  };

  // Calendar helpers
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
    const today = new Date();
    setCurrentMonth(new Date());
    setSelectedDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    onChange(`${year}-${month}-${day}`);
    setIsOpen(false);
  };

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="datetime-picker-wrapper" ref={pickerRef}>
      <label>
        {label} {required && <span className="required">*</span>}
      </label>
      <div className="datetime-input" ref={inputRef} onClick={() => !disabled && setIsOpen(!isOpen)}>
        <input
          type="text"
          value={formatDisplayValue()}
          readOnly
          placeholder="Select date"
          disabled={disabled}
          className={disabled ? 'disabled' : ''}
        />
        <FontAwesomeIcon icon={faCalendarAlt} className="calendar-icon" />
      </div>

      {isOpen && (
        <div className={`datetime-picker-modal ${openUpward ? 'open-upward' : ''}`}>
          <div className="picker-content" style={{ minHeight: 'auto' }}>
            {/* Date Picker */}
            <div className="date-picker-section" style={{ flex: '1', minWidth: '320px' }}>
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
                    
                    // Check min/max constraints
                    let isDisabled = false;
                    if (min) {
                      const minDate = new Date(min + 'T00:00:00');
                      if (date < minDate) isDisabled = true;
                    }
                    if (max) {
                      const maxDate = new Date(max + 'T00:00:00');
                      if (date > maxDate) isDisabled = true;
                    }
                    
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
          </div>
        </div>
      )}
    </div>
  );
}
