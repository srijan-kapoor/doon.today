// The visitor-facing changelog: entries are hand-written in src/data/changelog.json, newest first.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** @typedef {{ date: string, tag: string, text: string, link?: string }} ChangelogEntry */

export const TAGS = ['New', 'Improved', 'Fixed', 'Source', 'Removed'];

const isDay = (value) => typeof value === 'string' && DATE_ONLY.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** Problems with the entries, as readable strings; empty when they are all fine. */
export function changelogErrors(entries) {
  if (!Array.isArray(entries)) return ['the changelog is not a list'];
  const errors = [];
  entries.forEach((entry, i) => {
    const at = `entry ${i + 1}`;
    if (!isDay(entry?.date)) errors.push(`${at}: date must be a real YYYY-MM-DD day`);
    if (!TAGS.includes(entry?.tag)) errors.push(`${at}: tag must be one of ${TAGS.join(', ')}`);
    if (typeof entry?.text !== 'string' || !entry.text.trim()) errors.push(`${at}: text is empty`);
    if (entry?.link !== undefined && !/^https:\/\/\S+$/.test(entry.link)) errors.push(`${at}: link must be an https URL`);
    if (i > 0 && isDay(entry?.date) && isDay(entries[i - 1]?.date) && entry.date > entries[i - 1].date) errors.push(`${at}: newer than the entry above it`);
  });
  return errors;
}

// Labels are worked out in UTC on the bare day, so the build machine's timezone never shifts a month or day.
const label = (day, options) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { ...options, timeZone: 'UTC' });

export const dayLabel = (day) => label(day, { day: 'numeric', month: 'short' });

/**
 * Entries grouped by month, keeping their order: [{ month: 'YYYY-MM', label: 'October 2026', entries }].
 * @param {ChangelogEntry[]} entries
 */
export function changelogByMonth(entries) {
  /** @type {{ month: string, label: string, entries: ChangelogEntry[] }[]} */
  const groups = [];
  for (const entry of entries) {
    const month = entry.date.slice(0, 7);
    if (groups.at(-1)?.month !== month) groups.push({ month, label: label(`${month}-01`, { month: 'long', year: 'numeric' }), entries: [] });
    groups.at(-1).entries.push(entry);
  }
  return groups;
}
