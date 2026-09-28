# Feedback Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the eight feedback items: native folder picker, branch/tag combobox, System/Light/Dark theme, English default, emerald production button, visible "Open folder", readable output folder names, bilingual README.

**Architecture:** Backend changes stay in `core.js` (pure, tested functions: `refs()`, folder naming in `build()`) with thin routes in `server.js` (`/api/refs`, `/api/pick-folder`, reveal fix). The folder dialog is a new `pick-folder.ps1` (C# `IFileOpenDialog` via `Add-Type`) run asynchronously by the server. The frontend stays vanilla HTML/CSS/JS: one `combobox(input)` function, a segmented theme switch sharing the language switch's style.

**Tech Stack:** Node 18+ built-ins, Git CLI, Windows PowerShell 5.1, vanilla JS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-29-feedback-round-2-design.md` (read it with this plan). Design tokens and components: `docs/DESIGN.md`.

## Global Constraints

- No new dependencies, no build step, no CDNs. CSP stays `default-src 'self'`: no inline `<script>` or `style=""` in HTML (setting `el.style.*` / `el.hidden` from JS is fine).
- UI source strings are Vietnamese; every new one gets an EN entry in `public/i18n.js`. The test "every Vietnamese UI string has an English translation" must stay green.
- Colours only from existing tokens in `public/app.css`; emerald is the only accent. Any new token gets a light value and a dark value in **both** dark blocks (the `@media` block and `:root[data-theme="dark"]`).
- Tests never write to the real `output/`; always pass a temp `outputRoot`.
- An existing output folder is never reused or overwritten.
- `node --test test.js` passes at the end of every task.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Picker paths with spaces and Vietnamese characters** (`C:\Users\…\thư mục thử`) must arrive in the input byte-for-byte. Pinned by Task 4 Step 6 (manual, the dialog can't run headless).
2. **Switching repos must never show the previous repo's refs**, even if the old request resolves late. Pinned by Task 3 Step 9.
3. **A branch and a tag with the same name** are both suggested and both usable as Base/Target. Pinned by Task 3 test (`every name resolves`).
4. **Staging targets containing `/` and other characters** (`feature/ABC-12_x`) produce a valid, readable folder name. Pinned by Task 2 test.
5. **Enter in Base/Target** still submits Preview when no suggestion is highlighted, and picks (without submitting) when one is. Pinned by Task 3 Step 9.

---

### Task 1: Make "Open folder" windows visible

**Files:**
- Modify: `server.js:60`

**Interfaces:** none.

- [ ] **Step 1: Remove `windowsHide: true` from the `explorer.exe` spawn in `/api/reveal`**

Result: `spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' })`. Add one comment above it: `// No windowsHide: Explorer applies SW_HIDE to the folder window it opens, so it stayed invisible.`

- [ ] **Step 2: Run the tests**

Run: `node --test test.js`
Expected: all pass.

- [ ] **Step 3: Verify both buttons open a visible window**

Start `node server.js --repo C:\Users\ToanTran\zip-deloyer` (prints the URL), open it in the browser pane, build a staging ZIP (Base `31dfdfd`, Target `3fe1cbd`), click **Open output folder**, then **Deploy history → Open folder** on that row. Then run:

```powershell
$s = New-Object -ComObject Shell.Application; @($s.Windows()) | ? LocationURL -like '*zip-deloyer/output*' | % { [pscustomobject]@{ url = $_.LocationURL; visible = $_.Visible } }
```

Expected: the build folder listed with `visible = True`. Close the windows and delete that test build folder under `output/`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "fix: show Explorer window for Open folder buttons"
```

---

### Task 2: Readable output folder names

**Files:**
- Modify: `core.js:97-98` (preview return), `core.js:105-116` (build folder + `createdAt`)
- Modify: `public/i18n.js`
- Test: `test.js`

**Interfaces:**
- Produces: `preview(input)` result gains `label: string` (the existing sanitised `tag || target` value used in `zipName`).
- Produces: `build(p, { outputRoot?, acknowledgeDeletes?, now?: Date })`; `result.dir` basename is `${environment}-${label}-${YYYYMMDD}-${HHmm}` (local time) or that plus `-2` … `-99`; `result.createdAt === now.toISOString()`.

- [ ] **Step 1: Write the failing test**

```js
test('build folders are named env-label-date-time and never reuse an existing folder', () => {
  const f = fixture(); const out = path.join(f.repo, 'out');
  const now = new Date(2026, 8, 29, 14, 30, 12);
  const opts = { outputRoot: out, acknowledgeDeletes: true, now };
  const first = build(preview(f.request), opts);
  const second = build(preview(f.request), opts);
  assert.equal(path.basename(first.dir), 'prod-1.1.0-20260929-1430');
  assert.equal(path.basename(second.dir), 'prod-1.1.0-20260929-1430-2');
  assert.equal(first.createdAt, now.toISOString());
  f.git('branch', 'feature/ABC-12_x');
  const staging = build(preview({ ...f.request, environment: 'staging', target: 'feature/ABC-12_x' }), opts);
  assert.equal(path.basename(staging.dir), 'staging-feature-ABC-12_x-20260929-1430');
  const legacy = path.join(out, 'prod-lbqZDC'); fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'manifest.json'), JSON.stringify({ ...first, dir: legacy }));
  assert.deepEqual(history(out).map(x => path.basename(x.dir)).sort(),
    ['prod-1.1.0-20260929-1430', 'prod-1.1.0-20260929-1430-2', 'prod-lbqZDC', 'staging-feature-ABC-12_x-20260929-1430']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern="env-label-date-time" test.js`
Expected: FAIL, basename is `prod-XXXXXX` (random `mkdtemp` suffix).

- [ ] **Step 3: Implement**

- In `preview()`, add `label` to the returned object (it is already computed on line 97).
- In `build()`, take `now = new Date()` from `options`. Replace `fs.mkdtempSync(...)` with: stamp `YYYYMMDD-HHmm` from `now`'s local getters (zero-padded), base name `${p.environment}-${p.label}-${stamp}`, then try `fs.mkdirSync(path.join(outputRoot, name))` (non-recursive) for `name = base`, `base-2` … `base-99`, continue only on `EEXIST` and rethrow anything else. After 99 attempts throw `new Error('Không tạo được thư mục kết quả mới.')`.
- `createdAt: now.toISOString()`.
- `i18n.js`: `"Không tạo được thư mục kết quả mới.": "Couldn't create a new output folder."`

- [ ] **Step 4: Run all tests**

Run: `node --test test.js`
Expected: all pass (including the i18n completeness test).

- [ ] **Step 5: Commit**

```bash
git add core.js public/i18n.js test.js
git commit -m "feat: name build folders env-label-date-time"
```

---

### Task 3: Branch/tag suggestions (refs API + combobox)

**Files:**
- Modify: `core.js:46` (replace `tags` with `refs`), `core.js:140` (exports)
- Modify: `server.js:37,55` (`/api/tags` → `/api/refs`)
- Modify: `public/index.html:45-48` (Base/Target fields, remove `<datalist>`)
- Modify: `public/app.js:111-117,188,201` (`loadTags` → `loadRefs`, combobox)
- Modify: `public/app.css` (combobox styles, new `--shadow-pop` token)
- Modify: `public/i18n.js`, `docs/DESIGN.md` (§4 add a combobox bullet)
- Test: `test.js` (import line 7, HTTP test, the `tags lists newest first…` test)

**Interfaces:**
- Produces: `core.refs(repo: string) → Array<{ name: string, kind: 'branch' | 'remote' | 'tag' }>`, newest first, max 1000, no symbolic refs; throws the `repoRoot()` errors for bad paths.
- Produces: `POST /api/refs { repo } → { refs }`. `tags()` and `/api/tags` no longer exist.
- Produces (app.js, used by Task 4): `async function loadRefs({ showErrors = false } = {})`, which fills the module-level `refs` array for the current `#repo` value and, if `showErrors`, reports failures with `notice(e.message, true)`.

- [ ] **Step 1: Write the failing tests**

Change the import on line 7 to `const { preview, build, publish, refs, history, historyDir } = require('./core');`. Rename the test `tags lists newest first; history lists builds…` to `history lists builds newest first and skips broken folders` and delete its two `tags(...)` lines. Add:

```js
test('refs lists branches, remote branches and tags, skips origin/HEAD, and every name resolves', () => {
  const f = fixture(); const branch = f.git('branch', '--show-current').trim();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-helper-remote-'));
  execFileSync('git', ['init', '--bare', '-q', remote], { windowsHide: true });
  f.git('remote', 'add', 'origin', remote); f.git('push', '-q', 'origin', branch);
  f.git('fetch', '-q', 'origin'); f.git('remote', 'set-head', 'origin', branch);
  f.git('branch', 'dup'); f.git('tag', 'dup', '1.0.0');
  const list = refs(f.repo); const kind = Object.fromEntries(list.map(r => [r.name, r.kind]));
  assert.equal(kind[branch], 'branch'); assert.equal(kind[`origin/${branch}`], 'remote'); assert.equal(kind['1.0.0'], 'tag');
  assert(!list.some(r => r.name === 'origin/HEAD' || r.name === 'origin'));
  assert.deepEqual(list.filter(r => /dup$/.test(r.name)).map(r => r.kind).sort(), ['branch', 'tag']);
  for (const r of list) f.git('rev-parse', '--verify', '--end-of-options', `${r.name}^{commit}`);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-helper-empty-'));
  execFileSync('git', ['init', '-q', empty], { windowsHide: true });
  assert.deepEqual(refs(empty), []);
  assert.throws(() => refs('relative/path'), /tuyệt đối/);
});
```

In the HTTP test, replace the `post('tags', …)` assertion with:

```js
assert.deepEqual((await (await post('refs', { repo: f.repo })).json()).refs.filter(r => r.kind === 'tag').map(r => r.name), ['1.0.0']);
assert.equal((await post('tags', { repo: f.repo })).status, 404);
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test.js`
Expected: FAIL, `refs is not a function`.

- [ ] **Step 3: Implement `refs(repo)` in `core.js` and the route in `server.js`**

`git(repoRoot(repo), ['for-each-ref', '--sort=-creatordate', '--count=1000', '--format=%(refname)%09%(refname:short)%09%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags'])`. Split lines on `\t`, drop rows whose third field (symref) is non-empty, map the second segment of the full refname (`heads` / `remotes` / `tags`) to `branch` / `remote` / `tag`. Export `refs` instead of `tags`. In `server.js` swap `/api/tags` for `/api/refs` in the allowed list and return `{ refs: core.refs(body.repo) }`.

- [ ] **Step 4: Run tests**

Run: `node --test test.js`
Expected: all pass.

- [ ] **Step 5: Markup (`index.html`)**

For Base and Target: wrap each existing `<label class="field">` in `<div class="combo">`, and put `<ul id="base-list" class="combo-list" role="listbox" aria-label="Gợi ý branch / tag" hidden></ul>` (and `target-list`) **after** the label, not inside it, so option text does not become part of the input's accessible name. Give each input `role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="base-list"` (resp. `target-list`). Delete `<datalist id="tag-options">` and `list="tag-options"`.

- [ ] **Step 6: `loadRefs` and `combobox(input)` in `app.js`**

- `let refs = [];` Replace `loadTags` with `loadRefs({ showErrors })`: set `refs = []` immediately, remember the repo string, and after the `api('refs', { repo })` call assign the result only if `$('repo').value.trim()` still equals it (a late response from a previous repo is dropped). Update both callers (`repo` `change` listener, the `api('context')` bootstrap).
- `combobox(input)`, called for `$('base')` and `$('target')`. Popup is `$(input.id + '-list')`.
  - **Ranking:** case-insensitive substring. Names starting with the query come first, then the other matches, each group in `refs` (recency) order. Take the first 50. No matches → close.
  - **Rows:** `<li role="option" id="{input.id}-opt-{i}" aria-selected>` containing the name as text nodes with the matched part wrapped in `<strong>`, plus `<span class="combo-kind">` holding `t('nhánh')` / `t('nhánh remote')` / `t('tag')`. Build with `el()`, never `innerHTML`.
  - **Open:** on `focus` and `input`. Set `list.style.top = (input.offsetTop + input.offsetHeight + 4) + 'px'`, `hidden = false`, `aria-expanded="true"`.
  - **Keys:** ↓/↑ move the active row (wrapping, opening if closed), set `aria-activedescendant`, `scrollIntoView({ block: 'nearest' })`. Enter with an active row: `preventDefault()` and pick. Enter with no active row: do nothing (the form submits as before). Esc: close. Tab: close.
  - **Mouse:** `mousedown` on the list: `preventDefault()` (keeps focus), pick the closest `li`.
  - **Close:** on `blur`. Hide the list, `aria-expanded="false"`, remove `aria-activedescendant`.
  - **Pick:** `input.value = name; close(); invalidate();`
- `i18n.js`: `"nhánh": "branch"`, `"nhánh remote": "remote"`, `"tag": "tag"`, `"Gợi ý branch / tag": "Branch / tag suggestions"`.

- [ ] **Step 7: Styles (`app.css`)**

- `.combo { position: relative; }`
- `.combo-list`:
  - Layout: absolute, left/right 0, `z-index: 5` (below the sticky header's 10), max-height 320px, `overflow-y: auto`, padding 4px, no list style.
  - Look: `--surface` background, 1px `--line` border, radius 10px, `box-shadow: var(--shadow-pop)`.
- New token `--shadow-pop`: light `0 8px 24px rgb(15 23 42 / .12)`, dark `0 8px 24px rgb(0 0 0 / .45)`.
- Rows: flex, `justify-content: space-between`, gap 12px, padding 6px 10px, radius 7px, `--mono` 13px, pointer cursor. Active or hover row: `--accent-soft` background, `--accent` text.
- `.combo-kind`: `--muted`, `--sans`, 11px, `flex: none`.
- `strong`: weight 700.

- [ ] **Step 8: Run tests**

Run: `node --test test.js`
Expected: all pass.

- [ ] **Step 9: Manual check in the browser pane**

`node server.js --repo C:\Users\ToanTran\zip-deloyer`, open the URL:
- Type `feat` in Target: `feature/…` branches first, kind labels shown.
- Type `origin/`: remote branches only.
- ↓↓ then Enter fills the field and the page does **not** preview. Enter again with the popup closed runs Preview.
- Esc closes. A click picks.
- Change the repo path to another repo and immediately focus Base: no suggestions from the old repo.
- Check light and dark (`resize_window` `colorScheme`), EN and VI.

- [ ] **Step 10: Update `docs/DESIGN.md` §4**

Add a "Ref combobox" bullet covering popup tokens, active row colours and the kind label.

- [ ] **Step 11: Commit**

```bash
git add core.js server.js public/index.html public/app.js public/app.css public/i18n.js docs/DESIGN.md test.js
git commit -m "feat: suggest branches, remote branches and tags in Base/Target"
```

---

### Task 4: Native folder picker (Browse…)

**Files:**
- Create: `pick-folder.ps1`
- Modify: `server.js` (route list line 37, new `/api/pick-folder` handler, `pickFolder()` helper)
- Modify: `public/index.html:42` (repo field), `public/app.js`, `public/app.css`, `public/i18n.js`, `docs/DESIGN.md` (§4 Inputs bullet)

**Interfaces:**
- Consumes: `loadRefs({ showErrors: true })` from Task 3; existing `work()`, `invalidate()`, `renderHeader()`, `notice()`.
- Produces: `pick-folder.ps1 -Start <path>` writes the chosen absolute path as UTF-8 (no BOM, no newline) to stdout. Cancel writes nothing and exits 0.
- Produces: `POST /api/pick-folder { start } → { path: string | null }`.

- [ ] **Step 1: Write `pick-folder.ps1`**

`param([string]$Start = '')`, `$ErrorActionPreference = 'Stop'`, `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false`. `Add-Type -AssemblyName System.Windows.Forms` and this interop (exact GUIDs and vtable order matter; members after `GetResult` are omitted on purpose):

```csharp
using System; using System.Runtime.InteropServices;
[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCo {}
[ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
  void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
  void GetParent(out IShellItem parent);
  void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
}
[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialog {
  [PreserveSig] int Show(IntPtr owner);
  void SetFileTypes(uint c, IntPtr specs); void SetFileTypeIndex(uint i); void GetFileTypeIndex(out uint i);
  void Advise(IntPtr sink, out uint cookie); void Unadvise(uint cookie);
  void SetOptions(uint fos); void GetOptions(out uint fos);
  void SetDefaultFolder(IShellItem si); void SetFolder(IShellItem si);
  void GetFolder(out IShellItem si); void GetCurrentSelection(out IShellItem si);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n); void GetFileName(out IntPtr n);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
  void GetResult(out IShellItem si);
}
public static class FolderPicker {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem item);
  public static string Pick(string start, IntPtr owner) {
    var d = (IFileDialog)new FileOpenDialogCo();
    uint o; d.GetOptions(out o); d.SetOptions(o | 0x20 | 0x40); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
    if (!string.IsNullOrEmpty(start) && System.IO.Directory.Exists(start)) {
      IShellItem f; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out f); d.SetFolder(f);
    }
    if (d.Show(owner) != 0) return null; // 0x800704C7 = cancelled
    IShellItem r; d.GetResult(out r); string p; r.GetDisplayName(0x80058000, out p); return p; // SIGDN_FILESYSPATH
  }
}
```

Owner window: a `System.Windows.Forms.Form` with `TopMost = $true`, `ShowInTaskbar = $false`, `FormBorderStyle = 'None'`, `Opacity = 0`, `StartPosition = 'CenterScreen'`, size 1×1. Call `.Show()` before the dialog. When the process is started hidden, this first `ShowWindow` absorbs the `SW_HIDE` that hid Explorer in Task 1, and the dialog owned by it stays top-most. Then `$p = [FolderPicker]::Pick($Start, $owner.Handle)`, `$owner.Close()`, and `[Console]::Out.Write($p)` if `$p`.

- [ ] **Step 2: Spike: confirm the dialog shows from a hidden child process**

Run from the repo root:

```bash
node -e "require('child_process').execFile('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File','pick-folder.ps1','-Start','C:\\Users'],{windowsHide:true,encoding:'utf8'},(e,o,s)=>console.log(JSON.stringify({e:e&&e.message,o,s})))"
```

Expected: the modern "Select folder" dialog (address bar, Quick access, **Select folder** button) appears **above** other windows with no console window. Picking `C:\Users` prints `"o":"C:\\Users"`; Cancel prints `"o":""`. The user confirms the dialog, or drive it with computer-use. If the dialog is hidden or behind other windows, try in order: keep `windowsHide: true` and add `$owner.Activate()`; otherwise `windowsHide: false` plus `-WindowStyle Hidden` (accepts a brief console flash). Record the working option in a `// ` comment above `pickFolder()`.

- [ ] **Step 3: Server route**

- `server.js`: `function pickFolder(start) → Promise<string | null>`. It wraps `execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'pick-folder.ps1'), '-Start', typeof start === 'string' ? start : ''], { <options from Step 2>, encoding: 'utf8', timeout: 600000 })`:
  - Timeout (`err.killed`) resolves `null`.
  - Any other error rejects with ``new Error(`Không mở được hộp chọn thư mục: ${(stderr || err.message).trim().split(/\r?\n/)[0]}`)``. Use a template literal, so, like the ZIP error, it stays untranslated.
  - Success resolves `stdout.replace(/^\uFEFF/, '').trim() || null`.
- Add `'/api/pick-folder'` to the allowed POST list.
- `let picking = false` in `createServer`'s scope, next to `currentPreview`. Handler:
  - If `picking` is set, throw `new Error('Hộp chọn thư mục đang mở.')`.
  - Otherwise set `picking = true`, return `json(200, { path: await pickFolder(body.start) })`, and reset `picking = false` in `finally`.

- [ ] **Step 4: Browse button (`index.html`, `app.css`, `app.js`, `i18n.js`)**

- **Markup:** turn the repo `<label class="field">` into `<div class="field">`:
  - `<label class="field-row" for="repo"><span class="field-label" data-i18n>Thư mục repository Git</span></label>`
  - `<span class="input-row"><input id="repo" … aria-describedby="repo-help"><button id="browse" class="button secondary" type="button"><span data-i18n>Chọn thư mục…</span></button></span>`
  - the help span, now with `id="repo-help"`.
- **CSS:** `.input-row { display: flex; gap: 8px; } .input-row input { flex: 1; min-width: 0; }`.
- **JS:** `$('browse').onclick = () => work('Đang mở hộp chọn thư mục…', async () => { … })`.
  - Call `api('pick-folder', { start: $('repo').value.trim() })`.
  - On `null`: `lastNotice = null; renderNotice();`.
  - Otherwise set `$('repo').value`, then `invalidate(); renderHeader(); await loadRefs({ showErrors: true });`.
  - The button is inside `#release-form`, so `updateButtons()` already disables it while busy.
- **i18n:** `"Chọn thư mục…": "Browse…"`, `"Đang mở hộp chọn thư mục…": "Opening folder picker…"`, `"Hộp chọn thư mục đang mở.": "The folder picker is already open."`.

- [ ] **Step 5: Run tests**

Run: `node --test test.js`
Expected: all pass.

- [ ] **Step 6: Manual check through the real launcher**

Stop any running server. Create a test repo whose path has spaces and Vietnamese letters: `git init "%TEMP%\thư mục thử\repo"` plus one commit. Double-click `start.cmd`, then:

1. **Browse → Cancel:** the field is unchanged and the notice clears.
2. **Browse → pick `thư mục thử\repo`:** the field shows exactly that path, the header badge shows `repo`, and Base suggestions list its branch.
3. **Browse → pick a non-Git folder:** an error notice appears.
4. **Double-click Browse fast:** the second click is ignored (button disabled while busy).
5. **No console window flashes.**

- [ ] **Step 7: Update `docs/DESIGN.md` §4 Inputs**

Mention the Browse secondary button beside the repo input.

- [ ] **Step 8: Commit**

```bash
git add pick-folder.ps1 server.js public/index.html public/app.js public/app.css public/i18n.js docs/DESIGN.md
git commit -m "feat: pick the repository folder with the Windows folder dialog"
```

---

### Task 5: System / Light / Dark theme switch

**Files:**
- Modify: `public/index.html:19-20`, `public/app.css:71-73,77-78`, `public/app.js:151,193,198`, `public/i18n.js`, `docs/DESIGN.md` (§4 Header bullet)

**Interfaces:**
- Produces: `applyTheme(mode)` in `app.js`. `mode` outside `'system' | 'light' | 'dark'` is treated as `'system'`.

- [ ] **Step 1: Markup**

- Replace `#theme-toggle` with `<div class="switch" role="group" aria-label="Giao diện">` holding three buttons: `#theme-system`, `#theme-light` and `#theme-dark`.
  - Each button: `type="button"`, `aria-pressed`, a 16px `.icon` SVG and `<span data-i18n>Hệ thống</span>` / `Sáng` / `Tối`.
  - Icons: monitor = `<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>`; reuse the existing sun and moon paths.
- The language group's class changes from `lang-switch` to `switch`.

- [ ] **Step 2: Styles**

- Rename `.lang-switch` rules to `.switch`.
- Buttons become `display: inline-flex; align-items: center; gap: 6px; padding: 0 10px` (the language buttons keep `min-width: 36px`).
- Delete the `.theme-sun` / `.theme-moon` rules.

- [ ] **Step 3: Behaviour**

- `applyTheme(mode)`: `system` deletes `document.documentElement.dataset.theme`; `light` / `dark` set it. Set `aria-pressed` on the three buttons.
- Click handlers: `store.set('zd-theme', mode); applyTheme(mode)`.
- Startup: `applyTheme(store.get('zd-theme'))`. Remove the `matchMedia` default and the old toggle handler.
- `i18n.js`: add `"Giao diện": "Theme"`, `"Hệ thống": "System"`, `"Sáng": "Light"`, `"Tối": "Dark"`; delete the now-unused `"Đổi giao diện sáng / tối"` entry.

- [ ] **Step 4: Run tests**

Run: `node --test test.js`
Expected: all pass.

- [ ] **Step 5: Manual check in the browser pane**

1. Clear `localStorage`: System is pressed.
2. `resize_window colorScheme: dark` then `light`: the page follows live with no reload.
3. Light and Dark persist across reload.
4. Set `localStorage['zd-theme'] = 'dark'` (the old format): Dark is pressed.
5. At 480px width the header wraps cleanly.

- [ ] **Step 6: Update `docs/DESIGN.md` §4 Header bullet** (VI|EN control + System|Light|Dark control), then commit

```bash
git add public/index.html public/app.css public/app.js public/i18n.js docs/DESIGN.md
git commit -m "feat: System/Light/Dark theme switch, System by default"
```

---

### Task 6: English default + emerald production button

**Files:**
- Modify: `public/app.js:3,199`, `public/index.html:2`, `public/app.css:142`, `docs/DESIGN.md` (§4 Buttons, §8 intro)

**Interfaces:** none.

- [ ] **Step 1: English default**

In `app.js`, the initial `lang = 'en'` and startup `lang = store.get('zd-lang') === 'vi' ? 'vi' : 'en'`. In `index.html`, `<html lang="en">`.

- [ ] **Step 2: Production button**

Delete `[data-env="prod"] #preview-button { … }` from `app.css`.

- [ ] **Step 3: Check for a Vietnamese flash**

In the browser pane, clear storage and reload five times, taking a screenshot immediately after each `navigate`. If any shot shows Vietnamese text, add this guard. It hides the page until `applyLang()` marks it ready, and a 1s CSS fallback means a failed script still reveals the page:

```css
html:not([data-ready]) body { visibility: hidden; animation: reveal 0s 1s forwards; }
@keyframes reveal { to { visibility: visible; } }
```

`applyLang()` then sets `document.documentElement.dataset.ready = ''`.

- [ ] **Step 4: Run tests and check both environments**

Run: `node --test test.js` (all pass). In the pane, switch to Production: Preview is emerald in light and dark, and the amber banner, pill and tag field are unchanged.

- [ ] **Step 5: Update `docs/DESIGN.md`**

- §4 Buttons: production uses the primary button.
- §8: "English is the default; VI is one click away."

Then commit:

```bash
git add public/app.js public/index.html public/app.css docs/DESIGN.md
git commit -m "feat: English by default; production preview uses the primary button"
```

---

### Task 7: Bilingual README with screenshots

**Files:**
- Modify: `README.md` (full rewrite, English)
- Create: `README.vi.md`, `docs/images/screenshot-light.png`, `docs/images/screenshot-dark.png`
- Scratch only (not committed): `<scratchpad>/shot.js`

**Interfaces:** none (all UI tasks must be done first; the screenshot shows their result).

- [ ] **Step 1: Capture screenshots**

- Run `node server.js --repo C:\Users\ToanTran\zip-deloyer` in the background and note the URL.
- `shot.js` (Node 22 global `WebSocket` and `fetch`):
  - Launch `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe --headless=new --remote-debugging-port=9333 --user-data-dir=<scratchpad>\edge --hide-scrollbars about:blank`.
  - Read the page's `webSocketDebuggerUrl` from `http://127.0.0.1:9333/json/list`.
  - For each scheme `light` and `dark`:
    - `Emulation.setDeviceMetricsOverride { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }`
    - `Emulation.setEmulatedMedia { features: [{ name: 'prefers-color-scheme', value }] }`
    - `Page.navigate` to the URL
    - `Runtime.evaluate` to set `#base` = `31dfdfd`, `#target` = `3fe1cbd` and click `#preview-button`
    - poll until `!document.getElementById('preview').hidden`
    - `Page.captureScreenshot { format: 'png' }` → `docs/images/screenshot-<value>.png`
- Stop Edge and the server.

Expected: two 1400×900 PNGs, each under 300 KB, English UI, staging, no absolute path with the Windows username visible. Open both with the Read tool to check.

- [ ] **Step 2: Write `README.md`**

Header block, exactly:

```html
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
```

Then a screenshot `<picture>` (dark `srcset` under `prefers-color-scheme: dark`, fallback `<img src="docs/images/screenshot-light.png" alt="Zip Deployer previewing a staging package">`), then the sections in the spec §3.1 order.

Facts to state (from the current README, with the new behaviour):
- **Defaults:** English by default with a VI | EN switch; System | Light | Dark theme (System by default); both remembered in the browser.
- **Repo field:** a **Browse…** button opens the Windows folder dialog.
- **Base/Target:** both suggest local branches, remote branches and tags as you type. The app never fetches, so run `git fetch` first.
- **Output:** each build goes to `output/{env}-{label}-{YYYYMMDD-HHmm}` with `-2`, `-3`… on collisions; old folders stay in history.
- **Open folder:** both **Open output folder** and history's **Open folder** open Explorer.
- **Unchanged content:** carry over the Output files list, blocked-file rules, `.zipignore` rules and Security text.
- **Development:**
  - Commands: `node --test test.js` and `node server.js --repo C:\path\to\repo --open`.
  - File map: `core.js` (Git, policy, build, history), `server.js` (loopback HTTP API), `public/` (UI + `i18n.js`), `zip.ps1` (ZIP create + read-back hashes), `pick-folder.ps1` (folder dialog), `start.cmd` / `start.ps1` (hidden launcher), `test.js`.

FAQ answers (one or two sentences each):
- **Uncommitted changes?** Content is read from the target commit's Git blobs; commit first.
- **Does it upload or deploy?** No. It only packages; upload and extract with your own process. It runs no migrations and clears no caches.
- **Deleted files?** They are listed in the Deleted tab and `deleted-files.txt`, must be acknowledged, and are removed on the host by hand; delete-only changes produce no ZIP.
- **Why is a file blocked?** Path rules (`wp-config.php`, `.env*`, keys, SQL/ZIP, uploads, symlinks, unsafe names); change them deliberately in `core.js`.
- **Why Windows only?** It uses Windows PowerShell for the ZIP and hash read-back, Explorer, and the folder dialog.
- **Branch not suggested / not found?** Refs must exist locally; run `git fetch`.
- **"Tag already exists and points to another commit"?** The tool never overwrites tags; choose a new one.
- **Cleaning up?** Delete folders under `output/`; they drop out of history.

License: `MIT © 2026 Trần Trọng Toàn`, linking `LICENSE`. Star History, exactly:

```html
<a href="https://www.star-history.com/#toantran46/zip-deployer&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=toantran46/zip-deployer&type=Date&theme=dark">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=toantran46/zip-deployer&type=Date">
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=toantran46/zip-deployer&type=Date">
  </picture>
</a>
```

- [ ] **Step 3: Write `README.vi.md`**

A full Vietnamese translation with the same structure and the same images. Switcher: `<sub><a href="README.md">English</a> · Tiếng Việt</sub>`. UI names use the VI labels (**Xem trước thay đổi**, **Tạo ZIP**, **Chọn thư mục…**, **Mở thư mục kết quả**, **Lịch sử deploy**, **Hệ thống / Sáng / Tối**).

- [ ] **Step 4: Verify**

Run: `grep -nE "defaults to Vietnamese|moon/sun|20 most recent|prod-\*" README.md README.vi.md`
Expected: no output. Also confirm `docs/images/screenshot-light.png`, `docs/images/screenshot-dark.png` and `README.vi.md` exist (the relative links resolve).

- [ ] **Step 5: Commit**

```bash
git add README.md README.vi.md docs/images/screenshot-light.png docs/images/screenshot-dark.png
git commit -m "docs: bilingual README with screenshots, FAQ and Star History"
```
