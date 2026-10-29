// Leads waiting for review live as GitHub issues labelled "lead": one per submit-form entry and one per
// r/Dehradun post the Reddit adapter flags. The issue body carries the event details in a fenced block,
// which the reviewer can edit; adding the "approve" label publishes it, closing the issue rejects it.
//
// Everything in a lead comes from the public, so it is treated as text: it stays inside the fenced block
// (where "@name" and "#12" don't notify or link anyone), loses backticks, and is cut to a sane length.
import { buildCuratedEvent, parsePrice, parseWhen } from './review.mjs';
import { CATEGORY_NAMES, areaFromText, categoryFromText, decodeEntities, stripHtml, RENAMED_CATEGORIES } from './utils.mjs';
import { sourceLabel } from '../../src/lib/sources.mjs';

export const LEAD_LABEL = 'lead';
export const APPROVE_LABEL = 'approve';

// Fields in the order they appear in the issue. The description comes last and may run over several lines.
const FIELDS = [
  ['title', 'title'],
  ['starts', 'starts'],
  ['ends', 'ends'],
  ['venue', 'venue'],
  ['area', 'area'],
  ['price', 'price'],
  ['categories', 'categories'],
  ['listing', 'listing link'],
  ['organizer', 'organizer'],
  ['organizerLink', 'organizer link'],
  ['submittedBy', 'submitted by'],
  ['howToJoin', 'how to join'],
  ['repeats', 'repeats'],
  ['post', 'post'],
  ['description', 'description']
];
const KEY_BY_LABEL = new Map(FIELDS.map(([key, label]) => [label, key]));

const MAX_LINE = 300;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 1000;

/** One line of untrusted text: no line breaks or backticks, trimmed and capped. */
export function cleanLine(value, max = MAX_LINE) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/`/g, "'").replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

/** Several lines of untrusted text, for the description. */
export function cleanText(value, max = MAX_DESCRIPTION) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/`/g, "'").replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

const cleanUrl = (value) => {
  const text = cleanLine(value);
  try { const u = new URL(text); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : ''; } catch { return ''; }
};

/**
 * The lead for one submit-form entry (Netlify's submission data, keyed by input name), or null when it is
 * a bot (the hidden field is filled) or lacks a title or date. Contact details are left out on purpose:
 * the issue is public, and they stay in the Netlify submission.
 */
export function formLead(data = {}) {
  if (cleanLine(data['bot-field'])) return null;
  const title = cleanLine(data.title, MAX_TITLE);
  const date = cleanLine(data.date);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = cleanLine(data.time);
  const timeFixed = !cleanLine(data.time_tbd) && /^\d{1,2}:\d{2}$/.test(time);
  const endTime = cleanLine(data.end_time);
  const priceType = cleanLine(data.price_type).toLowerCase();
  const amount = cleanLine(data.price_amount).replace(/[^\d]/g, '');
  return {
    kind: 'form',
    title,
    starts: timeFixed ? `${date} ${time}` : date,
    ends: timeFixed && /^\d{1,2}:\d{2}$/.test(endTime) ? `${date} ${endTime}` : '',
    venue: cleanLine(data.venue),
    area: cleanLine(data.area),
    price: priceType === 'free' ? 'free' : priceType === 'paid' && amount ? amount : 'unknown',
    categories: cleanLine(data.category),
    listing: cleanUrl(data.listing_url),
    organizer: cleanLine(data.organizer),
    organizerLink: cleanLine(data.organizer_link),
    // "organizer" or "community" (someone who saw it somewhere); anything else counts as community.
    submittedBy: cleanLine(data.submitter).toLowerCase() === 'organizer' ? 'organizer' : 'community',
    howToJoin: cleanLine(data.how_to_join),
    repeats: cleanLine(data.repeats),
    post: '',
    description: cleanText(data.description)
  };
}

const istText = (iso) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso;
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t + 5.5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : '';
};

// Kinds of lead that come from the review queue (data/review/reddit.json): an r/Dehradun post, an Instagram
// post a model read, or a listing from a source like AllEvents that was too thin to publish on its own. All
// are keyed by the candidate id.
const QUEUED_KINDS = new Set(['reddit', 'instagram', 'listing']);
export const isQueuedKind = (kind) => QUEUED_KINDS.has(kind);

const queuedPrice = (pricing = {}) => (pricing.type === 'free' ? 'free' : pricing.type === 'paid' && pricing.minPrice ? String(pricing.minPrice) : 'unknown');

/** The lead for one candidate in the review queue: a Reddit or Instagram post, or a held-back listing. */
export function sourceLead(candidate) {
  const provider = candidate.sources?.[0]?.provider || '';
  const kind = provider === 'reddit' || provider === 'instagram' ? provider : 'listing';
  const url = cleanUrl(candidate.sources?.[0]?.url);
  const venue = cleanLine(candidate.venue?.name);
  // An Instagram candidate carries what the model read from the post; a Reddit one only a guessed date.
  const read = kind === 'instagram';
  return {
    kind,
    source: provider,
    id: candidate.id,
    title: cleanLine(candidate.title, MAX_TITLE),
    starts: istText(candidate.startAt),
    ends: read ? istText(candidate.endAt) : '',
    venue: /^See (community|Instagram) post$/.test(venue) ? '' : venue,
    area: '',
    price: kind === 'reddit' ? 'unknown' : queuedPrice(candidate.pricing),
    categories: (candidate.categories || []).join(', '),
    listing: kind === 'listing' ? url : '',
    organizer: read && candidate.organizer ? `@${cleanLine(candidate.organizer)}` : '',
    // No organizer link: an approved event links to the post, which an organizer link would replace.
    organizerLink: '',
    submittedBy: '',
    howToJoin: read ? cleanLine(candidate.howToJoin) : '',
    repeats: '',
    post: kind === 'listing' ? '' : url,
    // Leads queued before the adapter decoded Reddit's escaped HTML still carry it, so clean it here too.
    description: cleanText(stripHtml(decodeEntities(candidate.description || '')))
  };
}
export const redditLead = sourceLead;

// "@" and "#" in an issue title don't notify anyone, but keep them from reading as handles or links.
const safeTitle = (text) => cleanLine(text, MAX_TITLE).replace(/@/g, '@​').replace(/#(\d)/g, '#​$1');

/** The GitHub issue (title, body, labels) that puts a lead in the review queue. */
export function leadIssue(lead) {
  const marker = isQueuedKind(lead.kind) ? `<!-- doon-lead kind=${lead.kind} id=${cleanLine(lead.id).replace(/[^a-z0-9-]/gi, '')} -->` : '<!-- doon-lead kind=form -->';
  const block = FIELDS.map(([key, label]) => {
    const value = key === 'description' ? cleanText(lead[key]) : cleanLine(lead[key], key === 'title' ? MAX_TITLE : MAX_LINE);
    return `${label}: ${value}`;
  }).join('\n');
  const intro = lead.kind === 'reddit'
    ? 'A post on r/Dehradun that looks like an event. The date and time were guessed from the post, and the venue is usually missing.'
    : lead.kind === 'instagram'
      ? `An Instagram post that announces an event: ${cleanUrl(lead.post) || 'see the post link below'}\n\nA model read these details from the caption and the poster, and it can be wrong. Open the post and check them against it first.`
    : lead.kind === 'listing'
      ? `A listing from ${sourceLabel(lead.source)} that is on the site but says very little about itself: a short description, no start time and no category. Open the listing link and check it's a real event in Dehradun. Close this issue to remove it from the site; add the \`approve\` label to keep it as a checked event (fix the details first if needed).`
      : 'An event sent through the submit form on doon.today. Contact details, if given, are only in the Netlify submission.';
  const body = [
    marker,
    intro,
    '',
    'To publish it, check the details, edit this issue to fix anything, then add the `approve` label. To reject it, close the issue.',
    '',
    'Dates are IST, as `YYYY-MM-DD HH:mm`, or `YYYY-MM-DD` when the time is not fixed. Price is `free`, `unknown` or an amount in rupees. Categories are any of: ' + CATEGORY_NAMES.join(', ') + '.',
    '',
    '### Event details',
    '',
    '```text',
    block,
    '```'
  ].join('\n');
  const when = lead.starts ? ` (${cleanLine(lead.starts).slice(0, 10)})` : '';
  return { title: `Lead: ${safeTitle(lead.title)}${when}`, body, labels: [LEAD_LABEL] };
}

/** The kind and Reddit id from a lead issue's hidden marker, even if the details block was edited away. */
export function leadMarker(body = '') {
  const m = String(body).match(/<!--\s*doon-lead\s+kind=(form|reddit|instagram|listing)(?:\s+id=([a-z0-9-]+))?\s*-->/i);
  return m ? { kind: m[1].toLowerCase(), id: m[2] || '' } : null;
}

/** Reads a lead issue back, after any edits: its kind, its Reddit id if any, and the detail fields. */
export function parseLeadIssue(body = '') {
  const text = String(body).replace(/\r\n?/g, '\n');
  const marker = leadMarker(text);
  if (!marker) return null;
  const block = text.match(/```text\n([\s\S]*?)\n```/);
  if (!block) return null;
  const fields = Object.fromEntries(FIELDS.map(([key]) => [key, '']));
  const lines = block[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([a-z ]+?)\s*:\s?(.*)$/i);
    const key = m && KEY_BY_LABEL.get(m[1].toLowerCase());
    if (!key) continue;
    if (key === 'description') { fields.description = cleanText([m[2], ...lines.slice(i + 1)].join('\n')); break; }
    fields[key] = cleanLine(m[2], key === 'title' ? MAX_TITLE : MAX_LINE);
  }
  return { ...marker, fields };
}

/**
 * The link a rejection should remember for a queued lead: the candidate's own, or, if the candidate has
 * already left the queue (the listing changed or disappeared), the listing or post link in the issue.
 */
export function leadSourceUrl(parsed, candidate) {
  return candidate?.sources?.[0]?.url || cleanUrl(parsed?.fields?.listing) || cleanUrl(parsed?.fields?.post) || '';
}

/** The review decision key for a lead: the queued candidate's id, or the issue number for a form entry. */
export const leadKey = (parsed, issueNumber) => (isQueuedKind(parsed.kind) ? parsed.id : `form-${issueNumber}`);

// Includes renamed categories, so an older lead that still says Community publishes as Meetups.
const knownCategory = new Map([...CATEGORY_NAMES.map((name) => [name.toLowerCase(), name]), ...Object.entries(RENAMED_CATEGORIES).map(([old, name]) => [old.toLowerCase(), name])]);

/**
 * The event to publish for an approved lead. Throws with a plain message when a detail is missing or
 * unreadable, so the reviewer can fix the issue and approve again. `issueUrl` identifies a form entry
 * that has no link of its own.
 */
export function leadToEvent(parsed, { issueUrl, candidate, now } = {}) {
  const f = parsed.fields;
  if (!f.title) throw new Error('the title is empty');
  if (!parseWhen(f.starts)) throw new Error(`"starts" must look like 2026-11-02 18:30 or 2026-11-02, not "${f.starts}"`);
  if (f.ends && !parseWhen(f.ends)) throw new Error(`"ends" must look like 2026-11-02 21:00, or be empty, not "${f.ends}"`);
  if (!f.venue) throw new Error('the venue is empty');
  if (!parsePrice(f.price)) throw new Error(`"price" must be free, unknown or an amount in rupees, not "${f.price}"`);

  const categories = f.categories.split(',').map((c) => knownCategory.get(c.trim().toLowerCase())).filter(Boolean);
  const organizerLink = cleanUrl(f.organizerLink);
  const extra = [
    f.organizer && `Organized by ${f.organizer}.`,
    f.howToJoin && `How to join: ${f.howToJoin}`,
    !f.listing && f.organizerLink && !organizerLink && `Organizer: ${f.organizerLink}`
  ].filter(Boolean).join(' ');
  const description = [f.description, extra].filter(Boolean).join('\n\n');
  const url = cleanUrl(f.listing) || organizerLink || (isQueuedKind(parsed.kind) ? cleanUrl(f.post) : '') || issueUrl;

  const base = candidate || { title: f.title, description, sources: [] };
  const event = buildCuratedEvent(base, {
    title: f.title,
    when: f.starts,
    endWhen: f.ends || undefined,
    venue: f.venue,
    price: f.price,
    url,
    description,
    categories: categories.length ? categories : categoryFromText(`${f.title} ${description}`)
  }, now);
  // A form entry from someone who isn't the organizer is still checked by hand, but shows as "Community
  // reported". The mark goes on the hand-check source, so the merge keeps it (see verificationStatus).
  // The same rule as formLead: anything but "organizer" counts as community, so a reviewer's free-text edit
  // can't publish as verified by accident. Older leads have no "submitted by" line and stay verified.
  const community = parsed.kind === 'form' && Boolean(f.submittedBy) && f.submittedBy.toLowerCase() !== 'organizer';
  const checked = community
    ? { ...event, verificationStatus: 'community-reported', sources: event.sources.map((s, i) => (i === 0 ? { ...s, community: true } : s)) }
    : event;
  // Only names on the area list, so a typo or "near ISBT" never reaches the Area filter; without one, the
  // merge reads the area from the venue as it does for every other event.
  const area = f.area && areaFromText(f.area);
  return area ? { ...checked, venue: { ...checked.venue, area } } : checked;
}
