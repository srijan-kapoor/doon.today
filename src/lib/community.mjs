// Community events: ones posted by Dehradun's own clubs and groups rather than listed by an aggregator.
// Worked out from an event's sources, so nothing new is stored:
//   - an Instagram or Reddit lead that was checked by hand, or
//   - a hand-checked event with no other source (sent through the submit form, or added by hand).
// A thin aggregator listing that was approved by hand keeps its aggregator source, so it doesn't count.
const COMMUNITY_PROVIDERS = new Set(['instagram', 'reddit']);

export function isCommunityEvent(event) {
  const providers = (event.sources || []).map((s) => s.provider);
  if (providers.some((p) => COMMUNITY_PROVIDERS.has(p))) return true;
  return providers.length > 0 && providers.every((p) => p === 'manual');
}

const PROFILE = /instagram\.com\/(?!p\/|reel\/|stories\/)([a-z0-9._]{2,30})\/?(?:[?#]|$)/i;

/**
 * The group's Instagram handle, when the event says it: "Organized by @group." in the description (added
 * when an Instagram lead is approved), or a profile link among its sources. Empty when unknown.
 */
export function communityHandle(event) {
  const named = String(event.organizer ? `Organized by ${event.organizer}` : event.description || '').match(/Organized by @([a-z0-9._]{2,30})/i);
  if (named) return named[1].replace(/\.$/, '');
  for (const s of event.sources || []) {
    const m = String(s.url || '').match(PROFILE);
    if (m) return m[1];
  }
  return '';
}

/** Orders a day's events with community events first, keeping each group in its existing order. */
export const communityFirst = (events) => [...events.filter(isCommunityEvent), ...events.filter((e) => !isCommunityEvent(e))];
