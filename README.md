# Zip Deployer

Double-click `start.cmd`. The app runs hidden on `127.0.0.1` on an automatically chosen port and opens your browser. Requires Node.js 18+, Git and Windows PowerShell on PATH; no `npm install` or XAMPP needed. Click **Dừng app** (Stop app) when you are done; closing the browser tab does not stop the server. Running the launcher again reuses the running session.

> The UI defaults to Vietnamese; use the **VI | EN** switch in the header for English and the moon/sun button for dark/light mode. Both choices are remembered in the browser. Button names below are shown in Vietnamese with the English label in parentheses.

## Usage
1. Choose staging / production and the repository path. Production shows an amber warning banner.
2. Enter the tag/commit currently running on the hosting (the field suggests the 20 most recent local tags), then the branch/tag/commit you want to deploy. Refs must already exist locally; the app does not fetch. For production, also enter a new tag. To package an existing tag, enter that tag as the source.
3. Click **Xem trước thay đổi** (Preview changes). Review the counts, then the file list: the **Tất cả / Chỉnh sửa / Thêm mới / Đã xóa** (All / Modified / Added / Deleted) tabs filter it, and each file shows its added/removed line count. Blocked files appear above the list. Deleted paths are in the **Đã xóa** tab and must be acknowledged before building.
4. Click **Tạo ZIP** (Create ZIP). Content is read from the Git blobs of the previewed commit, even if the branch moves afterwards; uncommitted files never go into the ZIP.
5. Click **Mở thư mục kết quả** (Open output folder). Upload only the deploy ZIP to the hosting root directory according to your own process. ZIP paths start at the repository root. Back up the hosting before replacing files.
6. Optional for production: open **Tạo & push tag production** (Create & push production tag), confirm, then click the button. The tool never overwrites a tag and only pushes this tag to `origin`; it does not push branches. Git uses your existing credentials; if permissions/auth are missing, configure Git outside the app and try again.

## Output
Each build is written to its own folder `output/prod-*` or `output/staging-*`:
- `deploy-*.zip`: the file to upload. No wrapping folder; every entry uses `/`.
- `deploy-files.txt`: files included in the ZIP.
- `deleted-files.txt`: paths that must be checked/removed separately on the hosting, including old paths of renamed files.
- `manifest.json`: source/target commits, SHA-256 and size of each file.
- `verification.json`: hashes read back from the ZIP.
- `files/`: intermediate content extracted from Git; the whole output folder can be deleted after use.

The app blocks `wp-config.php`, `.env*`, uploads, cccd, error_log, SQL/ZIP files, private keys, symlinks/submodules and unsafe paths. Rules are path-based — **this is not a secret scanner for file contents**. The root folders docs/tools/tests/.agents/.claude/.codex/.github/node_modules/.deploy-temp and agent instruction files are listed separately as not packaged. If you need to deploy these files, deliberately change the policy in `core.js`.

## Deploy history
**Lịch sử deploy** (Deploy history) lists the 50 most recent builds by reading `output/*/manifest.json`: environment, tag/target, commit range, file counts, ZIP size and time, with a button to open each folder. Deleting a folder under `output/` removes it from the history; folders without a readable manifest are skipped.

## .zipignore
To keep extra paths out of the ZIP, commit a `.zipignore` file at the repository root. It is read from the **target commit**, not from your working tree, so uncommitted edits to it have no effect. The **.zipignore** header button shows the built-in exclusions and the rules found in the last preview.
- One pattern per line, matched from the repository root and case-insensitive. A pattern matches a file or a whole folder (`build` and `/build/` both exclude `build/…`).
- `*` matches within one path segment and `**` matches across segments (`assets/*.map`, `**/*.log`).
- Blank lines and lines starting with `#` are ignored. Lines starting with `!` are shown but ignored: `.zipignore` can only add exclusions and never unblocks the sensitive files listed below.
- Matching paths are listed under the "not packaged" section of the preview, and `.zipignore` itself is never packaged.

Extracting the ZIP does not delete files, run migrations, update the WordPress database or clear caches. For changes that only delete files, the app shows the list and does not create an empty ZIP. This is a packaging tool; a successful ZIP does not mean the deployment is complete.

## Testing
From the app folder: `node --test test.js`. Tests use a temporary repository and a local bare remote; they never change your project's tags/remotes. To start manually: `node server.js`; the URL is printed to the terminal. You can pass `--repo C:\path\to\repo` and `--open`. By default the repository field is empty so you can choose the project to package.

## Security
The app listens on loopback only and checks Host/Origin plus a per-session token on the API. Do not expose the port to the network or put the tool folder on your hosting. Nothing is registered to start automatically with Windows.
