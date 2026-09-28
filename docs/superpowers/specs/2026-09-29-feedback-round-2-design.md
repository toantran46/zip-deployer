# Feedback round 2: folder picker, ref combobox, theme switch, EN default, README

Date: 2026-09-29 · Branch: `feature/enhancement-UI-and-feedback-correction`

## Goal

Eight pieces of user feedback on the Stitch redesign (PR #1). The app stays a zero-dependency local tool: Node built-ins, Windows PowerShell, Git. No npm packages, no CDNs, CSP unchanged.

| # | Feedback | Outcome |
|---|---|---|
| 1 | Pick the repo folder with a dialog instead of typing | **Browse…** button opens the native Windows "Select folder" dialog (modern `IFileOpenDialog`, same as VS Code's "Open Folder") |
| 2 | English as the default language | First visit shows EN; a stored choice still wins |
| 3 | Theme with System / Light / Dark, default System | 3-segment switch; System follows Windows live |
| 4 | README like `dietrichgebert/ponytail`, EN default + VI | `README.md` (EN) + `README.vi.md` (VI), language switcher, light/dark screenshot, Development, FAQ, License, Star History |
| 5 | Production "Preview changes" button colour doesn't fit | Production uses the same emerald primary button as staging |
| 6 | Branch/tag suggestions while typing (e.g. `release/`) | Custom styled combobox on Base and Target, fed by local branches, remote branches and tags |
| 7 | "Open output folder" does nothing | Fixed (root cause below) |
| 8 | Output folder names are random; history "Open folder" broken | Readable `{env}-{label}-{YYYYMMDD-HHmm}` names; history button fixed by #7 |

## Decisions made during brainstorming

- Ref suggestions: **custom styled dropdown**, not native `<datalist>` (must match the design system).
- Folder naming: **`{env}-{label}-{YYYYMMDD-HHmm}`**, mirroring the ZIP name.
- Production preview button: **emerald primary** (option B). Production is already signalled by the amber banner, amber env pill, amber tag field with PRODUCTION badge and LIVE chip; preview is read-only, not a risky action.
- Folder picker: **approach A**, C# `IFileOpenDialog` via `Add-Type` in a PowerShell script. Rejected: WinForms `FolderBrowserDialog` (old tree dialog on Windows PowerShell 5.1), browser `showDirectoryPicker()` (never exposes an absolute path).
- README: **light + dark screenshot** included.

## Root cause: "Open folder" buttons (#7, #8)

Both buttons call `POST /api/reveal`, which runs `spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore', windowsHide: true })` (`server.js:60`). `windowsHide` makes libuv pass `SW_HIDE` in `STARTUPINFO`; Explorer honours it for the window it opens. Reproduced on 2026-09-29: with `windowsHide: true` the Explorer window for the folder exists but `IsWindowVisible` is false; with `windowsHide: false` it is visible. Fix: drop `windowsHide` from that spawn. One change fixes both buttons.

The same trap applies to the folder picker's PowerShell process (a GUI window started from a hidden process), see §1.

## 1. Server and core

### 1.1 Folder picker: `pick-folder.ps1` + `POST /api/pick-folder`

- New `pick-folder.ps1` next to `zip.ps1`. `param([string]$Start)`. Compiles a minimal C# COM interop for `IFileOpenDialog` with `FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM`, sets the start folder when `$Start` is an existing directory, shows the dialog, writes the chosen absolute path to stdout. Cancel writes nothing and exits 0.
- `[Console]::OutputEncoding = [Text.Encoding]::UTF8` before writing, so Vietnamese folder names survive (Windows PowerShell 5.1 defaults to the OEM code page).
- The dialog gets a top-most owner window so it opens above the browser even though the server process is hidden and not in the foreground.
- It must show without a console window flash. Which `spawn` options achieve that under the hidden launcher (`start.cmd` → `start.ps1` → `node server.js` with `CreateNoWindow`) is verified first in the implementation plan, because `windowsHide: true` may hide the dialog the same way it hid Explorer.
- Endpoint `POST /api/pick-folder` with body `{ start }` → `{ path }` or `{ path: null }` on cancel.
  - Runs asynchronously (`execFile` with a callback wrapped in a Promise), so other requests keep being served while the dialog is open.
  - One dialog at a time: a second request while one is open → 400 `Hộp chọn thư mục đang mở.` ("The folder picker is already open.").
  - PowerShell failure → 400 `Không mở được hộp chọn thư mục.` plus the first stderr line ("Couldn't open the folder picker.").
  - Timeout 10 minutes, then treated as cancel.
  - The returned path is not trusted for anything: it only fills the input, and every later use goes through the existing `repoRoot()` validation.

### 1.2 Ref list: `refs()` + `POST /api/refs` (replaces `tags()` / `/api/tags`)

- `core.refs(repo)`: `git for-each-ref --sort=-creatordate --count=1000 --format=<refname>\t<refname:short>\t<symref> refs/heads refs/remotes refs/tags`.
  - Skips symbolic refs (`origin/HEAD`).
  - Returns `[{ name, kind }]`, `name` = short name, `kind` = `branch` (`refs/heads/`), `remote` (`refs/remotes/`) or `tag` (`refs/tags/`), newest first.
  - Validates `repo` through `repoRoot()` like `tags()` did.
- `POST /api/refs` `{ repo }` → `{ refs }`. `tags()`, its export and `/api/tags` are removed; `loadTags` was the only caller.

### 1.3 Reveal fix

Remove `windowsHide: true` from the `explorer.exe` spawn in `/api/reveal`. Nothing else changes; the `historyDir()` guard stays.

### 1.4 Readable output folder names

- `preview()` returns `label` (the already-sanitised `tag || target` value, `[a-zA-Z0-9._-]`, max 70 chars, SHA fallback) alongside `zipName`.
- `build(p, { outputRoot, now = new Date() })` creates `{environment}-{label}-{YYYYMMDD}-{HHmm}` in local time, with `label` cut to 40 characters in the folder name only (Windows 260-character path limit in `zip.ps1`; added after final review), e.g. `prod-1.44.0-20260929-1430`, `staging-release-1.44.0-rc-20260929-1015`.
- Created with non-recursive `fs.mkdirSync`; on `EEXIST` retry with `-2` … `-99`, then throw `Không tạo được thư mục kết quả mới.` ("Couldn't create a new output folder."). An existing folder is never reused or overwritten, preserving the current guarantee.
- `now` is injectable so the same-minute collision test is deterministic; `createdAt` uses the same `now`.
- `history()` regex `^(prod|staging)-` and `historyDir()` are unchanged, so legacy `prod-lbqZDC`-style folders keep appearing in history.

## 2. UI

### 2.1 Repo field + Browse

- Repo input keeps working (paste, `--repo`). A secondary button **Chọn thư mục…** / **Browse…** sits on the same row, right of the input.
- Click → `work('Đang mở hộp chọn thư mục…')`. On a path: set the input, `invalidate()`, `renderHeader()`, load refs. On cancel: no change, clear the notice.
- After Browse, a failed refs load shows the error in the notice (e.g. not a Git repository). When the path is typed, a failed refs load stays silent (current behaviour).

### 2.2 Ref combobox (Base and Target)

- One `combobox(input)` function wires both inputs; the `tag-options` `<datalist>` and `list="tag-options"` are removed. The production tag input gets no suggestions (it is a new tag).
- Data: the `refs` array from §1.2, loaded when the repo changes (`change` on the input, or after Browse).
- Filtering: case-insensitive substring. Names starting with the query rank first, then other matches; recency order within each group. Empty query shows the newest refs. At most 50 rows rendered; the popup scrolls (max-height about 320px). No matches → popup hidden. Free text is always allowed (commit SHAs).
- Row: mono ref name with the matched substring in bold, muted kind label on the right: `nhánh` / `nhánh remote` / `tag` (EN `branch` / `remote` / `tag`).
- Keyboard: ↓/↑ move the active row (wrapping), Enter picks the active row and does not submit the form while the popup is open with an active row, Esc closes, Tab closes and keeps the typed value. Mouse: `mousedown` picks (prevents blur first). Blur closes.
- Picking sets the value, closes the popup and calls `invalidate()`, the same effect as typing (a synthetic `input` event would reopen the popup).
- ARIA combobox pattern: input `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; popup `role="listbox"`, rows `role="option"` with `aria-selected`.
- Styling from existing tokens: popup `--surface`, 1px `--line`, radius 10px, `--shadow`, positioned under the input (`.field` becomes `position: relative`); active row `--accent-soft` background, `--accent` text; kind label `--muted`, 11px. Works in both themes.

### 2.3 Theme switch

- The `theme-toggle` icon button is replaced by a 3-button group **Hệ thống | Sáng | Tối** / **System | Light | Dark**, each with an icon (monitor, sun, moon), `aria-pressed`, inside `role="group"` labelled `Giao diện` / `Theme`.
- The language switch and theme switch share one segmented style (`.switch`, renamed from `.lang-switch`).
- `zd-theme` in `localStorage` stores `system` | `light` | `dark`; missing or unknown → `system`. Existing `light` / `dark` values keep working.
- `system` removes `data-theme` from `<html>`; the existing `@media (prefers-color-scheme: dark)` block then follows Windows live with no JS listener. `light` / `dark` set `data-theme` as today.

### 2.4 English by default

- `lang = store.get('zd-lang') === 'vi' ? 'vi' : 'en'`; `<html lang="en">` in `index.html`.
- The Vietnamese-keyed dictionary in `i18n.js` stays as is.
- Verify there is no visible flash of Vietnamese before `app.js` applies EN. If there is, hide the page until the language is applied, with a CSS-only guard that cannot leave the page hidden if the script fails.

### 2.5 Production preview button

Delete the `[data-env="prod"] #preview-button` rule in `app.css`; production uses `.button.primary` (emerald).

### 2.6 New strings

Every new Vietnamese UI or error string gets an EN entry in `i18n.js`. The existing test "every Vietnamese UI string has an English translation" enforces this.

## 3. Docs

### 3.1 README.md (EN) and README.vi.md (VI)

Both files have the same structure; the VI file is a full translation. Directly under the header: `<sub>English · <a href="README.vi.md">Tiếng Việt</a></sub>` (VI file: `<sub><a href="README.md">English</a> · Tiếng Việt</sub>`).

Sections, adapted from ponytail (its waitlist, sponsors, benchmark numbers, multi-agent install and slash-command sections do not apply):

1. Header: title, tagline "From commit to deploy package.", badges (MIT licence, Windows, Node ≥ 18, no dependencies, GitHub stars for `toantran46/zip-deployer`)
2. Screenshot: `<picture>` with `docs/images/screenshot-dark.png` for `prefers-color-scheme: dark` and `docs/images/screenshot-light.png` as fallback
3. What it does: packages only the files changed between two Git refs into a verified ZIP for hosts without CI
4. How it works: Git blobs → policy check → ZIP → SHA-256 read-back
5. Quick start
6. Usage (English button names)
7. Output (new folder names)
8. Deploy history
9. .zipignore
10. Safety rules (not a secret scanner)
11. Security
12. Development: `node --test test.js`, `node server.js --repo … --open`, short file map (`core.js`, `server.js`, `public/`, `zip.ps1`, `pick-folder.ps1`, `start.cmd` / `start.ps1`, `test.js`)
13. FAQ: uncommitted changes, "does it upload or deploy?", deleted files, why a file is blocked, why Windows only, no automatic fetch, "tag already exists", cleaning up `output/`
14. License: MIT
15. Star History: `<picture>` with `https://api.star-history.com/svg?repos=toantran46/zip-deployer&type=Date&theme=dark` and the light variant

Stale statements removed: "UI defaults to Vietnamese", moon/sun toggle, Vietnamese button names with English in parentheses, `output/prod-*` random suffix, "suggests the 20 most recent local tags".

### 3.2 Screenshots

- Preview screen for this repo, staging, Base `31dfdfd` → Target `3fe1cbd`, before any build (no absolute path with the Windows username on screen).
- 1400×900 PNG, one light and one dark, in `docs/images/`.
- Captured with headless Edge driven over the Chrome DevTools Protocol (`Emulation.setEmulatedMedia` for the colour scheme) from a throwaway script in the session scratchpad; the script is not committed.

### 3.3 docs/DESIGN.md

Update: the header bullet (theme segmented control, Browse button), the Buttons bullet (production uses the primary button), §8 "Vietnamese is the default" → English default, and add the combobox popup and theme switch component notes.

## 4. Testing

Automated (`node --test test.js`):

- `refs()`: fixture with a bare remote; after push + fetch + `git remote set-head origin <branch>`, returns the local branch (`branch`), `origin/<branch>` (`remote`) and `1.0.0` (`tag`), and no `origin/HEAD`. Relative path still rejected.
- Output folder: `build(p, { now: fixed })` → folder basename `prod-1.1.0-YYYYMMDD-HHmm` for the fixed date; a second build with the same `now` → same name + `-2`; `history()` lists both plus a legacy `prod-abc123`-style folder with a manifest.
- HTTP test: `POST /api/refs` replaces the `tags` assertion; `POST /api/tags` → 404.
- i18n completeness test covers the new strings.

Manual, in the browser pane and on the desktop (the dialog and Explorer cannot run headless):

- Browse: pick a repo, Cancel, pick a non-Git folder, a folder with Vietnamese characters; dialog appears on top with no console flash when started via `start.cmd`.
- Both Open folder buttons open a visible Explorer window at the right folder.
- Combobox: typing `release/`, substring match, ↑/↓, Enter, Esc, Tab, mouse pick; preview invalidates on pick.
- Theme: System follows a Windows theme change live; Light/Dark persist across reload.
- First load (cleared storage) is English with no visible Vietnamese flash.
- Every changed view checked in light and dark, EN and VI, and at 480px width.

## Out of scope

- Translating backend errors that interpolate git stderr (existing `ponytail:` note in `app.js`).
- Fetching from remotes, deleting old output folders, migrating legacy folder names.
