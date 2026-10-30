// Search and link-preview metadata for event pages.
import { toInstant } from './ics.mjs';
import { occurrencesOf, nextOccurrence, DATE_ONLY, HAS_ZONE } from './dates.mjs';
import { priceLabel } from './sources.mjs';


// schema.org wants an offset on date-times; a bare local time is Dehradun time.
const schemaDate = (value) => (DATE_ONLY.test(value) || HAS_ZONE.test(value) ? value : `${value}+05:30`);

const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

/** Cuts at the end of the last whole sentence that fits, keeping all of the first `keep` characters and part of what follows; otherwise at a word, with an ellipsis. */
const clipSentence = (text, max, keep) => {
  if (text.length <= max) return text;
  const ends = [...text.slice(0, max).matchAll(/[.!?](?=\s|$)/g)].map((m) => m.index + 1).filter((end) => end > keep);
  return ends.length ? text.slice(0, ends.at(-1)) : clip(text, max);
};

const SITE_SUFFIX = ' — doon.today';

/** The page title, with the event name shortened so the whole title fits what search results show (about 60 characters). */
export function eventPageTitle(name, max = 60) {
  return `${clip(name, max - SITE_SUFFIX.length)}${SITE_SUFFIX}`;
}

/** schema.org Event for Google's event rich results. */
export function eventJsonLd(e, { pageUrl, imageUrl }) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    startDate: schemaDate(nextOccurrence(e)),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: e.venue.name,
      address: {
        '@type': 'PostalAddress',
        // Many sources only give "Dehradun" as the address, which is the locality, not a street.
        ...(e.venue.address && e.venue.address.trim().toLowerCase() !== 'dehradun' ? { streetAddress: e.venue.address } : {}),
        addressLocality: 'Dehradun',
        addressRegion: 'Uttarakhand',
        addressCountry: 'IN'
      },
      // Only coordinates the ingest kept (inside the Dehradun box); an event without them simply has none.
      ...(e.venue.geo ? { geo: { '@type': 'GeoCoordinates', latitude: e.venue.geo.lat, longitude: e.venue.geo.lng } } : {})
    },
    image: [imageUrl],
    url: pageUrl
  };
  // startAt..endAt is only the outer span of an event on specific dates, so it is not offered as one run.
  if (e.endAt && !occurrencesOf(e)) ld.endDate = schemaDate(e.endAt);
  if (e.description) ld.description = e.description;
  const sourceUrl = e.sources?.[0]?.url;
  if (e.pricing?.type === 'free') {
    ld.isAccessibleForFree = true;
    ld.offers = { '@type': 'Offer', price: 0, priceCurrency: 'INR', ...(sourceUrl ? { url: sourceUrl } : {}) };
  } else if (e.pricing?.minPrice && e.pricing.maxPrice > e.pricing.minPrice) {
    ld.offers = { '@type': 'AggregateOffer', lowPrice: e.pricing.minPrice, highPrice: e.pricing.maxPrice, priceCurrency: 'INR', ...(sourceUrl ? { url: sourceUrl } : {}) };
  } else if (e.pricing?.minPrice) {
    ld.offers = { '@type': 'Offer', price: e.pricing.minPrice, priceCurrency: 'INR', ...(sourceUrl ? { url: sourceUrl } : {}) };
  }
  return ld;
}

const summaryDay = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const summaryDayTime = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

/** One-line summary used as the page and link-preview description. When and where come first, so a search result that cuts the end still shows them. */
export function eventSummary(e) {
  const startAt = nextOccurrence(e);
  const dateOnly = DATE_ONLY.test(startAt);
  const when = dateOnly ? summaryDay.format(new Date(`${startAt}T12:00:00+05:30`)) : summaryDayTime.format(toInstant(startAt));
  const price = priceLabel(e.pricing);
  const head = [`${when} at ${e.venue.name}`, e.venue.area, 'Dehradun'].filter(Boolean).join(', ');
  const base = price ? `${head}. ${price}.` : `${head}.`;
  return e.description ? clipSentence(`${base} ${e.description}`, 200, base.length) : base;
}
