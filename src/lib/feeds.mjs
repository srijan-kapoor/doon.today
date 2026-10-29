// The calendar feeds offered on /calendars: collections, one per category and one per source.
// The set is fixed (not derived from today's events) so a subscription never 404s when a category
// is empty for a while.
import { CATEGORY_NAMES, currentCategories } from '../../ingest/lib/utils.mjs';
import { SOURCE_LABELS } from './sources.mjs';
import { isCommunityEvent } from './community.mjs';

export const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Manual entries get no source feed of their own.
const FEED_SOURCES = Object.entries(SOURCE_LABELS).filter(([provider]) => provider !== 'manual');

const isPublished = (e) => e.curation?.status === 'published';

/** Every feed: { id, kind, label, description, filter }. `id` is the file name, `/calendars/<id>.ics`. */
export function feedDefinitions() {
  return [
    { id: 'verified', kind: 'collection', label: 'Confirmed only', description: 'Checked by hand, or listed by the organizer or venue itself; leaves out events taken only from listing sites', filter: (e) => e.verificationStatus === 'verified' },
    { id: 'community', kind: 'collection', label: 'Community picks', description: 'Posted by Dehradun’s own clubs and groups, and checked by hand', filter: isCommunityEvent },
    { id: 'free', kind: 'collection', label: 'Free', description: 'Free events', filter: (e) => e.pricing?.type === 'free' },
    ...CATEGORY_NAMES.map((name) => ({ id: `category-${slug(name)}`, kind: 'category', label: name, description: `${name} events`, filter: (e) => currentCategories(e.categories).includes(name) })),
    ...FEED_SOURCES.map(([provider, label]) => ({ id: `source-${provider}`, kind: 'source', label, description: `Events listed by ${label}`, filter: (e) => (e.sources || []).some((s) => s.provider === provider) }))
  ];
}

export const feedPath = (id) => `/calendars/${id}.ics`;

// Feeds renamed with their category, kept at the old address so existing subscriptions keep working.
export const FEED_ALIASES = { 'category-community': 'category-meetups' };

export function eventsForFeed(feed, events) {
  return events.filter(isPublished).filter(feed.filter);
}
