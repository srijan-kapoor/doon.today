// The feedback form: one Netlify Form on every page, opened from "Feedback" links and from an event's
// "Report a problem". Messages stay in Netlify Forms (and its email notification); nothing is public.
const FEEDBACK_FORM = 'feedback';
const VOTES = ['like', 'dislike'];

/** What a "Report a problem" link on an event page tells the form: the event's title and id. */
export const eventAbout = (event) => `${event.title} (${event.id})`;

/** A message is worth sending with a vote, some text, or both; the honeypot must stay empty. */
export function feedbackProblem({ vote = '', message = '', 'bot-field': trap = '' } = {}) {
  if (trap) return 'spam';
  if (vote && !VOTES.includes(vote)) return 'unknown vote';
  return vote || message.trim() ? '' : 'Pick 👍 or 👎, or write a few words.';
}

/** The urlencoded body Netlify Forms expects, form name first. */
export function feedbackBody(fields) {
  const params = new URLSearchParams({ 'form-name': FEEDBACK_FORM });
  for (const [name, value] of Object.entries(fields)) if (name !== 'form-name') params.append(name, String(value ?? ''));
  return params.toString();
}
