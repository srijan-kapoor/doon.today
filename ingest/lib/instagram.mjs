// Instagram as a source of leads: the bookkeeping between runs, kept free of network calls so it can be
// tested. The adapter (ingest/sources/instagram.mjs) fetches each account's recent posts through Bright
// Data, has a model read the new ones, and turns announcements into review candidates.
//
// The state file remembers, per account, the running job, when it was last fetched and the posts already
// read, plus the candidates found so far. Candidates are sent again on every run until their day has
// passed: the merge replaces a source's queued candidates with what the source returns, so a run that
// found nothing new must not empty the queue.
import crypto from 'node:crypto';
import { stableId, slugify, categoryFromText, CATEGORY_NAMES } from './utils.mjs';
import { parseWhen, parsePrice } from './review.mjs';
import { istDay } from '../../src/lib/dates.mjs';

export const STATE_PATH = 'data/instagram-state.json';
// Bright Data's Profiles scraper: one record per account, holding its 12 newest posts.
export const PROFILES_DATASET = 'gd_l1vikfch901nx3by4';

const HOUR = 3_600_000;
// Fetch each account about once a day; refreshes run every 8 hours, so 20 leaves room for late starts.
export const REFETCH_HOURS = 20;
// A job still running after this long is given up and started again.
export const GIVE_UP_HOURS = 12;
// Older posts announce events that are long over, and pinned posts can be months old.
export const MAX_POST_AGE_DAYS = 30;
const SEEN_LIMIT = 60;

export const emptyState = () => ({ accounts: {}, collected: [], candidates: [] });

/** Handles from a comma- or space-separated list, without "@" or duplicates. */
export function parseHandles(text = '') {
  return [...new Set(String(text).split(/[\s,]+/).map((h) => h.replace(/^@/, '').trim().toLowerCase()).filter(Boolean))];
}

// The state is committed with the site's data, so accounts are keyed by a hash rather than by handle.
export const accountKey = (handle) => crypto.createHash('sha256').update(handle.toLowerCase()).digest('hex').slice(0, 12);

export const profileUrl = (handle) => `https://www.instagram.com/${handle}/`;

export function handleFromUrl(url = '') {
  return String(url).match(/instagram\.com\/([^/?#]+)/i)?.[1]?.toLowerCase() || '';
}

const hoursSince = (iso, now) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? (now - t) / HOUR : Infinity;
};

/** The handles to start a job for: no job running, and not fetched in the last REFETCH_HOURS. */
export function accountsToStart(state, handles, now) {
  return handles.filter((h) => {
    const account = state.accounts[accountKey(h)] || {};
    return !account.snapshot && hoursSince(account.lastFetchedAt, now) >= REFETCH_HOURS;
  });
}

export const isAbandoned = (snapshot, now) => hoursSince(snapshot?.startedAt, now) >= GIVE_UP_HOURS;

/** One Profiles record as { handle, error, posts }, each post { id, url, postedOn, caption, imageUrl }. */
export function profilePosts(record = {}) {
  const handle = (record.account || handleFromUrl(record.input?.url) || handleFromUrl(record.url)).toLowerCase();
  if (record.error || record.error_code) return { handle, error: `${record.error_code || 'error'}: ${record.error || ''}`.trim(), posts: [] };
  const posts = (record.posts || []).filter((p) => p?.id && p?.url).map((p) => ({
    id: String(p.id),
    url: p.url,
    // Bright Data gives the day only (midnight UTC); the time of day is not known.
    postedOn: String(p.datetime || '').slice(0, 10),
    caption: String(p.caption || ''),
    imageUrl: p.image_url || ''
  }));
  return { handle, error: '', posts };
}

/** Posts not read before, recent enough to announce something upcoming, with something to read. */
export function unseenPosts(posts, seen = [], now) {
  const known = new Set(seen);
  const cutoff = new Date(now - MAX_POST_AGE_DAYS * 24 * HOUR).toISOString().slice(0, 10);
  return posts.filter((p) => !known.has(p.id) && p.postedOn >= cutoff && (p.caption.trim() || p.imageUrl));
}

// Error text goes into the public state file, and Bright Data's errors can quote the profile URL.
export const publicError = (text = '') => String(text).replace(/instagram\.com\/[^\s/"'?#]+/gi, 'instagram.com/…').slice(0, 160);

export const rememberSeen = (seen = [], ids = []) => [...new Set([...ids, ...seen])].slice(0, SEEN_LIMIT);

/**
 * The review candidate for a post the model read, or null when it isn't an announcement of an event on
 * or after `today` (an IST day). One account's posts about the same day share an id, so a reminder post
 * joins the first one instead of opening a second lead. The cost: two events by one account on one day
 * become one lead, with the second noted in it for the reviewer.
 */
export function candidateFromReading(reading, post, handle, { today, checkedAt }) {
  if (!reading?.is_announcement) return null;
  const startAt = parseWhen(reading.starts || '');
  if (!startAt || istDay(startAt) < today) return null;
  const endAt = reading.ends ? parseWhen(reading.ends) : null;
  const title = String(reading.title || '').trim() || `Event by @${handle}`;
  // The model's categories, from the fixed list; the keyword rules when it gave none.
  const picked = (reading.categories || []).filter((c) => CATEGORY_NAMES.includes(c) && c !== 'Other');
  const pricing = parsePrice(reading.price === 'free' ? 'free' : String(reading.price ?? '')) || { type: 'unknown', currency: 'INR' };
  return {
    id: stableId('instagram', handle, istDay(startAt)),
    slug: slugify(title),
    title,
    description: post.caption.slice(0, 800),
    startAt,
    ...(endAt && endAt > startAt ? { endAt } : {}),
    venue: { name: String(reading.venue || '').trim() || 'See Instagram post', city: 'Dehradun' },
    categories: picked.length ? [...new Set(picked)].slice(0, 2) : categoryFromText(`${title} ${post.caption}`),
    pricing,
    howToJoin: String(reading.how_to_join || '').trim(),
    organizer: handle,
    posts: [post.url],
    reading: { detailsFrom: reading.details_from, confidence: reading.confidence },
    sources: [{ provider: 'instagram', url: post.url, checkedAt, confidence: 0.5 }],
    verificationStatus: 'community-reported',
    curation: { status: 'review', score: 3 },
    firstSeenAt: checkedAt,
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt
  };
}

const timeOf = (iso = '') => (iso.length > 10 ? iso.slice(11, 16) : '');

/**
 * Adds a candidate to the list. A second post about the same day is added to the first one's posts, and
 * a time that disagrees is noted in the description for the reviewer.
 */
export function addCandidate(candidates, candidate) {
  const i = candidates.findIndex((c) => c.id === candidate.id);
  if (i === -1) return [...candidates, candidate];
  const existing = candidates[i];
  if (existing.posts?.includes(candidate.posts[0])) return candidates;
  const notes = [];
  if (timeOf(candidate.startAt) && timeOf(candidate.startAt) !== timeOf(existing.startAt)) {
    notes.push(`Another post (${candidate.posts[0]}) gives the time as ${timeOf(candidate.startAt)}.`);
  }
  const place = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const [a, b] = [place(candidate.venue.name), place(existing.venue.name)];
  if (a !== 'see instagram post' && !a.includes(b) && !b.includes(a)) {
    notes.push(`Another post (${candidate.posts[0]}) gives the venue as ${candidate.venue.name}.`);
  }
  const merged = {
    ...existing,
    posts: [...existing.posts, ...candidate.posts],
    description: [...notes, existing.description].join('\n\n'),
    lastSeenAt: candidate.lastSeenAt,
    lastCheckedAt: candidate.lastCheckedAt
  };
  return candidates.map((c, j) => (j === i ? merged : c));
}

/** Candidates whose day hasn't passed yet. */
export const upcomingCandidates = (candidates, today) => candidates.filter((c) => istDay(c.endAt || c.startAt) >= today);

/** Snapshot ids collected in the last few days, so a job found again by listing isn't read twice. */
export function rememberCollected(collected = [], id, now) {
  const cutoff = new Date(now - 3 * 24 * HOUR).toISOString();
  return [...collected.filter((c) => c.at >= cutoff && c.id !== id), { id, at: new Date(now).toISOString() }];
}
