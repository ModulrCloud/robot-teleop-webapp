import { useState, useRef, useEffect, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarAlt } from '@fortawesome/free-solid-svg-icons';
import './DateTimePicker.css';

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
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

  useEffect(() => {
    if (value) {
      const date = new Date(`${value}T00:00:00`);
      if (!isNaN(date.getTime())) {
        setSelectedDate(date);
        setCurrentMonth(date);
      }
    } else {
      setSelectedDate(null);
    }
  }, [value]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      const inputRect = inputRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - inputRect.bottom;
      const spaceAbove = inputRect.top;
      const pickerHeight = 350;

      setOpenUpward(spaceBelow < pickerHeight && spaceAbove > spaceBelow);
    }
  }, [isOpen]);

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

  const minDate = useMemo(() => (min ? new Date(`${min}T00:00:00`) : null), [min]);
  const maxDate = useMemo(() => (max ? new Date(`${max}T00:00:00`) : null), [max]);

  const isDateDisabled = (date: Date) => {
    if (minDate && date < minDate) return true;
    if (maxDate && date > maxDate) return true;
    return false;
  };

  const handleDateSelect = (date: Date) => {
    if (isDateDisabled(date)) return;
    setSelectedDate(date);
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
          </div>
        </div>
      )}
    </div>
  );
}
