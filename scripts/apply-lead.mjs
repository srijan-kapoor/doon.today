// Acts on a review decision made on GitHub. Run by .github/workflows/review-lead.yml:
//
//   node scripts/apply-lead.mjs approve   the "approve" label was added: publish the event, then close
//   node scripts/apply-lead.mjs reject    the issue was closed without it: remember the Reddit post
//
// The issue comes from the workflow's event file, never from the command line, because its text is
// written by the public.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readJson, writeJson, approve, reject, QUEUE_PATH, DECISIONS_PATH, CURATED_PATH } from '../ingest/lib/review.mjs';
import { APPROVE_LABEL, isQueuedKind, leadKey, leadMarker, leadSourceUrl, leadToEvent, parseLeadIssue, cleanLine } from '../ingest/lib/leads.mjs';
import { mergeAndWrite } from '../ingest/merge.mjs';
import { github } from '../ingest/lib/github.mjs';
import { sleep } from '../ingest/lib/utils.mjs';

const mode = process.argv[2];
const { issue } = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const gh = github();
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

async function commitAndPush(message) {
  git('add', 'data/');
  git('commit', '-m', message);
  for (let attempt = 1; ; attempt++) {
    try {
      git('pull', '--rebase', 'origin', 'main');
      git('push', 'origin', 'HEAD:main');
      return;
    } catch (error) {
      if (attempt >= 3) throw new Error('could not push the change to main');
      await sleep(5000 * attempt);
    }
  }
}

const marker = leadMarker(issue.body);
if (!marker) {
  console.log(`#${issue.number} has no lead marker; nothing to do.`);
  process.exit(0);
}
const decisions = await readJson(DECISIONS_PATH, {});

if (mode === 'reject') {
  // Only queued leads (Reddit posts, held-back listings) need remembering; a closed form entry simply
  // never gets published.
  const key = isQueuedKind(marker.kind) ? marker.id : null;
  if (!key || decisions[key]) process.exit(0);
  const curated = await readJson(CURATED_PATH, []);
  const queued = (await readJson(QUEUE_PATH, [])).find((c) => c.id === key);
  const url = leadSourceUrl(parseLeadIssue(issue.body), queued);
  const next = reject({ decisions, curated }, { id: key, title: cleanLine(issue.title), sources: url ? [{ url }] : [] }, `closed on GitHub (#${issue.number})`);
  await writeJson(DECISIONS_PATH, next.decisions);
  // A rejected listing that is already on the site comes off it on this rebuild.
  if (marker.kind === 'listing') await mergeAndWrite([]);
  await commitAndPush(`data: reject lead #${issue.number}`);
  console.log(`Recorded the rejection of ${key}.`);
  process.exit(0);
}

if (mode !== 'approve') throw new Error(`Unknown mode: ${mode}`);
let published = null;
try {
  const parsed = parseLeadIssue(issue.body);
  if (!parsed) throw new Error('the "Event details" block is missing or its ```text fence was changed');
  const key = leadKey(parsed, issue.number);
  if (decisions[key]) throw new Error(`this lead was already ${decisions[key].decision}`);
  const queue = await readJson(QUEUE_PATH, []);
  const candidate = isQueuedKind(parsed.kind) ? queue.find((c) => c.id === parsed.id) : undefined;
  const event = leadToEvent(parsed, { issueUrl: issue.html_url, candidate });

  const curated = await readJson(CURATED_PATH, []);
  const next = approve({ decisions, curated }, { id: key, title: event.title }, event);
  await writeJson(DECISIONS_PATH, next.decisions);
  await writeJson(CURATED_PATH, next.curated);
  await mergeAndWrite([]);
  execFileSync('node', ['scripts/validate-data.mjs'], { stdio: 'inherit' });
  await commitAndPush(`data: publish lead #${issue.number}`);
  published = event;
} catch (error) {
  // Nothing was pushed: leave the issue open with the reason, and take the label off so adding it again retries.
  try { git('checkout', '--', 'data/'); } catch {}
  const reason = cleanLine(error.message, 400);
  try {
    await gh.comment(issue.number, `Couldn't publish this: \`${reason}\`. Fix the details in the issue, then add the \`${APPROVE_LABEL}\` label again.`);
    await gh.removeLabel(issue.number, APPROVE_LABEL);
  } catch (apiError) {
    console.error(`Could not report on the issue: ${apiError.message}`);
  }
  console.error(reason);
  process.exit(1);
}

// The event is on main by now, so a failure here only affects the issue, not what is published.
await gh.comment(issue.number, `Published as https://doon.today/events/${published.slug}/ — it goes live when Netlify finishes the deploy.`);
await gh.close(issue.number, 'completed');
console.log(`Published ${published.id} from #${issue.number}.`);
