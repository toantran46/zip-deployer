const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="app-token"]').content;
let preview, result, busy = false, stopped = false, filter = 'all', lang = 'vi', lastNotice = null;
const store = { get: key => { try { return localStorage.getItem(key); } catch { return null; } }, set: (key, value) => { try { localStorage.setItem(key, value); } catch {} } };
// Keys are the Vietnamese source strings (EN lives in i18n.js); {name} placeholders are filled from vars.
// ponytail: interpolated backend errors (git stderr, "Đóng ZIP thất bại: …", "Đã push tag …") stay Vietnamese; add error codes if EN users hit them.
function t(text, vars = {}) { return String((lang === 'en' && EN[text]) || text).replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m); }
const locale = () => lang === 'en' ? 'en-GB' : 'vi-VN';
const basename = p => p.split(/[\\/]/).filter(Boolean).pop() || p;
const sha8 = sha => sha.slice(0, 8);
const kind = status => status === 'A' || status === 'D' ? status : 'M';
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
async function api(route, body) {
  const response = await fetch(`/api/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-App-Token': token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) { if (data.error) throw new Error(data.error); throw new Error('Thao tác thất bại.'); }
  return data;
}
function notice(message, error = false, vars = {}) { lastNotice = { message, error, vars }; renderNotice(); }
function renderNotice() {
  $('notice').hidden = !lastNotice;
  if (!lastNotice) return;
  $('notice-text').textContent = t(lastNotice.message, lastNotice.vars);
  $('notice').classList.toggle('error', lastNotice.error);
}
function updateButtons() {
  if (stopped) { document.querySelectorAll('button,input').forEach(x => x.disabled = true); return; }
  $('preview-button').disabled = busy;
  $('build').disabled = busy || !preview || preview.blocked.length > 0 || !preview.files.length || (preview.deleted.length > 0 && !$('ack').checked);
  $('publish').disabled = busy || !result || !$('publish-ack').checked;
  for (const id of ['reveal', 'download', 'shutdown']) $(id).disabled = busy;
  for (const x of $('release-form').elements) x.disabled = busy;
}
async function work(message, fn) {
  if (busy) return;
  busy = true; updateButtons(); notice(message);
  try { await fn(); } catch (e) { notice(e.message, true); }
  finally { busy = false; updateButtons(); }
}
function list(id, entries) { $(id).replaceChildren(...entries.map(text => el('li', '', text))); }
const env = () => document.querySelector('[name="environment"]:checked').value;
function renderEnv() {
  const prod = env() === 'prod';
  document.body.dataset.env = prod ? 'prod' : 'staging';
  $('prod-banner').hidden = !prod; $('tag-field').hidden = !prod; $('tag').required = prod;
}
function renderHeader() {
  const repo = preview ? preview.repo : $('repo').value.trim();
  $('repo-badge').hidden = !repo;
  $('repo-badge-text').textContent = preview ? `${basename(repo)} / ${preview.target} @ ${sha8(preview.targetSha)}` : basename(repo);
}
function fileRow(file) {
  const k = kind(file.status), row = el('div', 'file-row'), body = el('div', 'file-body'), name = el('code', 'file-path');
  const badge = el('span', `file-status s-${k}`, k);
  badge.title = k === 'A' ? t('Thêm mới') : k === 'D' ? t('Đã xóa') : t('Chỉnh sửa');
  const cut = file.path.lastIndexOf('/') + 1;
  name.append(el('span', 'file-dir', file.path.slice(0, cut)), el('strong', '', file.path.slice(cut)));
  const lines = el('span', 'file-lines');
  if (k === 'D') lines.textContent = t('Không nằm trong ZIP, xử lý riêng trên hosting');
  else if (file.added === null || file.added === undefined) lines.textContent = t('nhị phân');
  else lines.append(el('span', 'add', `+${file.added} ${t('dòng')}`), ' • ', el('span', 'del', `−${file.removed} ${t('dòng')}`));
  body.append(name, lines); row.append(badge, body);
  return row;
}
function renderFiles() {
  if (!preview) return;
  const entries = [...preview.files, ...preview.deleted.map(path => ({ path, status: 'D' }))];
  const matches = (x, f) => f === 'all' || kind(x.status) === f;
  for (const tab of $('filter-tabs').querySelectorAll('[data-filter]')) {
    tab.querySelector('.count').textContent = `(${entries.filter(x => matches(x, tab.dataset.filter)).length})`;
    tab.setAttribute('aria-selected', tab.dataset.filter === filter);
  }
  const query = $('filter').value.toLocaleLowerCase();
  const shown = entries.filter(x => matches(x, filter) && x.path.toLocaleLowerCase().includes(query));
  $('file-list').replaceChildren(...shown.map(fileRow));
  if (!shown.length) $('file-list').append(el('p', 'no-files', t('Không có file phù hợp.')));
}
function renderPreview() {
  $('empty').hidden = !!preview; $('preview').hidden = !preview;
  $('environment-badge').hidden = !preview; $('commit-range').hidden = !preview;
  $('base-hint').textContent = preview ? `commit ${sha8(preview.baseSha)}` : '';
  $('target-hint').textContent = preview ? `commit ${sha8(preview.targetSha)}` : '';
  $('tree-state').textContent = !preview ? '' : preview.dirty ? t('có thay đổi chưa commit (không vào ZIP)') : t('cây làm việc sạch');
  $('tree-state').classList.toggle('warn', Boolean(preview && preview.dirty));
  renderHeader();
  if (!preview) return;
  $('environment-badge').textContent = preview.environment === 'prod' ? 'Production' : 'Staging';
  $('environment-badge').className = `badge ${preview.environment}`;
  $('commit-range').textContent = `${sha8(preview.baseSha)} → ${sha8(preview.targetSha)}`;
  $('file-count').textContent = preview.files.length; $('delete-count').textContent = preview.deleted.length; $('blocked-count').textContent = preview.blocked.length;
  $('zip-name').textContent = preview.zipName;
  $('blocked-box').hidden = !preview.blocked.length; list('blocked-list', preview.blocked.map(x => `${x.path}: ${t(x.reason)}`));
  $('delete-ack').hidden = !preview.deleted.length;
  $('excluded-box').hidden = !preview.excluded.length; $('excluded-title').textContent = t('{n} file công cụ / tài liệu không đóng gói', { n: preview.excluded.length }); list('excluded-list', preview.excluded);
  renderFiles();
}
function renderResult() {
  $('result').hidden = !result;
  if (!result) return;
  $('result-name').textContent = result.zipName;
  $('result-meta').textContent = t('{n} file · {size} KB · commit {sha}', { n: result.files.length, size: (result.zipBytes / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 }), sha: sha8(result.targetSha) });
  $('result-path').textContent = result.zipPath;
  $('delete-reminder').hidden = !result.deleted.length;
  $('publish-box').hidden = result.environment !== 'prod';
  $('publish-copy').textContent = t('Tag {tag} sẽ trỏ đến commit {sha} và được push lên origin. Thao tác này không deploy lên hosting.', { tag: result.tag, sha: sha8(result.targetSha) });
}
function invalidate() {
  preview = null; result = null; lastNotice = null;
  renderEnv(); renderPreview(); renderResult(); renderNotice(); updateButtons();
}
let refs = [];
// Suggestions only: a failure leaves the list empty. A late answer for a repo the field no longer shows is dropped.
async function loadRefs({ showErrors = false } = {}) {
  const repo = $('repo').value.trim();
  refs = [];
  if (!repo) return;
  try { const data = await api('refs', { repo }); if ($('repo').value.trim() === repo) refs = data.refs; }
  catch (e) { if (showErrors) notice(e.message, true); }
}
const kindLabel = kind => kind === 'branch' ? t('nhánh') : kind === 'remote' ? t('nhánh remote') : t('tag');
// ARIA combobox over `refs`: names starting with the query first, then other matches, newest first within each.
function combobox(input) {
  const list = $(`${input.id}-list`);
  let count = 0, active = -1;
  const setActive = i => {
    active = i;
    [...list.children].forEach((li, n) => li.setAttribute('aria-selected', n === i));
    if (i < 0) input.removeAttribute('aria-activedescendant');
    else { input.setAttribute('aria-activedescendant', list.children[i].id); list.children[i].scrollIntoView({ block: 'nearest' }); }
  };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); setActive(-1); };
  const open = () => {
    const q = input.value.trim().toLowerCase(), starts = r => r.name.toLowerCase().startsWith(q);
    const hits = refs.filter(r => r.name.toLowerCase().includes(q));
    const shown = [...hits.filter(starts), ...hits.filter(r => !starts(r))].slice(0, 50);
    count = shown.length;
    if (!count) return close();
    list.replaceChildren(...shown.map((r, i) => {
      const li = el('li'), name = el('span', 'combo-name'), at = r.name.toLowerCase().indexOf(q);
      li.id = `${input.id}-opt-${i}`; li.setAttribute('role', 'option'); li.dataset.name = r.name;
      name.append(r.name.slice(0, at), el('strong', '', r.name.slice(at, at + q.length)), r.name.slice(at + q.length));
      li.append(name, el('span', 'combo-kind', kindLabel(r.kind)));
      return li;
    }));
    list.style.top = `${input.offsetTop + input.offsetHeight + 4}px`;
    list.hidden = false; input.setAttribute('aria-expanded', 'true'); setActive(-1);
  };
  const pick = li => { input.value = li.dataset.name; close(); invalidate(); };
  input.addEventListener('focus', open);
  input.addEventListener('input', open);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) open();
      if (!count) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(active < 0 ? (step > 0 ? 0 : count - 1) : (active + step + count) % count);
    } else if (e.key === 'Enter' && !list.hidden && active >= 0) { e.preventDefault(); pick(list.children[active]); }
    else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close();
  });
  list.addEventListener('mousedown', e => { e.preventDefault(); const li = e.target.closest('li'); if (li) pick(li); });
}
let builds = null;
function historyRow(build) {
  const row = el('div', 'history-row'), main = el('div', 'history-main'), title = el('div', 'history-title');
  title.append(el('span', `badge ${build.environment}`, build.environment === 'prod' ? 'Production' : 'Staging'), el('code', '', build.tag || build.target));
  const meta = [`${sha8(build.baseSha)} → ${sha8(build.targetSha)}`, t('{n} file', { n: build.files })];
  if (build.deleted) meta.push(t('{n} file cần xóa', { n: build.deleted }));
  meta.push(build.zipBytes === null ? '—' : `${(build.zipBytes / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 })} KB`, new Date(build.createdAt).toLocaleString(locale()));
  main.append(title, el('span', 'history-meta', meta.join(' · ')));
  const open = el('button', 'button secondary', t('Mở thư mục')); open.type = 'button';
  open.onclick = () => api('reveal', { dir: build.dir }).catch(e => { $('history-dialog').close(); notice(e.message, true); });
  row.append(main, open);
  return row;
}
function renderHistory() {
  if (!builds) return;
  $('history-list').replaceChildren(...(builds.length ? builds.map(historyRow) : [el('p', 'no-files', t('Chưa có bản đóng gói nào trong output/.'))]));
}
function renderRules() {
  const rules = preview ? preview.ignoreRules : null;
  list('rules-list', !rules ? [t('Xem trước thay đổi để đọc .zipignore từ commit đích.')] : !rules.length ? [t('Commit đích không có quy tắc .zipignore.')] : rules.map(rule => rule.startsWith('!') ? `${rule} ${t('(bị bỏ qua: không thể bỏ loại trừ)')}` : rule));
}
function applyLang() {
  document.documentElement.lang = lang;
  for (const code of ['vi', 'en']) $(`lang-${code}`).setAttribute('aria-pressed', lang === code);
  for (const node of document.querySelectorAll('[data-i18n]')) { node.dataset.vi ??= node.textContent.trim(); node.textContent = t(node.dataset.vi); }
  for (const attr of ['placeholder', 'aria-label', 'title']) {
    const key = 'vi' + attr.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
    for (const node of document.querySelectorAll(`[${attr}]`)) { node.dataset[key] ??= node.getAttribute(attr); node.setAttribute(attr, t(node.dataset[key])); }
  }
  renderHeader(); renderNotice(); renderPreview(); renderResult(); renderHistory();
  if ($('rules-dialog').open) renderRules();
}
function setLang(code) { lang = code; store.set('zd-lang', code); applyLang(); }
const THEMES = ['system', 'light', 'dark'];
// "system" drops data-theme so the CSS prefers-color-scheme block follows Windows live.
function applyTheme(mode) {
  if (!THEMES.includes(mode)) mode = 'system';
  if (mode === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
  for (const m of THEMES) $(`theme-${m}`).setAttribute('aria-pressed', m === mode);
}

$('release-form').addEventListener('input', invalidate);
$('release-form').addEventListener('submit', e => {
  e.preventDefault();
  work('Đang đọc thay đổi từ Git…', async () => {
    preview = null; result = null; renderPreview(); renderResult();
    preview = await api('preview', { repo: $('repo').value.trim(), base: $('base').value.trim(), target: $('target').value.trim(), environment: env(), tag: $('tag').value.trim() });
    filter = 'all'; $('filter').value = ''; $('ack').checked = false; $('publish-ack').checked = false;
    renderPreview();
    if (preview.blocked.length) notice('Có file bị chặn. Kiểm tra danh sách trước khi tiếp tục.', true);
    else notice('Đã kiểm tra {n} file. ZIP sẽ lấy từ commit {sha}.', false, { n: preview.files.length, sha: sha8(preview.targetSha) });
  });
});
$('filter').addEventListener('input', renderFiles);
$('filter-tabs').addEventListener('click', e => { const tab = e.target.closest('[data-filter]'); if (tab) { filter = tab.dataset.filter; renderFiles(); } });
$('ack').addEventListener('change', updateButtons);
$('publish-ack').addEventListener('change', updateButtons);
$('zip-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(preview.zipName); notice('Đã chép tên file ZIP.'); }
  catch { notice('Không chép được. Hãy chọn và chép tên file thủ công.', true); }
};
$('build').onclick = () => work('Đang đóng ZIP và xác minh nội dung từng file…', async () => {
  result = await api('build', { id: preview.id, acknowledgeDeletes: $('ack').checked });
  $('publish-ack').checked = false;
  renderResult();
  notice('Đã tạo và xác minh ZIP. Mở thư mục kết quả để upload.');
  $('result').scrollIntoView({ behavior: 'auto', block: 'nearest' });
});
$('reveal').onclick = () => work('Đang mở thư mục…', async () => { const data = await api('reveal', {}); notice('Thư mục kết quả: {dir}', false, { dir: data.dir }); });
$('download').onclick = () => work('Đang chuẩn bị tải ZIP…', async () => {
  const response = await fetch('/api/download', { headers: { 'X-App-Token': token } });
  if (!response.ok) throw new Error('Không tải được ZIP. Hãy mở thư mục kết quả.');
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = result.zipName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); notice('Đã gửi ZIP đến trình tải xuống của trình duyệt.');
});
$('publish').onclick = () => work('Đang tạo / kiểm tra và push tag…', async () => { const data = await api('publish', { id: result.id, confirmTag: result.tag }); $('publish-ack').checked = false; notice(data.message); });
$('shutdown').onclick = () => work('Đang dừng app…', async () => { const data = await api('shutdown', {}); stopped = true; notice(data.message); });
$('repo').addEventListener('change', () => loadRefs());
$('browse').onclick = () => work('Đang mở hộp chọn thư mục…', async () => {
  const picked = (await api('pick-folder', { start: $('repo').value.trim() })).path;
  if (!picked) { lastNotice = null; renderNotice(); return; }
  $('repo').value = picked; invalidate(); renderHeader();
  await loadRefs({ showErrors: true });
});
combobox($('base')); combobox($('target'));
$('history-open').onclick = async () => {
  try { builds = (await api('history')).builds; renderHistory(); $('history-dialog').showModal(); } catch (e) { notice(e.message, true); }
};
$('rules-open').onclick = () => { renderRules(); $('rules-dialog').showModal(); };
for (const m of THEMES) $(`theme-${m}`).onclick = () => { store.set('zd-theme', m); applyTheme(m); };

$('lang-vi').onclick = () => setLang('vi');
$('lang-en').onclick = () => setLang('en');

applyTheme(store.get('zd-theme'));
lang = store.get('zd-lang') === 'en' ? 'en' : 'vi';
invalidate(); applyLang();
api('context').then(data => { $('repo').value = data.repo || ''; renderHeader(); loadRefs(); }).catch(e => notice('Không kết nối được app: {error}', true, { error: e.message }));
