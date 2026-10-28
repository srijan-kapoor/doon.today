# doon.today

A text-first calendar of things happening in Dehradun, live at [doon.today](https://doon.today). It answers one question: **what can I do in Dehradun today or this weekend?**

The project is inspired by [blr.today](https://blr.today)'s calendar-first approach: a quiet page, honest labels about where each event came from, and calendar feeds you can subscribe to. It is not a ticket marketplace and has no accounts.

## What the site has

- A day-by-day event list with date, category, price and area filters. The selection lives in the URL, so a filtered view can be shared.
- An event page for each event with the source, when it was last checked, an "Add to calendar" file, a Google Calendar link and a "Report a problem" link.
- Calendar feeds under `/calendars`: everything, verified-only, free, one per category and one per source. `/calendar.ics` is the full feed.
- Open Graph tags and `Event` structured data, so shared links preview properly and search engines can read the events.
- A banner when the main source (District) has not refreshed recently. Readers can dismiss it; it returns if a different set of sources is affected.

## Quick start

You need Node 22.19 or newer (`.nvmrc` says 22).

```sh
npm ci
npm run dev        # http://localhost:4321
npm test           # unit tests (node --test)
npm run check      # astro check (types)
npm run build      # static site into dist/
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run ingest` | Fetch every source and rewrite `data/` (needs network) |
| `npm run ingest:primary` | Fetch District only |
| `npm run validate:data` | Check `data/events.json` for missing fields, duplicates and events outside Dehradun |
| `npm run review` | Go through community leads: approve one to publish it as a hand-checked event, or reject it for good (or use the GitHub issues, below) |
| `npm run check:health` | Fail if District has gone too long without a successful refresh |

`INGEST_ONLY=name1,name2` and `INGEST_SKIP=name1,name2` choose which sources `npm run ingest` runs.

## How the data flows

```
sources ──> ingest/sources/*.mjs ──> ingest/merge.mjs ──> data/events.json ──> Astro build ──> Netlify
 (adapters, one per source)   (match, merge, age out)   data/ingest-status.json
```

- **Adapters** (`ingest/sources/`) read one source each, mostly from the JSON-LD `Event` data on its pages. They fail closed: a page that loads but yields no events is recorded as a failure, not as a healthy empty fetch.
- **Merge** (`ingest/merge.mjs`) keeps only Dehradun events, merges the same event from several sources, keeps each event's id stable when its source moves it, and drops an event after three successful runs of its sources without it. It also fills in the neighbourhood from the address.
- **Status** (`data/ingest-status.json`) records, per source, the last attempt, the last success and the failure count. The site and the health check read it.
- **Static data** means the site has no server: every page is built from `data/` and deployed on each push to `main`.

Every event carries its sources, a verification status and when it was first seen, last seen and last checked. `verified` means a ticketing platform or the organizer lists it; `review` means only an aggregator (AllEvents) does and the site labels it "Source reported". Reddit posts never publish on their own; they go to `data/review/reddit.json`.

## Sources

| Source | Role | Status |
| --- | --- | --- |
| District | Main source, verified | Works from a home connection; blocks GitHub-hosted runners |
| Virasat, Thrill Zone, Dehradun Literature Festival, Meetup | Ticketing and organizer pages, verified | Fetched by the hosted refresh |
| Google Developer Groups | GDG Dehradun and the UPES and Graphic Era campus chapters, from the platform's public JSON API; verified | Fetched by the hosted refresh |
| AllEvents | Aggregator, labelled "Source reported" | Fetched by the hosted refresh |
| r/Dehradun | Community leads for review | Fetched by the hosted refresh; never published directly |

Removed on 28 Oct 2026: Townscript (its listings went behind a sign-in and it returned no events) and BookMyShow (Cloudflare blocked it from every connection tried, and AllEvents already carries its Dehradun listings).

How District is fetched, and why not from GitHub's runners, is in [docs/primary-sources.md](docs/primary-sources.md).

## How events are chosen

- The sources above are read about three times a day. District is fetched from a home connection because it refuses cloud servers, so it can lag when that machine is off. When a source is behind, the home page says so.
- An event is kept when its venue, address or title points to Dehradun. Events that name other cities are dropped.
- The same event from two sources is merged into one, keeping every source on the page.
- Categories are guessed from the title and description with simple keyword rules, so some are wrong.
- An event its sources stop listing is removed after a few refreshes.

Doon.today is not affiliated with any of the sources it reads.

## Reviewing community leads

Posts on r/Dehradun that look like events are never published on their own. They wait in `data/review/reddit.json`. To work through them, run `npm run review` on `main`; `npm run review -- --list` only shows them.

- **Approve** asks you to confirm the title, start time (IST), venue, price and categories, then publishes the event as verified. It is saved in `data/curated-events.json` and stays on the site until its date passes, whatever the sources say.
- **Reject** remembers the post, so it does not come back.
- Both choices are recorded in `data/review/decisions.json`, and `data/events.json` is rebuilt straight away. The script can commit and push to `main` for you; nothing is live until that push deploys.

### The review queue on GitHub

Every lead also gets a GitHub issue labelled `lead`, so you're notified when something is waiting:

- **Submit form** (`/submit/`): Netlify verifies the entry and runs `netlify/functions/lead-intake.mjs`, which starts the "Open lead issue" workflow. That workflow opens the issue as github-actions[bot]. Contact details stay in Netlify Forms; issues and workflow inputs are public.
- **r/Dehradun**: after each refresh, `scripts/sync-lead-issues.mjs` opens an issue for each new lead, and closes issues for leads already decided with `npm run review`.

To review on GitHub, edit the "Event details" block in the issue if anything is wrong, then:

- add the `approve` label to publish it (the "Review lead" workflow writes `data/curated-events.json`, pushes to `main` and closes the issue), or
- close the issue to reject it. A rejected Reddit post is remembered; a form entry simply isn't published.

If a detail can't be read, the workflow comments with the reason, removes the label and leaves the issue open. Only the repo owner's label or close counts.

Setup, once: create the `lead` and `approve` labels; enable form detection in Netlify; and set `DOON_GITHUB_TOKEN` in Netlify's production environment to a fine-grained token for this repo with only "Actions: read and write". Without the token, entries still arrive in Netlify Forms but no issue is opened.

## Refresh jobs

Event data is refreshed three times a day, scheduled for about 05:47, 13:47 and 21:47 IST. GitHub starts scheduled runs when it has capacity, so a run can start minutes to a few hours late; a manual run (Actions, Refresh events, Run workflow) always starts at once.

- **Refresh events** (`.github/workflows/refresh-events.yml`) runs on a GitHub-hosted runner: tests, every source except District, validation, build, then commits `data/` when it changed.
- **District** is fetched shortly before the hosted refresh from a normal home connection, either by `scripts/refresh-primary-local.sh` (cron or launchd on your own machine) or by the self-hosted runner workflow `.github/workflows/refresh-primary.yml`. Setup, and the security notes for a self-hosted runner on a public repo, are in [docs/primary-sources.md](docs/primary-sources.md).

Both jobs share one concurrency group so they never commit at the same time.

## Health and alerts

A source counts as fresh for 36 hours after its last success (`PRIMARY_MAX_AGE_HOURS`). The last step of the hosted refresh runs `npm run check:health`, which turns the run red, and so sends GitHub's failure email, when District has gone 48 hours without a success (`HEALTH_MAX_AGE_HOURS`). A source that has never succeeded only produces a warning.

## Project layout

```
ingest/          adapters, merge and source-status logic
data/            events.json, ingest-status.json, review/reddit.json (committed)
src/pages/       pages, per-event and per-feed .ics endpoints
src/lib/         calendar (ics), feeds, sharing metadata, report links
src/components/  event row
scripts/         validation, health check, local District refresh
tests/           node:test suites and fixtures
docs/            notes on primary sources
```

## Reporting problems and contributing

Every event page has a "Report a problem" link that opens a prefilled GitHub issue. To suggest a missing event, [open an issue](https://github.com/srijan-kapoor/doon.today/issues/new). Pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). CI (`.github/workflows/ci.yml`) runs the tests, type check, data validation and build on every pull request.

## License

AGPL-3.0-or-later, matching the licensing approach of the blr.today website. See [LICENSE](LICENSE).
