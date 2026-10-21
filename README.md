# wrapguard

Catch text that starts wrapping onto more lines, before it ships.

Someone edits a headline, a translation runs 30% longer, a font update shifts a few pixels, and now your hero title takes three lines on phones and a button label breaks in two. Screenshot tests catch that, along with a hundred one-pixel shifts nobody cares about. wrapguard checks one thing: **how many lines each piece of text takes, at each screen width.**

```
/pricing
  main > section[2] > h1  "Simple pricing for every team"
    390px 2 → 3 lines
  main > section[3] > a  "Start free trial"
    768px 1 → 2 lines

✗ 2 pieces of text now wrap differently on 1 page.
  If that's intended, run: wrapguard update
```

## How it works

1. wrapguard opens your pages in Chromium (via Playwright) at each width you list.
2. It counts the lines of every heading, paragraph, link, button, label and list item. Icons, hidden text and screen-reader-only text are left out, and each piece of text is counted once.
3. `wrapguard update` saves the counts to `wrapguard.snap.json`. Commit it.
4. `wrapguard check` measures again and fails if any count changed. Copy edits that keep the same line count pass.

The snapshot has one line per element, so a pull request that changes it shows exactly what moved.

## Quick start

```bash
npm install --save-dev wrapguard
npx playwright install chromium
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

Start your site, then:

```bash
npx wrapguard update   # save the baseline
npx wrapguard check    # compare against it (exit code 1 on changes)
```

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
```

## Tips

- **Make the baseline where fonts match.** Web fonts measure the same everywhere. If your site falls back to system fonts, Windows, macOS and Linux will wrap differently, so make the baseline in CI.
- **Animations** are turned off with `prefers-reduced-motion`. Text that types itself in still needs `settle`.

## Status

Early. Coming next: a GitHub Action that comments the changes on your pull request, line limits such as "`h1` max 2 lines", and reading pages from your sitemap.

---

Built by the team at [FynePDF](https://fynepdf.com), because our own pages kept breaking at 390px. MIT licensed.
