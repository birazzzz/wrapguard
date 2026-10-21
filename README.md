# wrapguard

[![CI](https://github.com/birazzzz/wrapguard/actions/workflows/ci.yml/badge.svg)](https://github.com/birazzzz/wrapguard/actions/workflows/ci.yml)

Catch text that starts wrapping onto more lines, before it ships.

Someone edits a headline, a translation runs longer, a font update shifts a few pixels, and now your hero title takes three lines on phones and a button label breaks in two. Screenshot tests catch that, along with a hundred one-pixel shifts nobody cares about. wrapguard checks one thing: **how many lines each piece of text takes, at each screen width.**

Here is a real run. We lengthened the last sentence of the [fynepdf.com](https://fynepdf.com) hero from "Start free, no signup." to "Start free today, no signup or credit card needed." and ran `wrapguard check`:

```
Checked 1 page at 4 widths, 188 text elements.

/
  main > section > p  "Edit by hand or prompt, review with 15 specialist agents an…"
    768px 1 → 2  ·  390px 2 → 3 lines

Also 1 new, 0 gone, 0 with new copy at the same line count (--verbose lists them).
✗ 1 piece of text now wraps differently on 1 page.
  If that's intended, run: wrapguard update
```

The longer sentence still fits on a laptop, but adds a line on tablets and phones. (The "1 new" is a chat demo further down the page that types its messages on a timer. See [Limits](#limits).)

## How it works

1. wrapguard opens your pages in Chromium (via Playwright) at each width you list.
2. It counts the lines of every heading, paragraph, link, button, label and list item. Icons, hidden text and screen-reader-only text are left out, and each piece of text is counted once.
3. `wrapguard update` saves the counts to `wrapguard.snap.json`. Commit it.
4. `wrapguard check` measures again and fails if any count changed. Copy edits that keep the same line count pass.

The snapshot has one line per element, so a pull request that changes it shows exactly what moved.

## Install

> wrapguard isn't on npm yet. Until the first release, install it from GitHub:

```bash
npm install --save-dev github:birazzzz/wrapguard
```

```bash
npx playwright install chromium
```

It needs Node 20 or newer.

## Quick start

```bash
npx wrapguard init
```

Edit `wrapguard.config.json`:

```json
{
  "baseUrl": "http://localhost:3000",
  "pages": ["/", "/pricing", "/blog/hello-world"],
  "widths": [1440, 1024, 768, 390]
}
```

Start your site, then save the baseline and commit `wrapguard.snap.json`:

```bash
npx wrapguard update
```

From then on, compare against it. The exit code is 1 when any text wraps differently:

```bash
npx wrapguard check
```

## Run it in CI

### GitHub Actions

The wrapguard action checks your pages and comments the result on the pull request. It only posts when something fails, then updates that same comment on later pushes, so a fixed pull request shows ✓ instead of an old failure. The result is in the job summary too.

```yaml
name: wrapguard
on: pull_request

permissions:
  contents: read
  pull-requests: write # lets the action comment

jobs:
  wrapguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Start the site
        run: npm start &
      - name: Wait for it
        run: curl --retry 30 --retry-delay 1 --retry-connrefused -sf http://localhost:3000 > /dev/null
      - uses: birazzzz/wrapguard@main
```

Change `npm start` and the port to whatever serves your built site. The action installs wrapguard and Chromium itself. When a change is intended, run `npx wrapguard update` locally and commit the new snapshot with it.

| Input               | Default               | What it does                                                    |
| ------------------- | --------------------- | --------------------------------------------------------------- |
| `working-directory` | `.`                   | Folder with your config and snapshot.                           |
| `config`            | found automatically   | Config file, relative to `working-directory`.                   |
| `comment`           | `true`                | Comment on the pull request.                                    |
| `fail-on-change`    | `true`                | Fail the job when text wraps differently.                       |
| `strict`            | `false`               | Also fail on new or missing text and pages.                     |
| `github-token`      | `${{ github.token }}` | Token used to comment.                                          |

Outputs: `changed`, `added` and `removed` (counts) and `failed` (`true` or `false`).

Pull requests from forks get a read-only token, so they can't be commented on. Their result is still in the job log and summary. There's no tagged release yet, so `@main` follows the latest code. Pin a commit SHA if you'd rather it didn't change under you.

### Other CI

`npx wrapguard check --markdown` prints the same report as Markdown, for a GitLab merge request note or anything else that takes Markdown. It exits with 1 when text wraps differently.

## Screenshot tests or wrapguard?

|                     | Screenshot tests                                  | wrapguard                                  |
| ------------------- | ------------------------------------------------- | ------------------------------------------ |
| Compares            | Pixels                                            | Line counts per element                    |
| Fails on            | Any visual change, including anti-aliasing and 1px shifts | A piece of text taking more or fewer lines |
| Reviewing a failure | Look at image diffs                               | Read a text diff                           |
| Baseline            | An image per page and width                       | One JSON file                              |
| Catches             | Colours, spacing, images, everything visible      | Text wrapping only                         |

They do different jobs. Keep screenshot tests for visual design and use wrapguard for copy, so editing a sentence doesn't mean reviewing forty screenshots.

## Config

| Option        | Default                  | What it does                                                         |
| ------------- | ------------------------ | -------------------------------------------------------------------- |
| `baseUrl`     | required                 | Where your site runs. Pages are resolved against it.                 |
| `pages`       | required                 | Paths or full URLs to check.                                         |
| `widths`      | `[1440, 1024, 768, 390]` | Viewport widths in CSS pixels.                                       |
| `selector`    | headings, text, links…   | Elements to measure.                                                 |
| `ignore`      | `[]`                     | Selectors to skip, on top of `data-wrapguard-ignore`.                |
| `snapshot`    | `wrapguard.snap.json`    | Where the baseline is saved.                                         |
| `concurrency` | `4`                      | Pages loaded at once.                                                |
| `settle`      | `0`                      | Extra milliseconds to wait after fonts load, for late-rendered text. |

Use `wrapguard.config.js` with `defineConfig` from `wrapguard` if you want types.

## Naming elements

wrapguard names each element by where it sits on the page (`main > section[2] > h1`), using ids when they're stable. For the text you care about most, give it a name that survives refactors:

```html
<h1 data-wrapguard="hero-title">Your PDFs. One AI workspace.</h1>
```

Skip anything that's meant to change, like dates, counters or user names:

```html
<p data-wrapguard-ignore>Last updated 3 minutes ago</p>
```

## Commands

```
wrapguard init              Create wrapguard.config.json
wrapguard update            Scan your pages and save the line counts
wrapguard check             Scan again and fail if any text wraps differently
  --strict                  Also fail on new or missing text and pages
  --verbose                 List new, missing and reworded text too
  --json                    Print the result as JSON
  --markdown                Print the result as Markdown
```

## Limits

- **Chromium only.** Firefox and Safari can break lines in slightly different places.
- **HTML text only.** Text drawn in a canvas, SVG `<text>` and text inside images aren't measured.
- **Clipped text counts the lines it needs, not the lines you see.** With `line-clamp: 2` or a fixed height and `overflow: hidden`, a paragraph that needs 3 lines counts as 3. A change is still caught. Single-line `text-overflow: ellipsis` counts as 1.
- **Only what's on the page when it loads.** Menus, tabs and dialogs aren't opened, and content that loads on scroll isn't reached.
- **Text on a timer** (chat demos, carousels, rotating words) can be there in one run and not the next. It shows up as new or gone, which only fails `check` with `--strict`. Mark it `data-wrapguard-ignore`.
- **No pages behind a sign-in yet.**
- **Names follow page structure.** Moving an element to another section shows as gone and new, not as changed. Give important text a `data-wrapguard` name to avoid that.

## Tips

- **Make the baseline where fonts match.** Web fonts usually measure the same on every system. If your site falls back to system fonts, Windows, macOS and Linux wrap differently, so make the baseline on the same system as CI.
- **Animations** are turned off with `prefers-reduced-motion`. Text that types itself in still needs `settle`.

## Status

Early. Coming next: line limits such as "`h1` max 2 lines", reading pages from your sitemap, and a first npm release.

---

Built by the team at [FynePDF](https://fynepdf.com), because our own pages kept breaking at 390px. MIT licensed.
