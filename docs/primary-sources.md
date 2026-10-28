# Primary source (District)

District returns `403 Forbidden` to GitHub-hosted runners. See
[bug-report-primary-sources-403.md](bug-report-primary-sources-403.md) for the original evidence. This project does
not spoof a browser, solve CAPTCHAs or use stealth tooling, so request headers are not the lever. Where the
block is on datacenter IPs, the fix is to fetch from a machine on a normal connection.

| Source | GitHub-hosted runner | Home/ISP connection | Status |
| --- | --- | --- | --- |
| District | `403` | `200`, 12 candidate events parsed (18 Oct 2026) | primary; fetched by the self-hosted runner or local script, below |

**BookMyShow was removed** on 28 Oct 2026. Cloudflare rejected plain HTTP clients even from a residential IP, so
moving the job did not help, and AllEvents already carries its Dehradun listings.

| Job | Where it runs | Sources |
| --- | --- | --- |
| `Refresh events` (`refresh-events.yml`) | GitHub-hosted `ubuntu-24.04` | everything except District (`INGEST_SKIP`) |
| `Refresh primary sources` (`refresh-primary.yml`) | self-hosted runner labelled `doon-primary` | District only (`INGEST_ONLY`) |

Both jobs share one concurrency group, so they never commit at the same time. Each job only updates the
sources it ran and keeps the other sources' entries in `data/ingest-status.json`.

## Option A: self-hosted runner

1. Repo **Settings → Actions → Runners → New self-hosted runner**, pick your OS, and run the commands
   GitHub shows. When `./config.sh` asks for extra labels, enter `doon-primary`.
2. Install it as a service so it survives restarts: `./svc.sh install && ./svc.sh start` (macOS and Linux).
3. Needs Node 22+ (`.nvmrc`) and git on that machine. The machine has to be on around 05:37, 13:37 and
   21:37 IST; a job queued while the runner is offline waits, blocks the hosted refresh behind it, and is dropped after 24 hours.
4. Trigger it once from **Actions → Refresh primary sources → Run workflow** and check the log.
5. Then restore the `schedule:` block in `.github/workflows/refresh-primary.yml` (the commented lines near the top).
   It is off while no runner is registered, because a scheduled run nobody picks up holds the shared
   concurrency group and blocks every hosted refresh behind it (this happened on 18 Oct 2026).

**Security.** The repository is public and a self-hosted runner runs workflow code on your machine.
`refresh-primary.yml` only has `workflow_dispatch` (and, once enabled, `schedule`) triggers, which fork contributors cannot
fire. Do not add `pull_request`, `pull_request_target` or `issue_comment` triggers to it. In **Settings →
Actions → General**, set "Fork pull request workflows" to require approval for all outside collaborators.

## Option B: cron or launchd on your own machine

`scripts/refresh-primary-local.sh` does the same job with your own git credentials: pull, test, fetch
District, validate, commit `data/`, push. Try it first with `DRY_RUN=1`. Example crontab
(times are local; this one assumes the machine is on IST):

```
37 5,13,21 * * * cd /path/to/doon.today && ./scripts/refresh-primary-local.sh >> ~/doon-primary.log 2>&1
```

## Detecting trouble

- `data/ingest-status.json` records `lastAttemptAt`, `lastSuccessAt` and `consecutiveFailures` per source,
  plus `primarySources` with each primary source's age and whether it counts as fresh (36h by default,
  `PRIMARY_MAX_AGE_HOURS`).
- The home page banner names the stale source and when it last refreshed. Readers can dismiss it; it returns if a different set of sources is affected.
- The last step of `Refresh events` runs `npm run check:health`. It fails the run when a primary source that
  has refreshed before has gone 48h without a success (`HEALTH_MAX_AGE_HOURS`), and GitHub emails you about a
  failed scheduled workflow. A primary source that has never succeeded only raises a warning
  annotation, so it does not keep every run red.
- A `200` response that yields no events (a challenge page, changed markup) is recorded as a failure, not
  as `ok`.

## Running a single source locally

```
INGEST_ONLY=district npm run ingest      # only this source
INGEST_SKIP=district npm run ingest      # everything else
```
