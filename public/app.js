const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="app-token"]').content;
let preview, result, busy = false, stopped = false;
async function api(route, body) {
  const response = await fetch(`/api/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-App-Token': token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Thao tác thất bại.');
  return data;
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false; }
function updateButtons() {
  if (stopped) { document.querySelectorAll('button,input').forEach(x => x.disabled = true); return; }
  $('preview-button').disabled = busy;
  $('build').disabled = busy || !preview || preview.blocked.length > 0 || !preview.files.length || (preview.deleted.length > 0 && !$('ack').checked);
  $('publish').disabled = busy || !result || !$('publish-ack').checked;
  for (const id of ['reveal', 'download', 'shutdown']) $(id).disabled = busy;
  for (const el of $('release-form').elements) el.disabled = busy;
}
async function work(message, fn) {
  if (busy) return;
  busy = true; updateButtons(); notice(message);
  try { await fn(); } catch (e) { notice(e.message, true); }
  finally { busy = false; updateButtons(); }
}
function list(id, entries) {
  $(id).replaceChildren(...entries.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
}
function renderFiles() {
  const query = $('filter').value.toLocaleLowerCase();
  const files = preview.files.filter(x => x.path.toLocaleLowerCase().includes(query));
  $('file-list').replaceChildren(...files.map(file => {
    const row = document.createElement('div'); row.className = 'file-row';
    const status = document.createElement('span'); status.className = 'file-status'; status.textContent = file.status; status.title = file.status === 'A' ? 'Thêm mới' : 'Cập nhật';
    const name = document.createElement('code'); name.textContent = file.path; row.append(status, name); return row;
  }));
  if (!files.length) { const p = document.createElement('p'); p.className = 'no-files'; p.textContent = 'Không có file phù hợp.'; $('file-list').append(p); }
}
function invalidate() {
  preview = null; result = null;
  $('preview').hidden = true; $('result').hidden = true; $('empty').hidden = false; $('notice').hidden = true;
  const prod = document.querySelector('[name="environment"]:checked').value === 'prod';
  $('tag-field').hidden = !prod; $('tag').required = prod;
  updateButtons();
}
$('release-form').addEventListener('input', invalidate);
$('release-form').addEventListener('submit', e => {
  e.preventDefault();
  work('Đang đọc thay đổi từ Git…', async () => {
    result = null; preview = null; $('result').hidden = true; $('preview').hidden = true; $('empty').hidden = false;
    preview = await api('preview', { repo: $('repo').value.trim(), base: $('base').value.trim(), target: $('target').value.trim(), environment: document.querySelector('[name="environment"]:checked').value, tag: $('tag').value.trim() });
    $('empty').hidden = true; $('preview').hidden = false;
    $('environment-badge').textContent = preview.environment === 'prod' ? 'Production' : 'Staging';
    $('commit-range').textContent = `${preview.baseSha.slice(0, 8)} → ${preview.targetSha.slice(0, 8)}`;
    $('dirty').hidden = !preview.dirty;
    $('file-count').textContent = preview.files.length; $('delete-count').textContent = preview.deleted.length; $('blocked-count').textContent = preview.blocked.length;
    $('zip-name').textContent = preview.zipName;
    $('filter').value = ''; $('ack').checked = false;
    $('blocked-box').hidden = !preview.blocked.length; list('blocked-list', preview.blocked.map(x => `${x.path}: ${x.reason}`));
    $('deleted-box').hidden = !preview.deleted.length; $('delete-ack').hidden = !preview.deleted.length; list('deleted-list', preview.deleted);
    $('excluded-box').hidden = !preview.excluded.length; $('excluded-title').textContent = `${preview.excluded.length} file công cụ / tài liệu không đóng gói`; list('excluded-list', preview.excluded);
    renderFiles();
    notice(preview.blocked.length ? 'Có file bị chặn. Kiểm tra danh sách trước khi tiếp tục.' : `Đã kiểm tra ${preview.files.length} file. ZIP sẽ lấy từ commit ${preview.targetSha.slice(0, 8)}.`, preview.blocked.length > 0);
  });
});
$('filter').addEventListener('input', renderFiles);
$('ack').addEventListener('change', updateButtons);
$('publish-ack').addEventListener('change', updateButtons);
$('build').onclick = () => work('Đang đóng ZIP và xác minh nội dung từng file…', async () => {
  result = await api('build', { id: preview.id, acknowledgeDeletes: $('ack').checked });
  $('result').hidden = false; $('result-name').textContent = result.zipName;
  $('result-meta').textContent = `${result.files.length} file · ${(result.zipBytes / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} KB · commit ${result.targetSha.slice(0, 8)}`;
  $('result-path').textContent = result.zipPath;
  $('delete-reminder').hidden = !result.deleted.length;
  $('publish-box').hidden = result.environment !== 'prod'; $('publish-ack').checked = false;
  $('publish-copy').textContent = `Tag ${result.tag} sẽ trỏ đến commit ${result.targetSha.slice(0, 8)} và được push lên origin. Thao tác này không deploy lên hosting.`;
  notice('Đã tạo và xác minh ZIP. Mở thư mục kết quả để upload.');
  $('result').scrollIntoView({ behavior: 'auto', block: 'nearest' });
});
$('reveal').onclick = () => work('Đang mở thư mục…', async () => { const data = await api('reveal', {}); notice(`Thư mục kết quả: ${data.dir}`); });
$('download').onclick = () => work('Đang chuẩn bị tải ZIP…', async () => {
  const response = await fetch('/api/download', { headers: { 'X-App-Token': token } });
  if (!response.ok) throw new Error('Không tải được ZIP. Hãy mở thư mục kết quả.');
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = result.zipName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); notice('Đã gửi ZIP đến trình tải xuống của trình duyệt.');
});
$('publish').onclick = () => work('Đang tạo / kiểm tra và push tag…', async () => { const data = await api('publish', { id: result.id, confirmTag: result.tag }); $('publish-ack').checked = false; notice(data.message); });
$('shutdown').onclick = () => work('Đang dừng app…', async () => { const data = await api('shutdown', {}); stopped = true; notice(data.message); });
api('context').then(data => { $('repo').value = data.repo; }).catch(e => notice(`Không kết nối được app: ${e.message}`, true));
