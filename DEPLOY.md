# Deploying doon.today from a phone

The application is intentionally static-first. Netlify builds the Astro site from GitHub; GitHub Actions refreshes event data every 8 hours and commits changes back to `main`, which triggers a new Netlify deployment.

## 1. Confirm GitHub Actions

Open the repository **Actions** tab. The `Refresh events` workflow should appear.

Run it once manually with **Run workflow**. It will:

- fetch every source except District, which blocks GitHub's runners (see [docs/primary-sources.md](docs/primary-sources.md));
- normalize and geofilter the results;
- keep Reddit-only event candidates in `data/review/reddit.json`;
- validate and build the site;
- commit `data/` only when the published snapshot changed.

The schedule is `00:30`, `08:30`, `16:30` UTC, corresponding to approximately **06:00, 14:00, 22:00 IST**.

## 2. Connect Netlify

1. In Netlify choose **Add new project → Import an existing project → GitHub**.
2. Select `srijan-kapoor/doon.today`.
3. Netlify should read `netlify.toml` automatically.
4. Deploy. Build command: `npm run build`; publish directory: `dist`.

No runtime environment variables are required.

## 3. Add domains

In Netlify **Domain management**:

- add `doon.today` as the primary domain;
- add `dehradun.today` as a domain alias.

Then follow the DNS values Netlify provides in Namecheap. The checked-in `_redirects` file permanently redirects any request on `dehradun.today` to the same path on `doon.today` once both domains point to this Netlify site.

## 4. First production verification

Check:

- `/`
- `/calendars`
- `/calendar.ics`
- an `/events/<slug>/` page
- mobile layout
- source links
- `https://dehradun.today/...` redirects to `https://doon.today/...`

If the first refresh job finds zero current events, it intentionally fails rather than publishing an empty dataset. Inspect `data/ingest-status.json` and the Actions logs before changing source adapters.
