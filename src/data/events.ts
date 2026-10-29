import type { EventRecord } from '../types/event';
import rawEvents from '../../data/events.json';
import { currentCategories } from '../../ingest/lib/utils.mjs';
// Renamed categories read as their new names until the next refresh rewrites the data.
export const events = (rawEvents as EventRecord[]).map((e) => ({ ...e, categories: currentCategories(e.categories) }));
