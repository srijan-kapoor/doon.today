// Display names for event sources.
export const SOURCE_LABELS = {
  district: 'District',
  allevents: 'AllEvents',
  virasat: 'Virasat',
  thrillzone: 'Thrill Zone',
  literaturefestival: 'Dehradun Literature Festival',
  meetup: 'Meetup',
  gdg: 'Google Developer Groups',
  reddit: 'r/Dehradun',
  instagram: 'Instagram',
  manual: 'doon.today'
};

export const sourceLabel = (provider) => SOURCE_LABELS[provider] ?? provider;

/**
 * The label for an event's main link, or null when there is nothing worth linking to. A source's own
 * listing says "Tickets and details on District". A hand-checked event ("manual") links wherever the
 * reviewer pointed it, so the label names that place instead of doon.today; a review issue on GitHub
 * (used only when a submission had no link of its own) isn't shown at all.
 */
export function detailsLinkLabel(source) {
  if (!source?.url) return null;
  if (source.provider !== 'manual') return `Tickets and details on ${sourceLabel(source.provider)}`;
  let host = '';
  try { host = new URL(source.url).hostname.replace(/^www\./, ''); } catch { return null; }
  if (host === 'github.com') return null;
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) return 'Details in the r/Dehradun post';
  if (host === 'instagram.com') return 'Details on Instagram';
  return `Details on ${host}`;
}

const rupees = (n) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;

/**
 * An event's price for display. `long` is for the event page ("₹1,500–4,000", "From ₹1,500", "Free");
 * `short` is for list rows ("₹1,500+", "FREE"). Empty when the price is unknown.
 */
export function priceLabel(pricing, style = 'long') {
  if (pricing?.type === 'free') return style === 'short' ? 'FREE' : 'Free';
  if (!pricing?.minPrice) return '';
  if (style === 'short') return `${rupees(pricing.minPrice)}+`;
  return pricing.maxPrice > pricing.minPrice ? `${rupees(pricing.minPrice)}–${Math.round(Number(pricing.maxPrice)).toLocaleString('en-IN')}` : `From ${rupees(pricing.minPrice)}`;
}
