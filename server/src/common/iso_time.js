/**
 * Parse an explicit-zone ISO timestamp without Date.parse's calendar rollover.
 * Return normalized UTC, or null for any unsupported or impossible timestamp.
 * Domain modules translate null to their own error type at the API boundary.
 */
export function normalizeIsoTimestamp(value, { minYear = 1 } = {}) {
  const parts = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond, , zone, , rawOffsetHour, rawOffsetMinute] = parts;
  const [year, month, day, hour, minute, second] = [rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond].map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < minYear || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
      hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== "Z") {
    const offsetHour = Number(rawOffsetHour);
    const offsetMinute = Number(rawOffsetMinute);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}
