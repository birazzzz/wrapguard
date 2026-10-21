# Releasing

Releases go out from GitHub, not from a laptop. Publishing a GitHub release runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which tests the code, stages the version on npm through **trusted publishing** (no npm token anywhere), and moves the major tag (`v0`) that people use in `uses: birazzzz/wrapguard@v0`. A maintainer then approves the staged version on npmjs.com.

## Each release

1. **Bump the version** in a pull request and merge it once CI is green:

   ```bash
   npm version 0.2.0 --no-git-tag-version
   ```

   Use a patch version (0.1.1) for fixes, a minor version (0.2.0) for new features or output changes.

2. **Publish a GitHub release.** Releases → Draft a new release:
   - Tag: `v0.2.0` (the same version, with a `v`), "Create new tag on publish", target `main`
   - Title: `v0.2.0`
   - Click **Generate release notes**, add a short summary on top
   - Publish

3. **Wait for the Release workflow** (Actions tab, about 2 minutes). It stops if the tag and `package.json` disagree, or if a test fails, before anything reaches npm.

4. **Approve it on npm.** npmjs.com → your avatar → Staged Packages → wrapguard → Approve, with your two-factor login. The version is installable a few minutes later:

   ```bash
   npm view wrapguard version
   ```

If you reject a staged version, delete the GitHub release and its tag, fix, and release again with the next patch version. npm never reuses a version number.

To test the pipeline without publishing, run the workflow by hand (Actions → Release → Run workflow). It runs the tests and builds the package with `npm pack --dry-run`, listing the files that would be published.

## One-time setup for a package

Trusted publishing is set per package, and the package has to exist first.

1. **First version from your computer.** `npm login`, then `npm publish` from a clean `main`. A brand-new package goes through npm's processing and may need approval under Staged Packages.
2. **Add the trusted publisher.** npmjs.com → Packages → the package → Settings → Trusted publishing → GitHub Actions:
   - Organization or user: `birazzzz`
   - Repository: `wrapguard`
   - Workflow filename: `release.yml`
   - Environment name: leave empty
   - Allowed actions: staging only (CI stages, a person approves)
3. **After the first release through the workflow works**, lock the package to it: Settings → Publishing access → "Require two-factor authentication and disallow tokens". Trusted publishing keeps working; tokens stop.

## Launching another open-source package

wrapguard is the template. For the next one, copy and adjust:

- **package.json:** `name`, `description`, `keywords`, `repository.url` exactly matching the GitHub repo (trusted publishing checks it), `homepage`, `bugs`, `author: "FynePDF (https://fynepdf.com)"`, `license`, `files: ["dist"]`, `bin`, `engines`, and `"prepare": "tsc -p tsconfig.build.json"` so installs from GitHub build too.
- **`.gitattributes`** with `* text=auto eol=lf`, so a CLI's shebang works on macOS and Linux when released from Windows.
- **`.github/workflows/ci.yml`** (tests on Linux, Node 22 and 24) and **`.github/workflows/release.yml`** as they are, changing only names.
- **README:** a real demo at the top (`docs/demo.mjs` builds an animated terminal SVG from real output), how it works, install, quick start, CI usage, an honest comparison with the usual alternative, limits, and the closing line crediting FynePDF. Badges: npm version and CI.
- **GitHub About box:** description, website, and topics.
- **The first release** by hand (above), then trusted publishing for every release after.
- **On fynepdf.com:** a mention on `/developers` and a line under Developers in `llms.txt`, so links to the project land on the FynePDF domain.
