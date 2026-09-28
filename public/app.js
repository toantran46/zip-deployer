const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="app-token"]').content;
let preview, result, busy = false, stopped = false, filter = 'all', lang = 'vi', lastNotice = null;
const store = { get: key => { try { return localStorage.getItem(key); } catch { return null; } }, set: (key, value) => { try { localStorage.setItem(key, value); } catch {} } };
// Keys are the Vietnamese source strings; {name} placeholders are filled from vars.
function t(text, vars = {}) { return String(text).replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m); }
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
function applyTheme(theme) { document.documentElement.dataset.theme = theme; $('theme-toggle').setAttribute('aria-pressed', theme === 'dark'); }

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
$('theme-toggle').onclick = () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; store.set('zd-theme', next); applyTheme(next); };

applyTheme(store.get('zd-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
invalidate();
api('context').then(data => { $('repo').value = data.repo || ''; renderHeader(); }).catch(e => notice('Không kết nối được app: {error}', true, { error: e.message }));
