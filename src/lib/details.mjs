// The parts of an event's description that are not description. An approved lead or form entry ends with a
// line like "Organized by @group. How to join: DM to register" (see leadToEvent in ingest/lib/leads.mjs); the
// event page shows those as their own rows, and the text around them without hashtags.
import { stripHashtags } from '../../ingest/lib/utils.mjs';

// The organizer ends at the full stop before "How to join:" or at the end, so "Dr. Rao" stays whole.
const ORGANIZER = /^Organized by (.+?)\.(?=\s+(?:How to join: |Organizer: )|\s*$)/s;
const DETAILS = /^(?:Organized by .+?\.(?=\s+(?:How to join: |Organizer: )|\s*$))?\s*(?:How to join: .+?)?\s*(?:Organizer: \S+)?$/s;

export function splitDescription(description = '') {
  const paragraphs = String(description).split(/\n{2,}/);
  const last = paragraphs.at(-1)?.trim() || '';
  let organizer = '', howToJoin = '';
  if (paragraphs.length && /^(Organized by |How to join: |Organizer: )/.test(last) && DETAILS.test(last)) {
    paragraphs.pop();
    organizer = last.match(ORGANIZER)?.[1]?.trim() || '';
    howToJoin = last.match(/How to join: (.+?)(?:\s+Organizer: \S+)?$/s)?.[1]?.trim() || '';
  }
  return { text: stripHashtags(paragraphs.join('\n\n')), organizer, howToJoin };
}
