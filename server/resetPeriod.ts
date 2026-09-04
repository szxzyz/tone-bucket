/**
 * Reset Period Utility
 * Windows: 
 * - AM: 06:30:00 UTC to 18:29:59 UTC
 * - PM: 18:30:00 UTC to 06:29:59 UTC (next day)
 */

export function getResetPeriodKey(date: Date = new Date()): string {
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  
  const isAM = (hours > 6 || (hours === 6 && minutes >= 30)) && (hours < 18 || (hours === 18 && minutes < 30));
  
  let dateObj = new Date(date);
  // If before 06:30 UTC, the "day" belongs to yesterday's PM window.
  if (hours < 6 || (hours === 6 && minutes < 30)) {
    dateObj.setUTCDate(dateObj.getUTCDate() - 1);
    return `${dateObj.toISOString().split('T')[0]}-PM`;
  }
  
  return `${dateObj.toISOString().split('T')[0]}-${isAM ? 'AM' : 'PM'}`;
}

export function getPeriodStart(date: Date = new Date()): Date {
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  
  const start = new Date(date);
  start.setUTCSeconds(0, 0);
  
  if (hours < 6 || (hours === 6 && minutes < 30)) {
    // Before 06:30 UTC: Start was 18:30 UTC yesterday
    start.setUTCDate(start.getUTCDate() - 1);
    start.setUTCHours(18, 30, 0, 0);
  } else if (hours < 18 || (hours === 18 && minutes < 30)) {
    // Between 06:30 and 18:30 UTC: Start was 06:30 UTC today
    start.setUTCHours(6, 30, 0, 0);
  } else {
    // After 18:30 UTC: Start was 18:30 UTC today
    start.setUTCHours(18, 30, 0, 0);
  }
  
  return start;
}

export function getPreviousPeriodKey(date: Date = new Date()): string {
  const start = getPeriodStart(date);
  // Go back 1 second to be in the previous period
  const prev = new Date(start.getTime() - 1000);
  return getResetPeriodKey(prev);
}

export function getNextResetTime(date: Date = new Date()): Date {
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  
  const next = new Date(date);
  next.setUTCSeconds(0, 0);
  
  if (hours < 6 || (hours === 6 && minutes < 30)) {
    next.setUTCHours(6, 30, 0, 0);
  } else if (hours < 18 || (hours === 18 && minutes < 30)) {
    next.setUTCHours(18, 30, 0, 0);
  } else {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(6, 30, 0, 0);
  }
  
  return next;
}
