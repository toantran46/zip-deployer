# Stitch Redesign + Core Extras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Zip Deployer to the Stitch "Deploy Studio" design (light/dark, VI/EN) and add per-file line counts, filter tabs, a recent-tags picker, deploy history and `.zipignore` exclusions. None of this changes the app's rule that it never touches hosting.

**Architecture:** The backend stays in `core.js` (pure functions, which are what the tests exercise) plus thin routes in `server.js`. The frontend stays native HTML/CSS/JS with no build step and no dependencies. It gets one new file, `public/i18n.js`: an EN dictionary keyed by the Vietnamese source string, so VI needs no dictionary and server error messages translate through the same lookup.

**Tech Stack:** Node 18+ built-ins, Git CLI, Windows PowerShell (existing `zip.ps1`), vanilla JS, `node:test`.

**Spec:** `docs/DESIGN.md` (tokens, components, layout, copy table). Visual source is Stitch project `52278201224337463`, screens *Bilingual & Dark/Light Theme* (main), *Production Mode*.

## Global Constraints

- No new dependencies, no build step, no external fonts or CDNs. The server CSP stays `default-src 'self'`, so no inline `<script>` or `style=""` attributes (setting `el.style` / `el.hidden` from JS is fine).
- Vietnamese is the default language. Every user-visible string must have an EN entry (enforced by the Task 5 test).
- Theme and language are stored in `localStorage` keys `zd-theme` / `zd-lang`, and every access is wrapped in `try/catch`. With no stored theme, follow `prefers-color-scheme`.
- Blocked-path policy (`policy()` in `core.js`) always runs before any exclusion. Nothing user-supplied can unblock a path.
- `.zipignore` is read from the **target commit**, never from the working tree, to match "only committed content goes in the ZIP".
- Out of scope: SSH Host mode, upload/unzip/rsync, folder-browse dialog, per-file diff viewer, and Stitch's decorative checkboxes (backup commit, rollback script, checklist log, PHP lint, auto-push tag). Publishing a tag stays the separate explicit step it is today.
- The brand stays "Zip Deployer" (Stitch says "localhome Deploy Studio"; the tool packages any repo).
- Keep the current code style: 2-space indent, dense one-liners in `core.js` / `app.js`, Vietnamese error strings in the backend. `app.css` is rewritten in normal multi-line formatting.
- Test command: `node --test test.js` (the existing 7 tests must stay green).

## Review Focus

1. **Binary files in `git diff --numstat`** print `-\t-`. Rows must show "binary", not `NaN`. Pinned in Task 1 (fixture already has `binary.bin`).
2. **`.zipignore` saved by Windows editors** (CRLF, UTF-8 BOM) must still match. Pinned in Task 1.
3. **`.zipignore` that tries to unblock** (`!wp-config.php`) or excludes everything (`**`): blocked stays blocked, and excluding everything hits the existing "no files" build guard instead of producing an empty ZIP. Pinned in Task 1.
4. **Broken output folders** (build crashed before `manifest.json`, or manifest is corrupt JSON): history skips them and does not crash. Pinned in Task 2.
5. **Reveal path traversal**: `POST /api/reveal {dir: "C:\\Windows"}` or `output\\..\\..` must be refused and must never spawn Explorer on an arbitrary path. Pinned in Task 2.

---

### Task 1: Line counts and `.zipignore` in `preview()`

**Files:**
- Modify: `core.js` (`excluded()`, `preview()`, new `ignoreMatcher()`)
- Test: `test.js`

**Interfaces:**
- Produces:
  - `preview()` result: every `files[i]` gains `added: number|null` and `removed: number|null` (null means binary). The result gains `ignoreRules: string[]` (active `.zipignore` rules, comments and blanks dropped). Paths matched by `.zipignore` land in the existing `excluded: string[]`.
  - `.zipignore` itself is always in `excluded` (add `\.zipignore` to the root-file alternation in `excluded()`).

- [ ] **Step 1: Write the failing tests** (append to `test.js`)

```js
test('preview reports per-file line counts; binary is null; unicode paths keep counts', () => {
  const f = fixture(); const p = preview(f.request);
  const byPath = Object.fromEntries(p.files.map(x => [x.path, x]));
  assert.deepEqual([byPath['change.php'].added, byPath['change.php'].removed], [1, 1]);
  assert.deepEqual([byPath['binary.bin'].added, byPath['binary.bin'].removed], [null, null]);
  assert.equal(byPath['folder/tên có dấu.txt'].added, 1);
});

test('.zipignore from the target commit adds exclusions but never unblocks', () => {
  const f = fixture();
  f.write('.zipignore', '\uFEFF# comment\r\nassets/*.map\r\n\r\n/build/\r\n!wp-config.php\r\n');
  f.write('assets/app.js.map', 'x'); f.write('assets/app.js', 'x'); f.write('build/out.js', 'x'); f.write('wp-config.php', 'secret');
  f.git('add', '.'); f.git('commit', '-qm', 'ignore');
  const p = preview(f.request);
  assert.deepEqual(p.ignoreRules, ['assets/*.map', '/build/', '!wp-config.php']);
  assert(p.excluded.includes('assets/app.js.map') && p.excluded.includes('build/out.js') && p.excluded.includes('.zipignore'));
  assert(p.files.some(x => x.path === 'assets/app.js'));
  assert(p.blocked.some(x => x.path === 'wp-config.php'));
  f.write('.zipignore', '**\n'); f.git('add', '.'); f.git('commit', '-qm', 'all');
  const all = preview(f.request);
  assert.equal(all.files.length, 0);
  assert.throws(() => build({ ...all, blocked: [] }, { outputRoot: path.join(f.repo, 'out'), acknowledgeDeletes: true }), /Không có file/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test.js`
Expected: the 2 new tests FAIL (`added` undefined, `ignoreRules` undefined). The 7 existing tests pass.

- [ ] **Step 3: Implement in `core.js`**
  - Line counts: in `preview()`, run `git diff --no-ext-diff --no-renames --numstat -z baseSha targetSha --`, split on `\0`, and parse each record `added\tremoved\tpath` (use `indexOf('\t')` twice so tabs in paths survive). A `-` value becomes `null`, otherwise `Number`. Put the results in a `Map` by path and read from it when pushing to `files`.
  - `ignoreMatcher(text: string) -> { rules: string[], match: (p: string) => boolean }`: strip the BOM, split on `/\r?\n/`, trim, and drop blanks and `#` lines to get `rules`. Lines starting with `!` stay in `rules` for display but are never compiled (so they cannot un-exclude). Compile each remaining rule with this exact algorithm:
    ```js
    const r = rule.replace(/^\/+|\/+$/g, '');
    new RegExp('^' + r.split('**').map(s => s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '(/|$)', 'i')
    ```
  - In `preview()`, get the `.zipignore` blob through the existing `tree` map (`tree.get('.zipignore')?.oid` → `git cat-file blob <oid>`; use an empty string if missing). In the loop the order is `policy` → `excluded(p) || ignore.match(p)` → deleted → blob checks. Return `ignoreRules: ignore.rules`.

- [ ] **Step 4: Run tests**

Run: `node --test test.js`
Expected: 9/9 PASS.

- [ ] **Step 5: Commit**

```bash
git add core.js test.js
git commit -m "feat: per-file line counts and .zipignore exclusions in preview"
```

---

### Task 2: Recent tags, deploy history and safe reveal (core + routes)

**Files:**
- Modify: `core.js` (new `repoRoot`, `tags`, `history`, `historyDir`, `OUTPUT_ROOT`; move `zipBytes` before the manifest write)
- Modify: `server.js` (routes `POST /api/tags`, `GET /api/history`, `POST /api/reveal` with optional `dir`)
- Test: `test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `OUTPUT_ROOT = path.join(__dirname, 'output')`, used as the `build()` default.
  - `repoRoot(repo: string) -> string`: the absolute-path check plus `rev-parse --show-toplevel`, extracted from `preview()` with the same error messages. `preview()` now calls it.
  - `tags(repo: string) -> string[]`: `git tag --list --sort=-creatordate` from `repoRoot(repo)`, first 20, `[]` if none.
  - `history(outputRoot = OUTPUT_ROOT) -> Array<{ dir, environment, tag, target, base, baseSha, targetSha, zipName, files: number, deleted: number, zipBytes: number|null, createdAt }>`: looks at subfolders matching `/^(prod|staging)-/`, parses `manifest.json` inside `try/catch` (skip on any failure), sorts by `createdAt` descending and keeps 50. Mark it with `// ponytail: reads every manifest per call; index file if output/ grows to thousands`.
  - `historyDir(dir: string, outputRoot = OUTPUT_ROOT) -> string`: returns `path.resolve(dir)` only when `path.dirname(resolved) === path.resolve(outputRoot)` and `manifest.json` exists there. Otherwise it throws `'Thư mục không thuộc lịch sử deploy.'`.
  - HTTP: `POST /api/tags {repo}` → `{ tags: string[] }`. `GET /api/history` → `{ builds: [...] }`. `POST /api/reveal {dir?}` opens `core.historyDir(dir)` if `dir` is given, else `currentBuild.dir`, and returns `{ dir }`.
  - `manifest.json` now includes `zipBytes`.

- [ ] **Step 1: Write the failing tests**

```js
test('tags lists newest first; history lists builds newest first and skips broken folders', () => {
  const f = fixture(); f.git('tag', '1.0.1');
  assert.deepEqual(tags(f.repo).slice(0, 2).sort(), ['1.0.0', '1.0.1']);
  assert.throws(() => tags('relative/path'), /tuyệt đối/);
  const out = path.join(f.repo, 'out');
  const first = build(preview(f.request), { outputRoot: out, acknowledgeDeletes: true });
  const second = build(preview({ ...f.request, environment: 'staging' }), { outputRoot: out, acknowledgeDeletes: true });
  fs.mkdirSync(path.join(out, 'prod-crashed')); // no manifest
  fs.mkdirSync(path.join(out, 'staging-corrupt')); fs.writeFileSync(path.join(out, 'staging-corrupt', 'manifest.json'), '{oops');
  const h = history(out);
  assert.deepEqual(h.map(x => x.dir), [second.dir, first.dir]);
  assert.equal(h[1].files, 3); assert.equal(h[1].tag, '1.1.0'); assert(h[1].zipBytes > 0);
  assert.equal(historyDir(first.dir, out), first.dir);
  for (const bad of [out, path.join(out, 'prod-crashed'), path.join(first.dir, '..', '..'), 'C:\\Windows']) assert.throws(() => historyDir(bad, out), /lịch sử/);
});
```

Import `tags, history, historyDir` next to the existing destructure at the top of `test.js`. Extend the existing HTTP test after the download assertion:

```js
  assert.deepEqual((await (await post('tags', { repo: f.repo })).json()).tags, ['1.0.0']);
  assert.equal((await fetch(url + '/api/history', { headers })).status, 200);
  assert.equal((await post('reveal', { dir: 'C:\\Windows' })).status, 400);
```

(The HTTP test builds into the real `OUTPUT_ROOT`, so assert only the status for history, not its contents. Never call reveal with a valid dir in tests because it spawns Explorer.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test.js`
Expected: FAIL (`tags is not a function`; tags route 404).

- [ ] **Step 3: Implement** the Produces list above in `core.js` and `server.js`. Add `'/api/tags'` to the POST allow-list and handle `GET /api/history` next to `/api/context`. Move `result.zipBytes = fs.statSync(zipPath).size;` above the `manifest.json` write.

- [ ] **Step 4: Run tests**

Run: `node --test test.js`
Expected: 10/10 PASS.

- [ ] **Step 5: Commit**

```bash
git add core.js server.js test.js
git commit -m "feat: recent tags, deploy history and history-scoped reveal"
```

---

### Task 3: Redesign shell (tokens, dark mode, new layout for existing flow)

**Files:**
- Rewrite: `public/app.css`
- Modify: `public/index.html`, `public/app.js`

**Interfaces:**
- Consumes: `preview.files[].added/removed` (Task 1).
- Produces (used by Tasks 4 and 5):
  - State in `app.js`: `preview`, `result`, `filter` (`'all'|'M'|'A'|'D'`), `lastNotice = { message, vars, error }`.
  - Idempotent renderers that read only state: `renderPreview()`, `renderFiles()`, `renderResult()`, `renderHeader()` (repo badge), `renderNotice()`. `notice(message, error = false, vars = {})` stores `lastNotice` and calls `renderNotice()`.
  - `let lang = 'vi'` and a `t(text, vars = {})` stub that for now returns `text` with `{name}` placeholders substituted (Task 5 adds EN lookup). **Every** user-visible string built in JS goes through `t()` with a **single-quoted** Vietnamese literal template as its first argument, e.g. `t('Đã kiểm tra {n} file. ZIP sẽ lấy từ commit {sha}.', { n, sha })`.
  - Static HTML text that needs translating sits alone in an element whose **last** attribute is the bare `data-i18n` (e.g. `<span class="x" data-i18n>Xem trước thay đổi</span>`), with no child elements. The Task 5 test's regex relies on this exact shape.
  - `<html data-theme>` is set by the theme button. The button id is `theme-toggle`.
  - Header placeholders for Task 4: `<button id="history-open">`, `<button id="rules-open">`, `<datalist id="tag-options">` linked from `#base` via `list="tag-options"`.

- [ ] **Step 1: Rewrite `app.css`** from `docs/DESIGN.md` §2–§6: the token table as custom properties (light on `:root`, dark in both the `[data-theme="dark"]` block and the `prefers-color-scheme` block), the components in §4, the grid and 900px/480px breakpoints in §5, and the transitions only in §6.

- [ ] **Step 2: Restructure `index.html`** into the DESIGN.md §4 order: sticky header → hero row → `#prod-banner` (hidden unless prod) → `#notice` → workspace grid (setup card 01 / review card 02) → footer. Keep every existing element id that `app.js` uses, except that `#deleted-box` / `#deleted-list` are **removed** (deleted paths now live in the file list under the "Đã xóa" tab). Add:
  - filter tabs `<div id="filter-tabs" role="tablist">` with four `<button data-filter="all|M|A|D">` whose count sits in a child `<span class="count">`
  - `#zip-copy` icon button next to `#zip-name`
  - `#repo-badge` in the header
  - `#base-hint` / `#target-hint` (mono "commit xxxxxxxx", filled after preview)
  - `#theme-toggle`
  - `#history-open`, `#rules-open` (inert until Task 4)
  - `<datalist id="tag-options">`

  Icons are small inline `<svg>` elements in the markup (allowed by the CSP), at most one per button, tile or badge in the design, no sprite system.

- [ ] **Step 3: Update `app.js`**:
  - Split the preview submit handler into state assignment + `renderPreview()`.
  - `renderFiles()` renders `preview.files` plus `preview.deleted` (as status `D`, no counts), filtered by `filter` and the search query. The dir part of each path is dimmed and the basename bold, followed by the `+N dòng • −N dòng` line or `binary` when counts are null.
  - Tab counts come from the unfiltered lists.
  - `renderHeader()` shows `basename(repo)` before a preview and `basename / target @ sha8` after.
  - Environment change toggles `#prod-banner`, `#tag-field` and `document.body.dataset.env`, which the CSS uses to make the preview button Ink in production.
  - `#zip-copy` calls `navigator.clipboard.writeText(preview.zipName)` and then shows `notice(t('Đã chép tên file ZIP.'))`.
  - The result section shows the real size (`zipBytes`).
  - `#theme-toggle` flips `data-theme`, persists `zd-theme`, and reads it on load (both in `try/catch`).

- [ ] **Step 4: Syntax check and existing tests**

Run: `node --check public/app.js && node --test test.js`
Expected: exit 0, 10/10 PASS.

- [ ] **Step 5: Browser check.** Run `node server.js --repo <fixture>`, using the path printed as `Browser fixture:` by `node --test test.js`, or any local repo with two tags. Open the printed URL in the built-in browser.
  - Staging preview with base `1.0.0`, target `HEAD`: 3 stat tiles show 3 / 1 / 0, the tabs read All (4) / Modified (1) / Added (2) / Deleted (1), and the delete ack appears.
  - Switch to Production: the amber banner, amber tag field and Ink preview button appear.
  - Toggle dark mode: no unreadable text and no white flashes on cards.
  - Resize to 390px: single column, no horizontal scroll.
  - Build ZIP: the result shows the real KB size.

- [ ] **Step 6: Commit**

```bash
git add public/app.css public/index.html public/app.js
git commit -m "feat: Stitch Deploy Studio layout with light/dark theme"
```

---

### Task 4: Tags picker, history dialog, rules dialog

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/app.css`

**Interfaces:**
- Consumes: `POST /api/tags`, `GET /api/history`, `POST /api/reveal {dir}` (Task 2); `preview.ignoreRules`, `preview.excluded` (Task 1); `t()`, `notice()`, `work()` (Task 3).
- Produces: `<dialog id="history-dialog">` and `<dialog id="rules-dialog">`, each closed by a `<form method="dialog">` button.

- [ ] **Step 1: Tags picker.** On `#repo` `change` (and once after `/api/context` fills it), call `api('tags', { repo })` and fill `#tag-options` with `<option value>` elements. On error, silently empty the datalist: this is a convenience, not a notice. It must not call `invalidate()`.
- [ ] **Step 2: History dialog.** `#history-open` → `api('history')` → one row per build: env badge, `tag || target` in mono, `baseSha8 → targetSha8`, `t('{n} file', { n })`, `t('{n} file cần xóa', …)` if >0, size in KB (or `—` when null), `createdAt` via `toLocaleString(lang === 'en' ? 'en-GB' : 'vi-VN')`, and a secondary "Mở thư mục" button that calls `api('reveal', { dir })`. The empty state is `t('Chưa có bản đóng gói nào trong output/.')`. Then `showModal()`.
- [ ] **Step 3: Rules dialog.** `#rules-open` → `showModal()` of a static explainer. It has two lists: the built-in excluded folders and files (static text copied from the `excluded()` regex, as `<code>` chips) and "Quy tắc từ .zipignore (commit đích)", filled from `preview.ignoreRules`. With no preview the list shows `t('Xem trước thay đổi để đọc .zipignore từ commit đích.')`, and with an empty rules array it shows `t('Commit đích không có .zipignore.')`. Rules starting with `!` get a muted suffix `t('(bị bỏ qua: không thể bỏ loại trừ)')`. One sentence states that `.zipignore` can only add exclusions and never unblocks sensitive files.
- [ ] **Step 4: Check**

Run: `node --check public/app.js && node --test test.js`
Expected: exit 0, 10/10 PASS. Then in the browser: the base field suggests `1.0.0`; after one build, History lists it and "Mở thư mục" opens Explorer; add a `.zipignore` commit to the fixture and the Rules dialog lists its rules.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/app.css
git commit -m "feat: recent-tag picker, deploy history and exclusion rules dialogs"
```

---

### Task 5: VI / EN switch

**Files:**
- Create: `public/i18n.js`
- Modify: `public/index.html` (script tag before `app.js`, both `defer`), `public/app.js`, `server.js` (add `'/i18n.js': ['i18n.js', 'text/javascript']` to `assets`)
- Test: `test.js`

**Interfaces:**
- Consumes: `t()` call sites, `data-i18n` markup and renderers from Tasks 3 and 4.
- Produces: the global `EN` object (`{ [viTemplate]: enTemplate }`), exported with `if (typeof module !== 'undefined') module.exports = EN;` as the last line. `t()` returns `(lang === 'en' && EN[text]) || text`, then substitutes `{vars}`.

- [ ] **Step 1: Write the failing completeness test**

```js
test('every Vietnamese UI string has an English translation', () => {
  const EN = require('./public/i18n.js');
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const html = read('public/index.html'), js = read('public/app.js'), backend = read('core.js') + read('server.js') + js;
  const keys = [
    ...[...html.matchAll(/data-i18n>([^<]+)</g)].map(m => m[1].trim()),
    ...[...html.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)].map(m => m[1]),
    ...[...js.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]),
    ...[...backend.matchAll(/(?:new Error|error:)\s*\(?'([^']+)'/g)].map(m => m[1]),
  ];
  const missing = [...new Set(keys)].filter(k => !(k in EN));
  assert.deepEqual(missing, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test.js`
Expected: FAIL (`Cannot find module './public/i18n.js'`).

- [ ] **Step 3: Implement**
  - Create `public/i18n.js` with an entry for every key the test lists. Use the DESIGN.md §8 table where it covers a string, and plain developer English otherwise (no "seamless"/"zero-risk").
  - In `app.js`, `applyLang()` sets `document.documentElement.lang`. For each `[data-i18n]` it does `el.dataset.vi ??= el.textContent.trim(); el.textContent = t(el.dataset.vi)`, and handles `placeholder` / `aria-label` / `title` the same way through `data-vi-<attr>` stores. It then re-runs `renderHeader()`, `renderNotice()`, `preview && renderPreview()` and `result && renderResult()`.
  - The `#lang-vi` / `#lang-en` buttons set `lang`, persist `zd-lang` and call `applyLang()`. Call it once on load.
  - Server errors already pass through `notice(e.message, true)` → `t()`. Interpolated backend messages (git stderr, `Đóng ZIP thất bại: …`, `Đã push tag …`) stay Vietnamese: add `// ponytail: interpolated backend errors stay VI; add error codes if EN users hit them`.

- [ ] **Step 4: Run tests and check**

Run: `node --test test.js && node --check public/app.js public/i18n.js`
Expected: 11/11 PASS. In the browser, switching to EN after a preview translates the header, cards, tabs, notice, file-line units ("+1 lines") and dialogs. A reload keeps EN and dark mode.

- [ ] **Step 5: Commit**

```bash
git add public/i18n.js public/index.html public/app.js server.js test.js
git commit -m "feat: Vietnamese/English language switch"
```

---

### Task 6: README and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**:
  - Usage mentions the theme and language toggles, the Base tag suggestions and the filter tabs.
  - A new **Deploy history** section: it reads `output/*/manifest.json`, and deleting a folder removes it from history.
  - A new **.zipignore** section: it is read from the target commit, patterns are root-anchored, `*` matches within a segment and `**` across segments, `!` lines are ignored, and it can only add exclusions.
  - Update the button names that changed.
- [ ] **Step 2: Full verification**

Run: `node --test test.js && git diff --check`
Expected: 11/11 PASS, no whitespace errors. Then run the Task 3 Step 5 browser pass once more in both languages and both themes at 1280px and 390px.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document redesign, deploy history and .zipignore"
```
