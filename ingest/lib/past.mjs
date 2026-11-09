// Events that have ended keep their page for a while, so links shared on WhatsApp and URLs search engines
// already know still land somewhere useful instead of on a 404. The pages say the event has ended, point to
// what's on next, and ask search engines not to index them.
import { isUnexpiredEvent, toInstant, occurrencesOf } from '../../src/lib/dates.mjs';
import { eventPassesGeo } from './utils.mjs';

export const PAST_PATH = 'data/past-events.json';
// How long an ended event keeps its page, counted from its last day.
export const KEEP_DAYS = 90;
const DAY_MS = 24 * 3600_000;

/** When an event was over: its end, or its last session's start, or its start. */
export function endedAt(e) {
  const sessions = occurrencesOf(e);
  const last = e.endAt || (sessions ? sessions.at(-1) : e.startAt);
  return toInstant(last).getTime();
}

/**
 * The ended events whose pages stay up: those kept before, plus events stored last run that have now ended.
 * An event that is listed again, hasn't ended yet, was rejected, is outside the area, or ended more than
 * KEEP_DAYS ago drops out.
 */
export function pastEvents({ kept = [], previous = [], listed = [], rejected = () => false, now = Date.now() }) {
  const live = new Set(listed.map((e) => e.slug));
  const out = new Map();
  for (const e of [...kept, ...previous]) {
    if (e.curation?.status !== 'published' || live.has(e.slug) || isUnexpiredEvent(e, now) || rejected(e) || !eventPassesGeo(e)) continue;
    if (!(endedAt(e) > now - KEEP_DAYS * DAY_MS)) continue;
    out.set(e.slug, e);
  }
  return [...out.values()].sort((a, b) => endedAt(b) - endedAt(a) || a.slug.localeCompare(b.slug));
}
