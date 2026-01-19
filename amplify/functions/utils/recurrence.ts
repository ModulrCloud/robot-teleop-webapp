export type RecurrencePattern = {
  type: 'weekly';
  daysOfWeek: number[];
  endDate?: string;
};

export const parseRecurrencePattern = (value: string): RecurrencePattern | null => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || parsed.type !== 'weekly' || !Array.isArray(parsed.daysOfWeek)) {
      return null;
    }
    return parsed as RecurrencePattern;
  } catch {
    return null;
  }
};

export const hasRecurringConflict = (
  blocks: Array<{ startTime: string; endTime: string; recurrencePattern?: string }>,
  start: Date,
  end: Date
) => {
  const windowStart = new Date(start);
  const windowEnd = new Date(end);

  for (const block of blocks) {
    if (!block.recurrencePattern) continue;
    const pattern = parseRecurrencePattern(block.recurrencePattern);
    if (!pattern || pattern.daysOfWeek.length === 0) continue;

    const originalStart = new Date(block.startTime);
    const originalEnd = new Date(block.endTime);
    if (isNaN(originalStart.getTime()) || isNaN(originalEnd.getTime())) continue;

    const patternEndDate = pattern.endDate ? new Date(`${pattern.endDate}T23:59:59`) : null;
    if (patternEndDate && isNaN(patternEndDate.getTime())) {
      continue;
    }

    const cursor = new Date(windowStart);
    cursor.setHours(0, 0, 0, 0);

    while (cursor <= windowEnd) {
      if (patternEndDate && cursor > patternEndDate) {
        break;
      }

      if (pattern.daysOfWeek.includes(cursor.getDay())) {
        const instanceStart = new Date(cursor);
        instanceStart.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
        const instanceEnd = new Date(cursor);
        instanceEnd.setHours(originalEnd.getHours(), originalEnd.getMinutes(), 0, 0);
        if (instanceEnd <= instanceStart) {
          instanceEnd.setDate(instanceEnd.getDate() + 1);
        }

        if (windowStart < instanceEnd && windowEnd > instanceStart) {
          return true;
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return false;
};
