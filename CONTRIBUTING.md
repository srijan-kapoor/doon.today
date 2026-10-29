# Contributing to doon.today

Thanks for helping. Bug fixes and small improvements are welcome as pull requests. For anything bigger, such as a new source or a new page, open an issue first so we can agree on the approach.

**To add an event, don't open a pull request.** Use the form at [doon.today/submit](https://doon.today/submit/); every entry is checked by hand before it is published.

## Setting up

You need Node 22.19 or newer.

```sh
npm ci
npm run dev        # http://localhost:4321
```

## Before you open a pull request

Run the same checks CI runs:

```sh
npm test
npm run check
npm run validate:data
npm run build
```

- Add or update a test for the behavior you change. Tests live in `tests/` and run with `node --test`.
- Keep a pull request to one change, and say in its description what was wrong, what you changed and how you checked it.
- If visitors would notice the change, add a line for it to `src/data/changelog.json` (newest first; tags `New`, `Improved`, `Fixed`, `Source`, `Removed`) and fill in the `Changelog:` line in the pull request template. Write `Changelog: none` for internal changes. The Changelog check fails a pull request that does neither.
- Dates are Dehradun time (IST). A test that depends on the clock or the time zone should fix both: mock the clock with `t.mock.timers`, and run the suite with another time zone too (`TZ=America/Los_Angeles npm test`).

## Files you shouldn't edit

- `data/`: these files are generated and updated automatically several times a day, so a pull request that changes them will almost always conflict. Change the code that produces the data instead.
- `.github/workflows/` and `netlify/`: changes here run with the repository's permissions after merging, so they get a closer review. Explain why they're needed.

## How your pull request is checked

- CI runs the checks above on every pull request. For a first-time contributor, the owner approves the first run.
- Pull requests from forks run with a read-only token and no secrets.

## License

doon.today is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). By opening a pull request you agree that your contribution is licensed under the same terms.
