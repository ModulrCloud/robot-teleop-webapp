/**
 * Utility functions for handling recurring availability patterns
 */

import { logger } from './logger';

export interface RecurrencePattern {
  type: 'weekly';
  daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  endDate?: string; // ISO date string - optional end date for recurrence
}

/**
 * Check if a given date/time falls within a recurring pattern
 */
export function matchesRecurrencePattern(
  date: Date,
  pattern: RecurrencePattern,
  startTime: Date, // The original start time (to get the time component)
  endTime: Date   // The original end time (to get the time component)
): boolean {
  if (pattern.type === 'weekly') {
    const dayOfWeek = date.getDay();
    
    // Check if this day of week is in the pattern
    if (!pattern.daysOfWeek.includes(dayOfWeek)) {
      return false;
    }
    
    // Check if we've passed the end date (if specified)
    if (pattern.endDate) {
      const endDate = new Date(pattern.endDate);
      endDate.setHours(23, 59, 59, 999); // End of day
      if (date > endDate) {
        return false;
      }
    }
    
    // Check if the time component matches
    const dateStart = new Date(date);
    dateStart.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
    
    const dateEnd = new Date(date);
    dateEnd.setHours(endTime.getHours(), endTime.getMinutes(), 0, 0);
    
    // For now, we just check if the day matches - the time check is done separately
    return true;
  }
  
  return false;
}

/**
 * Expand a recurring pattern into actual date/time instances for a given date range
 */
export function expandRecurrencePattern(
  pattern: RecurrencePattern,
  originalStartTime: Date,
  originalEndTime: Date,
  rangeStart: Date,
  rangeEnd: Date
): Array<{ startTime: Date; endTime: Date }> {
  const instances: Array<{ startTime: Date; endTime: Date }> = [];
  
  if (pattern.type === 'weekly') {
    const current = new Date(rangeStart);
    current.setHours(0, 0, 0, 0);
    
    const end = new Date(rangeEnd);
    end.setHours(23, 59, 59, 999);
    
    // Get the time components from the original start/end
    const startHour = originalStartTime.getHours();
    const startMinute = originalStartTime.getMinutes();
    const endHour = originalEndTime.getHours();
    const endMinute = originalEndTime.getMinutes();
    
    // Check each day in the range
    while (current <= end) {
      const dayOfWeek = current.getDay();
      
      if (pattern.daysOfWeek.includes(dayOfWeek)) {
        // Check if we've passed the end date (if specified)
        if (!pattern.endDate || current <= new Date(pattern.endDate)) {
          const instanceStart = new Date(current);
          instanceStart.setHours(startHour, startMinute, 0, 0);
          
          const instanceEnd = new Date(current);
          instanceEnd.setHours(endHour, endMinute, 0, 0);
          
          // If end time is before start time, it means it spans to the next day
          if (instanceEnd < instanceStart) {
            instanceEnd.setDate(instanceEnd.getDate() + 1);
          }
          
          instances.push({ startTime: instanceStart, endTime: instanceEnd });
        }
      }
      
      current.setDate(current.getDate() + 1);
    }
  }
  
  return instances;
}

/**
 * Parse a recurrence pattern from JSON string
 */
export function parseRecurrencePattern(patternString: string | null | undefined): RecurrencePattern | null {
  if (!patternString) return null;
  
  try {
    const parsed = JSON.parse(patternString);
    if (parsed.type === 'weekly' && Array.isArray(parsed.daysOfWeek)) {
      return {
        type: 'weekly',
        daysOfWeek: parsed.daysOfWeek,
        endDate: parsed.endDate,
      };
    }
  } catch (e) {
    logger.error('Failed to parse recurrence pattern:', e);
  }
  
  return null;
}

/**
 * Serialize a recurrence pattern to JSON string
 */
export function serializeRecurrencePattern(pattern: RecurrencePattern): string {
  return JSON.stringify(pattern);
}

