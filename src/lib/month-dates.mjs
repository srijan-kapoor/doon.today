// Calendar-day arithmetic is shared by List filters and Month without a dependency cycle.
const DAY_MS = 24 * 3600_000;
const utc = (day) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day, n) => new Date(utc(day) + n * DAY_MS).toISOString().slice(0, 10);
export const mondayIndex = (day) => (new Date(utc(day)).getUTCDay() + 6) % 7;
export const runsOn = (range, day) => range.days ? range.days.includes(day) : range.start <= day && day <= range.end;
