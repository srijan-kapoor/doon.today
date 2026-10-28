# Bug report for Claude: District and BookMyShow HTTP 403 in GitHub Actions

> **Resolved (28 Oct 2026).** District is fetched from a normal connection instead of GitHub's runners: see [primary-sources.md](primary-sources.md). BookMyShow was removed as a source. This report is kept for the evidence.

## Impact and current evidence (18 Oct 2026)

The scheduled `Refresh events` workflow completes, but both primary source adapters fail at their **first listing request**, before parsing. `data/ingest-status.json` records `health: "degraded"`. The published dataset retains two older District-sourced records; it has zero BookMyShow-sourced records. Those are not evidence of a successful current District fetch.

| Source | First request | GitHub Actions result | Response metadata |
|---|---|---|---|
| District | `https://www.district.in/events/upcoming-events-in-dehradun` | `403 Forbidden` | `content-type: text/html`; no `server`, `x-cache` or `retry-after` reported |
| BookMyShow | `https://in.bookmyshow.com/explore/events-dehradun` | `403 Forbidden` | `content-type: text/html; charset=UTF-8`; `server: cloudflare`; no `retry-after` |

Latest recorded run at `2026-10-18T07:20:56.600Z`: [`data/ingest-status.json`](../data/ingest-status.json). Workflow run: https://github.com/srijan-kapoor/doon.today/actions/runs/39107312760 .

The same District URL responded `200` from a Mac network, where `fetchDistrict()` parsed 12 candidate events. A full local ingest at `2026-10-18T07:29:44.344Z` likewise recorded `district: ok, events: 12`, while BookMyShow remained `403` with `server: cloudflare`. A plain Mac `curl` request to BookMyShow also returned `403`, although its page rendered in a browser. Thus the evidence supports an environment/request-dependent access restriction, **not** a proven parser failure. We have not established whether District uses the same protection mechanism as BookMyShow.

## Code path and reproduction

Workflow: [`.github/workflows/refresh-events.yml`](../.github/workflows/refresh-events.yml) runs on `ubuntu-latest`, Node 22, and invokes `npm run ingest`. Schedule is unchanged: `30 0,8,16 * * *` UTC (06:00/14:00/22:00 IST). It can also be run manually with `workflow_dispatch`.

`ingest/run.mjs` calls `fetchDistrict()` then `fetchBookMyShow()`. Both call `fetchText()` in `ingest/lib/http.mjs`. That helper uses Node's global `fetch`, a static `User-Agent` (`Mozilla/5.0 (compatible; doon.today/0.1; +https://doon.today/about)`), `Accept-Language: en-IN,en;q=0.9`, a 20-second timeout, and follows redirects. On non-2xx it throws with HTTP status and safe response metadata. District's first call is in `ingest/sources/district.mjs:14`; BookMyShow's is in `ingest/sources/bookmyshow.mjs:22`. No HTML parser has run at the failure point.

Reproduce by manually dispatching the Refresh events workflow on `main`, then inspect the `Fetch and normalize events` step and committed `data/ingest-status.json`. A focused runner experiment can call the two listing URLs with `curl -i -L` and Node `fetch` using the current headers, recording status, final URL, selected response headers, and a **redacted** first 500 bytes of the response body. Do not log cookies, tokens, or full challenge pages.

## Questions to investigate

1. Is the response different across GitHub-hosted runner IPs, residential Mac networks, and a permitted hosted runtime? Record status, final URL, headers, response body signature, and timestamp for each.
2. Does District's 403 originate from a CDN/WAF, application-level policy, geographic restriction, or a changed endpoint? Do not infer its cause from BookMyShow's Cloudflare header.
3. Does BookMyShow offer a documented API, partner feed, calendar, or organizer-level source with permitted automated access? Can District provide an approved feed or allowlist?
4. Is a `200` response actually parseable? Run adapter contract tests against real responses; a `200` challenge page must not count as success.
5. What is the compliant, sustainable fallback if automation is disallowed (organizer feeds, manual curation, or alternate primary sources)? Avoid CAPTCHA solving, stealth browser/fingerprint evasion, residential proxies, or scraped private APIs without permission.

## Acceptance criteria

- Each provider returns real, future Dehradun events from a permitted endpoint in the **GitHub Actions** environment, with a fresh `checkedAt`, or is explicitly marked unavailable with an approved fallback.
- The workflow test, ingest, validation, build, and data commit all pass; status does not mark a blocked/challenge response as `ok`.
- Confirm at least one newly fetched source record on `doon.today` and compare it to its source page. Do not treat retained historical records as proof of a fixed feed.
- Preserve the existing eight-hour schedule and avoid changes outside `srijan-kapoor/doon.today`.
