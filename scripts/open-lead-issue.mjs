// Opens the review issue for one submit-form entry. Run by .github/workflows/lead-intake.yml, which the
// Netlify function starts with the entry (contact details already removed) in the LEAD input.
import { formLead, leadIssue } from '../ingest/lib/leads.mjs';
import { github } from '../ingest/lib/github.mjs';

const input = JSON.parse(process.env.LEAD || '{}');
// Rebuild the lead from its own fields so only known, cleaned fields reach the issue.
const lead = formLead({
  title: input.title,
  date: String(input.starts || '').slice(0, 10),
  time: String(input.starts || '').slice(11),
  end_time: String(input.ends || '').slice(11),
  venue: input.venue,
  area: input.area,
  price_type: input.price === 'free' ? 'free' : /^\d+$/.test(input.price || '') ? 'paid' : 'unsure',
  price_amount: input.price,
  category: input.categories,
  listing_url: input.listing,
  organizer: input.organizer,
  organizer_link: input.organizerLink,
  submitter: input.submittedBy,
  how_to_join: input.howToJoin,
  repeats: input.repeats,
  description: input.description
});
if (!lead) {
  console.error('The entry has no title or date; no issue opened.');
  process.exit(1);
}
const issue = await github().call('POST', '/issues', leadIssue(lead));
console.log(`Opened #${issue.number}: ${issue.html_url}`);
