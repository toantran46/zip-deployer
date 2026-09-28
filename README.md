<div align="center">
  <h1>Zip Deployer</h1>
  <p><em>From commit to deploy package.</em></p>
  <p>
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-006341">
    <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-006341">
    <img alt="Node 18+" src="https://img.shields.io/badge/node-%E2%89%A518-006341">
    <img alt="Dependencies: 0" src="https://img.shields.io/badge/dependencies-0-006341">
    <a href="https://github.com/toantran46/zip-deployer/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/toantran46/zip-deployer?style=flat&color=006341"></a>
  </p>
  <sub>English · <a href="README.vi.md">Tiếng Việt</a></sub>
</div>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/screenshot-dark.png">
  <img src="docs/images/screenshot-light.png" alt="Zip Deployer previewing a staging package">
</picture>

Zip Deployer packages only the files that changed between two Git refs into a ZIP you can upload to hosting without CI, such as shared hosting behind cPanel or FTP. It runs on your own Windows machine, reads file content straight from Git and checks the finished ZIP file by file before you upload anything.

## How it works

1. **Git.** You pick the version live on the host (Base) and the version to ship (Target). The app diffs the two commits.
2. **Review.** Every changed path is checked against the safety rules and your `.zipignore`. You see added, modified and deleted files with line counts before anything is built.
3. **Package.** File content comes from the Git blobs of the Target commit, so uncommitted edits and later commits never slip in.
4. **Verify.** The ZIP is read back and each entry's SHA-256 and size are compared with the commit. Any mismatch fails the build.

## Quick start

Requirements: Windows, Node.js 18 or newer, Git and Windows PowerShell on `PATH`. No `npm install`.

1. Double-click `start.cmd`. The app starts hidden on `127.0.0.1` on a free port and opens your browser.
2. Click **Stop app** when you are done. Closing the tab does not stop the server; running `start.cmd` again reopens the running session.

The UI is in English by default. The header has a **VI | EN** language switch and a **System | Light | Dark** theme switch (System follows Windows). Both choices are remembered in the browser.

## Usage

1. Choose **Staging** or **Production**. Production shows an amber warning banner.
2. Pick the repository: type its path, or click **Browse…** to open the Windows folder dialog.
3. Fill in **Base** (the tag or commit running on the host) and **Target** (the branch, tag or commit to ship). Both fields suggest local branches, remote branches and tags as you type, so `release/` lists every release branch. Refs must already exist locally; the app never fetches. For production, also enter a new tag.
4. Click **Preview changes**. Review the counts, then the file list: the **All / Modified / Added / Deleted** tabs filter it and each file shows its added and removed line counts. Blocked files are listed above the list, and deleted paths must be acknowledged before building.
5. Click **Build ZIP**, then **Open output folder**, and upload the ZIP to the hosting root with your usual process. Paths inside the ZIP start at the repository root. Back up the host before replacing files.
6. Optional for production: open **Create & push production tag**, confirm, then click the button. The tool never overwrites a tag and pushes only that tag to `origin`, using your existing Git credentials.

## Output

Each build gets its own folder under `output/`, named `{environment}-{label}-{YYYYMMDD-HHmm}` in local time, for example `output/prod-1.44.0-20260929-1430/` or `output/staging-release-1.44.0-rc-20260929-1015/`. The label is the production tag, or the Target for staging. If the name is taken, `-2`, `-3` and so on is added, so an existing build is never overwritten.

| File | Contents |
|---|---|
| `deploy-*.zip` | The file to upload. No wrapping folder; every entry uses `/`. |
| `deploy-files.txt` | Files included in the ZIP. |
| `deleted-files.txt` | Paths to check or remove on the host yourself, including old paths of renamed files. |
| `manifest.json` | Base and Target commits, SHA-256 and size of every file. |
| `verification.json` | Hashes read back from the ZIP. |
| `files/` | Intermediate content extracted from Git. |

The whole folder can be deleted after upload.

## Deploy history

**Deploy history** lists the 50 most recent builds from `output/*/manifest.json`: environment, tag or Target, commit range, file counts, ZIP size and time. **Open folder** opens that build in Explorer. Deleting a folder under `output/` removes it from history. Folders without a readable manifest are skipped, and builds from older versions with random folder names still appear.

## .zipignore

Commit a `.zipignore` at the repository root to keep extra paths out of the ZIP. It is read from the **Target commit**, not from your working tree, so uncommitted edits to it have no effect. The **.zipignore** header button shows the built-in exclusions and the rules found in the last preview.

- One pattern per line, matched from the repository root and case-insensitive. A pattern matches a file or a whole folder (`build` and `/build/` both exclude `build/…`).
- `*` matches within one path segment and `**` matches across segments (`assets/*.map`, `**/*.log`).
- Blank lines and lines starting with `#` are ignored. Lines starting with `!` are shown but ignored: `.zipignore` can only add exclusions.
- Matching paths are listed as not packaged in the preview, and `.zipignore` itself is never packaged.

## Safety rules

The app blocks `wp-config.php`, `.env*`, uploads, cccd, `error_log`, SQL and ZIP files, private keys, symlinks, submodules and paths that are unsafe on Windows. The root folders `docs`, `tools`, `tests`, `.agents`, `.claude`, `.codex`, `.github`, `node_modules` and `.deploy-temp`, plus agent instruction files, are listed separately as not packaged. The rules are path-based: **this is not a secret scanner for file contents.** To ship a blocked path, change the policy in `core.js` on purpose.

Extracting the ZIP does not delete files, run migrations, update a WordPress database or clear caches. When a change only deletes files, the app lists them and does not build an empty ZIP. A successful ZIP is a package, not a finished deployment.

## Security

The server listens on loopback only and checks Host, Origin and a per-session token on every API call. Do not expose the port to the network or put the tool folder on your hosting. Nothing is registered to start with Windows.

## Development

```bash
node --test test.js
```

The tests use a temporary repository and a local bare remote. They never touch your project's tags, remotes or `output/`.

```bash
node server.js --repo C:\path\to\repo --open
```

Runs the server in the terminal and prints its URL. `--repo` pre-fills the repository field and `--open` opens the browser.

| File | Role |
|---|---|
| `core.js` | Git access, path policy, `.zipignore`, build and history |
| `server.js` | Loopback HTTP API and static files |
| `public/` | UI (`index.html`, `app.css`, `app.js`) and English strings (`i18n.js`) |
| `zip.ps1` | Creates the ZIP and reads back every entry's hash |
| `pick-folder.ps1` | Windows "Select folder" dialog behind **Browse…** |
| `start.cmd`, `start.ps1` | Hidden launcher that reuses a running session |
| `test.js` | `node:test` suite |

## FAQ

**Why aren't my uncommitted changes in the ZIP?**
Content is read from the Git blobs of the Target commit. Commit the changes, then preview again.

**Does it upload or deploy?**
No. It builds and verifies the package. You upload and extract it with your own process.

**What happens to deleted files?**
They are listed in the **Deleted** tab and in `deleted-files.txt`, and you must acknowledge them before building. Remove them on the host yourself.

**Why is a file blocked?**
Its path matches a [safety rule](#safety-rules). Narrow the commit range, or change the policy in `core.js` on purpose.

**Why Windows only?**
It uses Windows PowerShell to build and verify the ZIP, Explorer to open folders and the Windows folder dialog for **Browse…**.

**My branch isn't suggested, or Preview can't find it.**
Refs must exist locally. Run `git fetch` in the repository, then choose the repository again to reload the suggestions.

**"Tag already exists and points to another commit."**
The tool never moves or overwrites tags. Choose a new tag.

**How do I clean up?**
Delete folders under `output/`. They drop out of Deploy history.

## License

[MIT](LICENSE) © 2026 Trần Trọng Toàn

## Star History

<a href="https://www.star-history.com/#toantran46/zip-deployer&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=toantran46/zip-deployer&type=Date&theme=dark">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=toantran46/zip-deployer&type=Date">
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=toantran46/zip-deployer&type=Date">
  </picture>
</a>
