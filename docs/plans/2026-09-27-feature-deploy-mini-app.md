# Deploy mini app implementation plan

**Status:** completed
**Router:** feature (direct user request)
**Created / Updated:** 2026-09-27
**Canonical plan:** `docs/plans/2026-09-27-feature-deploy-mini-app.md`

## Goal and source
Replace the user's HTML copy/paste workflow with a local Windows mini app: preview Git changes, package exact committed files, verify ZIP paths/content, and optionally create/push a release tag. Source: user-approved proposal and the previous standalone HTML helper (`wordpress-cpanel-deploy-helper-updated.html`).

## Scope / approach
Standalone `tools/deploy-helper`, Node.js built-ins for localhost HTTP and Git subprocesses, Windows PowerShell/.NET for ZIP creation and verification, native HTML/CSS/JS. No dependencies, WordPress integration, upload, extraction, DB operations, production deploy, or automatic tag/push. Existing HTML stays untouched. Runtime needs Node.js, Git, Windows PowerShell, already found on this host. Python alias is unavailable, so no Python dependency.

Design: light neutral workspace, green accent, Segoe UI + Consolas, low motion (variance 4 / motion 2 / density 5), form and review pane. Apply the user-invoked design-taste skill contextually; marketing sections and React defaults do not fit this utility.

## Evidence / behavior contract
- HTML lines 157/244 lose one escape layer in JS template strings, yielding an invalid PowerShell regex.
- Lines 138/225 copy current working files instead of selected Git commit contents.
- ZIP extraction cannot remove deleted/renamed source paths.
- Resolve refs to immutable SHAs, read blobs from Git, preserve slash paths and binary bytes. Reject unsafe paths, symlinks/submodules and sensitive content paths. Separate tooling exclusions from blocked files; never silently drop blocked files.
- Preview is read-only. Build requires reviewed preview and explicit acknowledgment of deletes. Publish is separate, never overwrites a tag, and pushes only the selected tag to origin.
- Bind loopback only; require Host/Origin checks and random token for API; fixed static routes, no arbitrary shell interpolation, no general file serving.

## CodeGraph / impact
Not used: standalone new tool, no application callers or existing ownership boundary changes. Direct inspection established the external HTML flow. Existing worktree initially clean (Git global-ignore read warning only).

## Files
- `tools/deploy-helper/core.js`: Git preview, immutable packaging, publish.
- `tools/deploy-helper/zip.ps1`: create ZIP with slash paths and read-back hashes.
- `tools/deploy-helper/server.js`: authenticated localhost endpoints, launch lifecycle.
- `tools/deploy-helper/public/index.html`, `app.css`, `app.js`: Vietnamese UI.
- `tools/deploy-helper/start.cmd`, `start.ps1`: double-click hidden launch and browser opening.
- `tools/deploy-helper/test.js`: real temporary Git repository regression tests.
- `tools/deploy-helper/README.md`, `.gitignore`: usage and generated-output exclusions.

## Tasks / commands
- [x] RED: `rtk proxy node --test tools/deploy-helper/test.js`; initial failure because core module was not yet implemented. Later Windows-invalid-path regression failed on the explicit blocked-path assertion before the fix.
- [x] GREEN: implement core and ZIP; same command passes against disposable repositories, no real project tag/push.
- [x] Implement local server/UI and launcher; `rtk proxy node --check tools/deploy-helper/server.js` and `rtk proxy node --check tools/deploy-helper/public/app.js` pass.
- [x] Verify HTTP access controls and real browser preview/build against disposable repository; inspect desktop and narrow layout.
- [x] Review security/correctness and acceptance separately; `rtk git diff --check`; reconcile this plan and documentation.

## Approval / safety
User approved creation with “ok tạo 1 mini app phục vụ cho việc trên” and named design-taste-frontend. This records approved functional scope; implementation choices stay within it. Test fixture commits/tags/local bare-remote pushes only. Real repo commit/push/deploy/DB writes not authorized or executed. Outputs use unique per-build directories; never recursively delete existing user directories. Remove new tool directory to undo source installation.

## Progress log
- 2026-09-27: inspected HTML and clean baseline; read design, plan, TDD and verification skills; began approved implementation.
- 2026-09-27: core fixture tests passed; extended HTTP test verifies no-token, wrong Origin/Host, stale preview, deletion acknowledgment, download byte equality and separate publish confirmation. Corrected the Host test to use node:http because fetch did not send the requested Host override.
- 2026-09-27: verified staging and production preview/build in Codex browser using temporary repository, result SHA-256 verification visible. Tested 1280px desktop and 390px narrow breakpoint; one column and no horizontal overflow at 390px. Form changes invalidate prior preview. Dừng app shuts down service and disables controls.
- 2026-09-27: launcher exposed duplicate Path/PATH inherited environment issue in Start-Process; replaced launch with ProcessStartInfo inheriting native environment, hidden window. Fresh hidden startup succeeded; subsequent start.cmd succeeded with the same PID/URL. Extra test service stopped.

## Decisions / deviations
- Native web UI with Node backend replaces proposed console menu to fulfill user's mini-app/UI request. PowerShell still owns ZIP processing.
- Execute inline; no subagents needed for this compact standalone tool.
- Existing Git ignore rules exclude Markdown documentation including this plan and tool README; files remain on disk and are not force-added. Tool runtime/output are excluded by its own .gitignore.

## Final verification / handoff
- `rtk proxy node --test tools/deploy-helper/test.js`: 7/7 pass, including real PowerShell ZIP read-back, immutable source commit after branch movement, symlink and Windows-invalid path blocking, and local bare-remote push. Git emits an existing permission warning for the user's global ignore file; commands/tests still pass.
- JS syntax checks and `rtk git diff --check`: exit 0. New untracked files additionally checked using git diff --no-index --check against NUL.
- `rtk proxy cmd.exe /c tools\\deploy-helper\\start.cmd`: exit 0; current instance unchanged on repeat, PID 39424, URL http://127.0.0.1:54161 at handoff.
- Actual files: all files listed in Files section plus this plan. App and README are under `tools/deploy-helper`; original HTML and WordPress source untouched.
- User handoff: double-click start.cmd, preview versions, create ZIP, open output directory. Each package includes deploy-files.txt, deleted-files.txt, manifest.json and read-back verification. Use the explicit optional publish control for real tags.
- No real project commit, tag, push, DB write, hosting upload or deploy. Remote authentication/hosting extraction remain unverified, outside this local packaging task. App remains running and open for user; Stop app ends it.

## Relocation 2026-09-28
User requested move to a standalone folder for a separate future repository. Moved 46 app files including ignored output/runtime, verified SHA-256 before/after, and moved this plan. Existing application edits in the original project untouched. Updated README commands for standalone root and left default repository input blank. Historical absolute paths in test manifests and prior evidence intentionally preserved. Git repository initialization is left to the user.
