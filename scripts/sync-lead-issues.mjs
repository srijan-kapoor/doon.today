// Keeps the GitHub review queue in step with data/review/: opens an issue for each queued lead (a Reddit post
// or a held-back listing) waiting for
// review, and closes the issue of any lead already decided with `npm run review`. Run by the refresh
// workflow after it commits the data.
import { readJson, QUEUE_PATH, DECISIONS_PATH, pendingCandidates } from '../ingest/lib/review.mjs';
import { LEAD_LABEL, isQueuedKind, leadIssue, leadMarker, sourceLead } from '../ingest/lib/leads.mjs';
import { github } from '../ingest/lib/github.mjs';

const gh = github();
const queue = await readJson(QUEUE_PATH, []);
const decisions = await readJson(DECISIONS_PATH, {});

// Matched by the hidden marker, closed issues included, so a lead rejected on GitHub is not reopened.
const issues = await gh.issuesWithLabel(LEAD_LABEL);
const byLead = new Map();
for (const issue of issues) {
  const marker = leadMarker(issue.body);
  if (isQueuedKind(marker?.kind) && marker.id) byLead.set(marker.id, issue);
}

let opened = 0;
for (const candidate of pendingCandidates(queue, decisions)) {
  if (byLead.has(candidate.id)) continue;
  const issue = await gh.openIssue(leadIssue(sourceLead(candidate), { assignee: process.env.GITHUB_REPOSITORY_OWNER }));
  opened++;
  console.log(`Opened #${issue.number} for ${candidate.id}`);
}

let closed = 0;
for (const [id, issue] of byLead) {
  const decision = decisions[id]?.decision;
  if (issue.state !== 'open' || !decision) continue;
  await gh.comment(issue.number, `Already ${decision} with \`npm run review\`, so this issue is closed.`);
  await gh.close(issue.number, decision === 'approved' ? 'completed' : 'not_planned');
  closed++;
}
console.log(`Review queue: ${opened} issue(s) opened, ${closed} closed.`);
