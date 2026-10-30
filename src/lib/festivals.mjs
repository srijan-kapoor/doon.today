// Festival sessions: several events on one day that share a title prefix ("Virasat 2026: …") and a venue.
// The list shows them as one row that opens to the sessions; each session keeps its own page, feed entry
// and filters, so this only changes how a day's list is laid out.
const PREFIX = /^([^:]{3,40}?)\s*:\s+\S/;

/** The festival a title names before its colon, e.g. "Virasat 2026", or '' when it names none. */
export const festivalName = (title = '') => title.match(PREFIX)?.[1].trim() ?? '';

/**
 * Sessions of one festival among a day's events, in the order they come: [{ name, members }] where members
 * are indexes into items. Items are { festival, venue }; a festival needs at least two sessions at one venue.
 * @param {{ festival: string, venue: string }[]} items
 */
export function festivalGroups(items) {
  /** @type {Map<string, { name: string, members: number[] }>} */
  const groups = new Map();
  items.forEach((item, i) => {
    if (!item.festival) return;
    const key = `${item.festival.toLowerCase()}\n${item.venue.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { name: item.festival, members: [] });
    groups.get(key).members.push(i);
  });
  return [...groups.values()].filter((group) => group.members.length > 1);
}

/** "2 sessions", "1 session". */
export const sessionLabel = (n) => `${n} ${n === 1 ? 'session' : 'sessions'}`;
