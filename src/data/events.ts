import type { EventRecord } from '../types/event';
import rawEvents from '../../data/events.json';
import rawPastEvents from '../../data/past-events.json';
import { currentCategories } from '../../ingest/lib/utils.mjs';
import { splitDescription } from '../lib/details.mjs';
// Renamed categories read as their new names until the next refresh rewrites the data.
// The organizer and how-to-join line become fields of their own (see src/lib/details.mjs).
const readable = (e: EventRecord) => {
  const { text, organizer, howToJoin } = splitDescription(e.description);
  return { ...e, categories: currentCategories(e.categories), description: text, ...(organizer && { organizer }), ...(howToJoin && { howToJoin }) };
};
export const events = (rawEvents as EventRecord[]).map(readable);
// Ended events whose pages stay up for a while (see ingest/lib/past.mjs).
export const pastEvents = (rawPastEvents as EventRecord[]).map(readable);
