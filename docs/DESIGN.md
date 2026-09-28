# Design System: Zip Deployer (Stitch redesign)

Source: Stitch project "Hosting Deploy Zip Generator" (screens *Redesign*, *Bilingual & Dark/Light Theme*, *Production Mode*). The *SSH Host Mode* screen is out of scope, so there is no SSH toggle, SSH badge or remote console.

## 1. Visual Theme & Atmosphere
A calm developer desk tool in the style of Linear, Vercel or GitHub Desktop. It has two working panes, crisp 1px borders, soft cards on a slate canvas and one emerald accent. Density is "Daily App Balanced" (5), variance is low (3) because this is a form-and-review utility, not a marketing page, and motion is "Static Restrained" (2). The mood is careful and confident: staging and production should never be confused, and every number should be readable at a glance.

## 2. Color Palette & Roles
Tokens live on `:root`. Dark values apply under `:root[data-theme="dark"]` and under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])`.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` Slate Canvas | `#F8FAFC` | `#0B0F17` | Page background |
| `--surface` Pure Surface | `#FFFFFF` | `#111827` | Header, cards, footer |
| `--surface-2` Inset Wash | `#F1F5F9` | `#182234` | Inset boxes (diff box, stat tiles, tabs track) |
| `--line` Whisper Border | `#E2E8F0` | `#26354D` | All 1px structure lines |
| `--text` Ink | `#0F172A` | `#E2E8F0` | Primary text |
| `--muted` Steel | `#64748B` | `#94A3B8` | Helper text, metadata, dim path segments |
| `--accent` Forest Emerald | `#006341` | `#059669` | Primary buttons, active tab, focus ring, links |
| `--accent-soft` Mint Wash | `#ECFDF5` | `#052E22` | Success notice, staging badge, "A" badge bg |
| `--accent-line` Mint Line | `#A7F3D0` | `#065F46` | Borders of accent-soft surfaces |
| `--warn` Amber Ink | `#B45309` | `#FBBF24` | Production text, "M" badge, delete stat |
| `--warn-soft` Amber Wash | `#FFFBEB` | `#2A1F05` | Production banner, prod badge, tag field |
| `--warn-line` Amber Line | `#FCD34D` | `#78520A` | Production banner and tag-field border |
| `--danger` Signal Red | `#DC2626` | `#F87171` | Errors, blocked callout, "D" badge, removed lines |
| `--danger-soft` | `#FEF2F2` | `#2B1111` | Error notice and blocked callout bg |
| `--add` Added Green | `#059669` | `#34D399` | "+N dòng" line counts |

Emerald is the only brand accent. Amber and red are status colors only. Never use pure black, purple or neon glows.

## 3. Typography Rules
The app is offline and the CSP forbids external fonts, so it uses system stacks only.
- **Sans:** `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`. H1 is 32px/650, letter-spacing -0.02em. Card titles are 17px/650. Body is 14px, line-height 1.5.
- **Mono:** `"Cascadia Mono", Consolas, monospace`. Use it for paths, SHAs, tags, ZIP names, line counts and the repo badge.
- **Labels:** 12px, uppercase, letter-spacing 0.06em, `--muted`. Examples: "MÔI TRƯỜNG TRIỂN KHAI", "SO SÁNH THAY ĐỔI (GIT DIFF)", "TÊN FILE ZIP SẼ TẠO".
- Hierarchy comes from weight and color, not size jumps. Do not use Inter or serif fonts.

## 4. Component Stylings
- **Header (sticky, 72px, `--surface`, bottom line):** brand mark, a "Zip Deployer" wordmark and a mint "DEPLOY STUDIO"-style pill. Then a divider and the repo badge: a green dot plus mono `repo / target @ sha8`, or only the repo folder name before a preview. On the right: ghost buttons "Lịch sử deploy" and ".zipignore", a VI|EN segmented control, a theme icon button and the existing "Dừng app" text button.
- **Hero row:** H1 "Từ commit đến gói deploy." with a one-line subtitle on the left and the mono workflow chip "Git → Kiểm tra → Đóng gói ZIP" on the right. It is left-aligned, never centered.
- **Production banner:** full width, `--warn-soft` bg, `--warn-line` border, radius 12px, shield tile and bold amber lead "CHẾ ĐỘ PRODUCTION (TRỰC TIẾP):". It is shown only while production is selected.
- **Notice:** a full-width strip with a check or alert tile. Success uses mint colors, errors use danger-soft colors.
- **Cards:** `--surface`, 1px `--line`, radius 16px, no shadow in dark mode and at most `0 1px 2px rgb(15 23 42 / .04)` in light mode. The card header has a step chip (`01`/`02` mono on `--surface-2`), a title and a right-side meta item, followed by a bottom line.
- **Segmented env control:** track `--surface-2`, radius 12px. The active pill is `--surface` with a colored dot (staging uses `--accent`, production uses `--warn`), and the active production pill gets a `--warn-line` border.
- **Inputs:** 40px high, radius 10px, 1px `--line` and mono value text. The label sits above and the helper text below in `--muted`. Focus shows a 2px `--accent` outline. The production tag input uses a `--warn-line` border and a "PRODUCTION" micro-badge beside its label. The repository input shares its row with a secondary **Browse…** button (8px gap) that opens the native Windows "Select folder" dialog.
- **Ref combobox (Base / Target):** a popup 4px under the input with `--surface`, a 1px `--line` border, radius 10px and `--shadow-pop` (the only floating shadow). Rows are mono 13px with the matched part bold and a muted 11px kind label (branch / remote / tag) on the right. The active and hovered row uses `--accent-soft` with `--accent` text. At most 50 rows; the list scrolls past 320px.
- **Buttons:** radius 10px, 40px high, 600 weight. Primary uses `--accent` with white text. In production the preview button is Ink (`--text` bg, `--surface` text) so the two environments look different. Secondary is `--surface` with a 1px line. Active state is `translateY(1px)`. There are no glows.
- **Stat tiles (3 in a row inside the review card, not page-level cards):** `--surface-2` with a 1px line, a big 26px number, a muted caption, and an icon tile at the right in mint, amber or slate.
- **Filter tabs:** text tabs "Tất cả (n) / Chỉnh sửa (n) / Thêm mới (n) / Đã xóa (n)". The active tab is `--surface` with a 1px line. A search input sits on the right.
- **File rows:** a 28px square status badge (M uses the amber palette, A the mint palette, D the danger palette), then the path in mono with the directory in `--muted` and the basename bold. The second line is mono `+N dòng • −N dòng` in `--add` / `--danger`, or `binary` in muted. Rows are separated by 1px lines and no cards.
- **Build footer:** the label "TÊN FILE ZIP SẼ TẠO", a mono ZIP name with a copy icon button, and the primary "Tạo ZIP" button on the right.
- **Dialogs (`<dialog>`):** `--surface`, radius 16px, max-width 720px, backdrop `rgb(15 23 42 / .5)`.
- **Empty state:** keep the current composition (symbol, headline, three check chips) restyled with the tokens.

## 5. Layout Principles
- `main` max-width 1400px, side padding `clamp(16px, 4vw, 40px)`.
- The workspace grid is `minmax(0, 2fr) minmax(0, 3fr)` with a 24px gap. The setup card is on the left and the review card on the right.
- Below 900px everything becomes a single column: the header wraps its actions onto a second row, the stat tiles stay 3-up down to 480px and then stack, and there is no horizontal scroll (long paths wrap with `overflow-wrap: anywhere`).
- Touch targets are at least 40px. No element overlaps another.

## 6. Motion & Interaction
- Only `background-color`, `border-color` and `color` transitions (150ms ease-out) on interactive elements, plus the 1px press translate. There are no looping animations, and `prefers-reduced-motion` needs no special case because nothing moves.

## 7. Anti-Patterns (Banned)
No emojis, no Inter, no serif, no pure black, no neon or outer glows, no gradient text, no custom cursors, no inline `style=""` attributes (the CSP forbids them), no external fonts or CDNs, no fake numbers (a size appears only after a real build), no decorative checkboxes that do nothing (Stitch's "backup commit", "rollback script", "deploy checklist log" and "PHP lint" options are dropped), and no AI copy clichés ("zero-risk", "seamless", "guarantee").

## 8. Copy (VI → EN)
Vietnamese is the default. EN comes from the Stitch bilingual spec, toned down where it overclaims.

| VI | EN |
|---|---|
| Từ commit đến gói deploy. | From commit to deploy package. |
| Chọn phiên bản, kiểm tra thay đổi và tạo ZIP sẵn sàng upload. | Pick versions, review changes and build an upload-ready ZIP. |
| Lịch sử deploy | Deploy history |
| Thiết lập bản phát hành | Release setup |
| Môi trường triển khai | Deployment environment |
| Staging (Thử nghiệm) / Production (Trực tiếp) | Staging (Test) / Production (Live) |
| Thư mục repository Git | Git repository folder |
| So sánh thay đổi (Git diff) | Compare changes (Git diff) |
| Phiên bản đang trên hosting (Base) | Version live on hosting (Base) |
| Branch / tag / commit cần đóng gói (Target) | Branch / tag / commit to package (Target) |
| Tag production mới | New production tag |
| Xem trước thay đổi | Preview changes |
| Đúng phiên bản bạn chọn. | Exactly the version you chose. |
| Kiểm tra gói deploy | Inspect deploy package |
| file đóng gói / file cần xóa / file bị chặn | files packaged / files to delete / files blocked |
| Tất cả / Chỉnh sửa / Thêm mới / Đã xóa | All / Modified / Added / Deleted |
| Lọc đường dẫn… | Filter paths… |
| Tên file ZIP sẽ tạo | ZIP file to create |
| Tạo ZIP | Build ZIP |
| Chế độ production (trực tiếp): | Production mode (live): |
| Dừng app | Stop app |
| Đóng gói tại máy · Upload theo quy trình của bạn | Packaged locally · Upload using your own process |
