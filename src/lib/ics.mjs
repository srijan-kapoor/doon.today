// iCalendar (RFC 5545) output for the calendar feeds and per-event downloads. Plain .mjs so the site
// build and `node --test` share one implementation.

import { toInstant, occurrencesOf, nextOccurrence } from './dates.mjs';
export { toInstant } from './dates.mjs';

const SITE = 'https://doon.today';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DURATION_MS = 2 * 3600_000;
const encoder = new TextEncoder();

const utc = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymd = (value) => value.replace(/-/g, '');
const nextDay = (value) => {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export function escapeText(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets, never inside a multi-byte character. */
export function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // continuation lines start with one space
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** Join place parts without repeating a part already contained in an earlier one ("Dehradun, Dehradun"). */
export function joinLocation(parts) {
  const out = [];
  for (const part of parts.filter(Boolean).map((p) => String(p).trim()).filter(Boolean)) {
    const seen = out.join(', ').toLowerCase();
    if (!seen.includes(part.toLowerCase())) out.push(part);
  }
  return out.join(', ');
}

/**
 * VEVENT lines for one event.
 * DTSTAMP and LAST-MODIFIED only move when the event changes (modifiedAt), and SEQUENCE counts those changes,
 * so a refresh that changes nothing looks like nothing to a subscribed calendar.
 */
export function eventLines(e) {
  const pageUrl = `${SITE}/events/${e.slug}/`;
  const modified = toInstant(e.modifiedAt || e.firstSeenAt || e.lastCheckedAt);
  const rows = ['BEGIN:VEVENT', `UID:${e.id}@doon.today`, `DTSTAMP:${utc(modified)}`, `LAST-MODIFIED:${utc(modified)}`, `SEQUENCE:${e.sequence || 0}`];

  // An event on specific dates is one VEVENT for its first session plus an RDATE for each later one. Its
  // startAt..endAt is only the outer span, so the length of a session is the default.
  const sessions = occurrencesOf(e);
  if (DATE_ONLY.test(e.startAt)) {
    rows.push(`DTSTART;VALUE=DATE:${ymd(e.startAt)}`);
    const last = !sessions && e.endAt && DATE_ONLY.test(e.endAt) && e.endAt > e.startAt ? e.endAt : e.startAt;
    rows.push(`DTEND;VALUE=DATE:${ymd(nextDay(last))}`);
    if (sessions) rows.push(`RDATE;VALUE=DATE:${sessions.slice(1).map(ymd).join(',')}`);
  } else {
    const start = toInstant(e.startAt);
    const end = !sessions && e.endAt && !DATE_ONLY.test(e.endAt) ? toInstant(e.endAt) : null;
    // Without an end time Apple and Google show the event with no length, so assume two hours.
    rows.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end && end > start ? end : new Date(start.getTime() + DEFAULT_DURATION_MS))}`);
    if (sessions) rows.push(`RDATE:${sessions.slice(1).map((value) => utc(toInstant(value))).join(',')}`);
  }

  const description = [e.description?.trim(), `Details: ${pageUrl}`, e.sources?.[0]?.url ? `Source: ${e.sources[0].url}` : '']
    .filter(Boolean)
    .join('\n\n');
  rows.push(
    `SUMMARY:${escapeText(e.title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(joinLocation([e.venue?.name, e.venue?.address, e.venue?.area, 'Dehradun']))}`,
    `URL:${pageUrl}`
  );
  if (e.categories?.length) rows.push(`CATEGORIES:${e.categories.map(escapeText).join(',')}`);
  rows.push('END:VEVENT');
  return rows;
}

/** The `dates` value for a Google Calendar "add event" link, matching the .ics download. An event on specific dates links its next session. */
export function googleDateRange(e, now = Date.now()) {
  const sessions = occurrencesOf(e);
  const startAt = sessions ? nextOccurrence(e, now) : e.startAt;
  if (DATE_ONLY.test(startAt)) {
    const last = !sessions && e.endAt && DATE_ONLY.test(e.endAt) && e.endAt > startAt ? e.endAt : startAt;
    return `${ymd(startAt)}/${ymd(nextDay(last))}`;
  }
  const start = toInstant(startAt);
  const end = !sessions && e.endAt && !DATE_ONLY.test(e.endAt) ? toInstant(e.endAt) : null;
  return `${utc(start)}/${utc(end && end > start ? end : new Date(start.getTime() + DEFAULT_DURATION_MS))}`;
}

const finish = (rows) => rows.map(foldLine).join('\r\n') + '\r\n';

/** A subscribable calendar. `name` is what the calendar app shows; refresh hints are in hours. */
export function buildCalendar({ name = 'doon.today', description = '', events }) {
  const rows = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//doon.today//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${escapeText(name)}`,
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Asia/Kolkata',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H'
  ];
  if (description) rows.push(`DESCRIPTION:${escapeText(description)}`, `X-WR-CALDESC:${escapeText(description)}`);
  for (const e of events) rows.push(...eventLines(e));
  rows.push('END:VCALENDAR');
  return finish(rows);
}

/** A single-event download for "Add to calendar". */
export function buildEventCalendar(e) {
  return finish(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//doon.today//Event//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...eventLines(e), 'END:VCALENDAR']);
}
