// Instagram: event announcements from community accounts, as leads for review (never published directly).
//
// Each run collects the Bright Data jobs that have finished since the last run, has Claude read the posts
// not seen before, and starts new jobs for accounts not fetched in about a day. Nothing waits on a job:
// one that is still running is checked again next run. See ingest/lib/instagram.mjs for the bookkeeping.
//
// Needs BRIGHTDATA_API_TOKEN, ANTHROPIC_API_KEY and INSTAGRAM_HANDLES (comma-separated). Without them the
// adapter only sends the candidates it already has, so the queue keeps them. The status file is public,
// so failures name accounts by their key (see accountKey); the reason is in the state file.
import fs from 'node:fs/promises';
import { readJson, writeJson } from '../lib/review.mjs';
import { brightData } from '../lib/brightdata.mjs';
import { posterReader, imageBlock, MODEL } from '../lib/poster-reader.mjs';
import { sameEvent } from '../merge.mjs';
import { istDay } from '../../src/lib/dates.mjs';
import {
  STATE_PATH, PROFILES_DATASET, emptyState, parseHandles, accountKey, profileUrl, accountsToStart, isAbandoned,
  profilePosts, publicError, unseenPosts, rememberSeen, candidateFromReading, addCandidate, upcomingCandidates, rememberCollected
} from '../lib/instagram.mjs';

// A cap on model calls per run (about $0.0003 each). An account with posts left over is fetched again on
// the next run instead of a day later, before the posts drop out of its 12 newest.
const MAX_READS_PER_RUN = 100;
const PARALLEL_READS = 4;

// The options are for tests: a stand-in Bright Data client, model reader and image fetcher.
export async function fetchInstagram({ client, reader, getImage = imageBlock, now = Date.now() } = {}) {
  const checkedAt = new Date(now).toISOString();
  const today = istDay(checkedAt);
  const state = { ...emptyState(), ...(await readJson(STATE_PATH, {})) };
  const handles = parseHandles(process.env.INSTAGRAM_HANDLES);
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const result = (diagnostics) => ({
    source: 'instagram',
    events: [],
    reviewCandidates: upcomingCandidates(state.candidates, today),
    diagnostics
  });
  if (!client && (!token || !process.env.ANTHROPIC_API_KEY)) return result({ configured: false });
  if (!handles.length) return result({ configured: false });

  const bd = client || brightData(token);
  const readPost = reader || posterReader();
  const listed = await readJson('data/events.json', []);
  const wanted = new Set(handles);
  const d = { handles: handles.length, collected: 0, started: 0, abandoned: 0, read: 0, announcements: 0, alreadyListed: 0, readErrors: 0, recoverErrors: 0, skippedForBudget: 0, failedAccounts: [], tokens: { input: 0, output: 0, model: MODEL } };
  let budget = MAX_READS_PER_RUN;
  const accountOf = (handle) => (state.accounts[accountKey(handle)] ||= {});

  async function readOne(post, handle) {
    const image = await getImage(post.imageUrl).catch(() => null);
    const out = await readPost({ handle, postedOn: post.postedOn, caption: post.caption }, image);
    d.read++;
    if (!out) return;
    d.tokens.input += out.usage.input_tokens;
    d.tokens.output += out.usage.output_tokens;
    const candidate = candidateFromReading(out.reading, post, handle, { today, checkedAt });
    // INSTAGRAM_DEBUG=1 prints every reading, for checking the model locally. Not for CI: logs are public.
    if (process.env.INSTAGRAM_DEBUG) console.error(JSON.stringify({ post: post.url, image: Boolean(image), ...out.reading, kept: Boolean(candidate) }));
    if (!candidate) return;
    d.announcements++;
    if (listed.some((e) => sameEvent(e, candidate))) { d.alreadyListed++; return; }
    state.candidates = addCandidate(state.candidates, candidate);
  }

  // Images are downloaded right away: Instagram's image links are signed and stop working within days.
  async function processSnapshot(snapshotId) {
    const records = await bd.download(snapshotId);
    for (const record of Array.isArray(records) ? records : [records]) {
      const { handle, error, posts } = profilePosts(record);
      if (!wanted.has(handle)) continue;
      const account = accountOf(handle);
      const previousFetch = account.lastFetchedAt;
      account.lastFetchedAt = checkedAt;
      if (error) { account.lastError = publicError(error); d.failedAccounts.push(accountKey(handle)); continue; }
      account.lastError = '';
      const unseen = unseenPosts(posts, account.seen, now);
      const fresh = unseen.slice(0, Math.max(budget, 0));
      budget -= fresh.length;
      d.skippedForBudget += unseen.length - fresh.length;
      if (fresh.length < unseen.length) account.lastFetchedAt = previousFetch;
      const done = [];
      for (let i = 0; i < fresh.length; i += PARALLEL_READS) {
        await Promise.all(fresh.slice(i, i + PARALLEL_READS).map(async (post) => {
          try { await readOne(post, handle); done.push(post.id); } catch { d.readErrors++; }
        }));
      }
      // Posts that failed to read stay unseen and are tried again on the next fetch.
      account.seen = rememberSeen(account.seen, done);
    }
    state.collected = rememberCollected(state.collected, snapshotId, now);
    d.collected++;
  }

  // 1. Jobs started by earlier runs.
  for (const handle of handles) {
    const account = accountOf(handle);
    if (!account.snapshot) continue;
    try {
      const status = await bd.status(account.snapshot.id);
      if (status === 'ready') {
        // Cleared only once read: a failed download is retried next run instead of starting a new job.
        await processSnapshot(account.snapshot.id);
        account.snapshot = null;
      } else if (status === 'failed' || status === 'canceled' || isAbandoned(account.snapshot, now)) {
        account.lastError = `job ${account.snapshot.id} ${status === 'failed' || status === 'canceled' ? status : 'abandoned'}`;
        account.snapshot = null;
        d.abandoned++;
      }
    } catch {
      d.failedAccounts.push(accountKey(handle));
    }
  }

  // 2. Finished jobs this state doesn't know about, from a run whose state never got committed.
  let recent = [];
  try { recent = await bd.snapshots(PROFILES_DATASET); } catch (e) { d.listError = publicError(e.message); }
  const known = new Set([...state.collected.map((c) => c.id), ...Object.values(state.accounts).map((a) => a.snapshot?.id)]);
  const since = new Date(now - 24 * 3_600_000).toISOString();
  for (const s of recent) {
    if (s.status !== 'ready' || s.created < since || known.has(s.id)) continue;
    try { await processSnapshot(s.id); } catch { d.recoverErrors++; }
  }

  // 3. New jobs, one per account so a stalled account doesn't hold back the rest.
  for (const handle of accountsToStart(state, handles, now)) {
    try {
      accountOf(handle).snapshot = { id: await bd.trigger(PROFILES_DATASET, [{ url: profileUrl(handle) }]), startedAt: checkedAt };
      d.started++;
    } catch (e) {
      accountOf(handle).lastError = publicError(e.message);
      d.failedAccounts.push(accountKey(handle));
    }
  }

  // Accounts taken off the list are forgotten.
  const keys = new Set(handles.map(accountKey));
  state.accounts = Object.fromEntries(Object.entries(state.accounts).filter(([k]) => keys.has(k)));
  state.candidates = upcomingCandidates(state.candidates, today);
  await fs.mkdir('data', { recursive: true });
  await writeJson(STATE_PATH, state);
  return result(d);
}
