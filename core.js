const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function git(repo, args, binary = false) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: binary ? undefined : 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { throw new Error(String(e.stderr || e.message).trim()); }
}
function ref(repo, name) {
  if (typeof name !== 'string' || !name.trim() || name.startsWith('-') || /[\x00-\x1f]/.test(name)) throw new Error('Branch/tag không hợp lệ.');
  return git(repo, ['rev-parse', '--verify', '--end-of-options', `${name}^{commit}`]).trim();
}
function safePath(p) {
  return p && !/[\\:*?"<>|\x00-\x1f]/.test(p) && !p.startsWith('/') && p.split('/').every(x => x && x !== '.' && x !== '..' && !/[. ]$/.test(x) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x));
}
function policy(p) {
  if (!safePath(p)) return 'Đường dẫn không an toàn trên Windows';
  if (/(^|\/)(wp-config\.php|\.env(?:\..*)?|uploads|cccd|error_log|\.git|\.ssh|\.aws)(\/|$)|\.(sql(?:\.gz)?|zip|pem|key|p12|pfx)$/i.test(p)) return 'File nhạy cảm hoặc dữ liệu không được đóng gói';
  return '';
}
function excluded(p) { return /^(docs|tools|tests|\.agents|\.claude|\.codex|\.github|\.deploy-temp|node_modules)(\/|$)|(^|\/)(AGENTS\.md|CLAUDE\.md)$|^(deploy-files\.txt|\.zipignore)$/i.test(p); }
function ignoreMatcher(text) {
  const rules = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
  // "!" rules are listed but never compiled: .zipignore can only add exclusions.
  const patterns = rules.filter(x => !x.startsWith('!')).map(rule => {
    const r = rule.replace(/^\/+|\/+$/g, '');
    return new RegExp('^' + r.split('**').map(s => s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '(/|$)', 'i');
  });
  return { rules, match: p => patterns.some(re => re.test(p)) };
}
function tagCheck(repo, tag, sha) {
  if (!tag || tag.startsWith('-') || /[\x00-\x20]/.test(tag)) throw new Error('Tên tag không hợp lệ.');
  git(repo, ['check-ref-format', `refs/tags/${tag}`]);
  const exists = git(repo, ['tag', '--list', tag]).trim();
  if (exists && ref(repo, `refs/tags/${tag}`) !== sha) throw new Error('Tag đã tồn tại và trỏ đến commit khác. Tool không ghi đè tag.');
  return Boolean(exists);
}
const OUTPUT_ROOT = path.join(__dirname, 'output');
function repoRoot(repo) {
  if (typeof repo !== 'string' || !path.isAbsolute(repo)) throw new Error('Nhập đường dẫn tuyệt đối đến repository.');
  return git(repo, ['rev-parse', '--show-toplevel']).trim();
}
function tags(repo) { return git(repoRoot(repo), ['tag', '--list', '--sort=-creatordate']).split('\n').filter(Boolean).slice(0, 20); }
// ponytail: reads every manifest per call; add an index file if output/ grows to thousands of builds.
function history(outputRoot = OUTPUT_ROOT) {
  if (!fs.existsSync(outputRoot)) return [];
  return fs.readdirSync(outputRoot, { withFileTypes: true }).filter(d => d.isDirectory() && /^(prod|staging)-/.test(d.name)).flatMap(d => {
    const dir = path.join(outputRoot, d.name);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      return [{ dir, environment: m.environment, tag: m.tag, target: m.target, base: m.base, baseSha: m.baseSha, targetSha: m.targetSha, zipName: m.zipName, files: m.files.length, deleted: m.deleted.length, zipBytes: m.zipBytes ?? null, createdAt: m.createdAt }];
    } catch { return []; }
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50);
}
function historyDir(dir, outputRoot = OUTPUT_ROOT) {
  const resolved = path.resolve(String(dir));
  if (path.dirname(resolved) !== path.resolve(outputRoot) || !fs.existsSync(path.join(resolved, 'manifest.json'))) throw new Error('Thư mục không thuộc lịch sử deploy.');
  return resolved;
}
function preview(input) {
  if (!['staging', 'prod'].includes(input.environment)) throw new Error('Chọn staging hoặc production.');
  const repo = repoRoot(input.repo);
  const baseSha = ref(repo, input.base), targetSha = ref(repo, input.target);
  const tag = input.environment === 'prod' ? String(input.tag || '').trim() : '';
  if (tag) tagCheck(repo, tag, targetSha);
  if (input.environment === 'prod' && !tag) throw new Error('Nhập tag production mới.');
  const changes = git(repo, ['diff', '--no-ext-diff', '--no-renames', '--name-status', '-z', baseSha, targetSha, '--']).split('\0').filter(Boolean);
  const tree = new Map(git(repo, ['ls-tree', '-r', '-z', targetSha]).split('\0').filter(Boolean).map(line => {
    const at = line.indexOf('\t'); const [mode, type, oid] = line.slice(0, at).split(' ');
    return [line.slice(at + 1), { mode, type, oid }];
  }));
  const counts = new Map(git(repo, ['diff', '--no-ext-diff', '--no-renames', '--numstat', '-z', baseSha, targetSha, '--']).split('\0').filter(Boolean).map(line => {
    const a = line.indexOf('\t'), b = line.indexOf('\t', a + 1), n = x => x === '-' ? null : Number(x);
    return [line.slice(b + 1), { added: n(line.slice(0, a)), removed: n(line.slice(a + 1, b)) }];
  }));
  const ignoreFile = tree.get('.zipignore');
  const ignore = ignoreMatcher(ignoreFile ? git(repo, ['cat-file', 'blob', ignoreFile.oid]) : '');
  const files = [], deleted = [], blocked = [], omitted = [];
  const names = new Set();
  for (let i = 0; i < changes.length; i += 2) {
    const status = changes[i], p = changes[i + 1];
    const reason = policy(p);
    if (reason) { blocked.push({ path: p, reason }); continue; }
    if (excluded(p) || ignore.match(p)) { omitted.push(p); continue; }
    if (status === 'D') { deleted.push(p); continue; }
    const entry = tree.get(p);
    if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) { blocked.push({ path: p, reason: 'Symlink hoặc submodule không được hỗ trợ' }); continue; }
    const key = p.toLowerCase();
    if (names.has(key)) { blocked.push({ path: p, reason: 'Trùng đường dẫn khi không phân biệt hoa thường' }); continue; }
    names.add(key); files.push({ path: p, status, oid: entry.oid, ...counts.get(p) });
  }
  const label = (tag || input.target).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 70) || targetSha.slice(0, 8);
  return { id: crypto.randomUUID(), repo, base: input.base, target: input.target, baseSha, targetSha, environment: input.environment, tag, files, deleted, blocked, excluded: omitted, ignoreRules: ignore.rules, zipName: `deploy-${input.environment}-${label}.zip`, dirty: Boolean(git(repo, ['status', '--porcelain', '--untracked-files=no']).trim()) };
}
function build(p, options = {}) {
  if (p.blocked.length) throw new Error('Có file nhạy cảm hoặc không an toàn. Hãy sửa phạm vi commit trước khi đóng gói.');
  if (p.deleted.length && !options.acknowledgeDeletes) throw new Error('Cần xác nhận xử lý file xóa trên hosting.');
  if (!p.files.length) throw new Error('Không có file thêm/sửa để đóng ZIP.');
  if (p.tag) tagCheck(p.repo, p.tag, p.targetSha);
  const outputRoot = options.outputRoot || OUTPUT_ROOT;
  fs.mkdirSync(outputRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(outputRoot, `${p.environment}-`));
  const stage = path.join(dir, 'files'); fs.mkdirSync(stage);
  const files = p.files.map(file => {
    const content = git(p.repo, ['cat-file', 'blob', file.oid], true);
    const dest = path.join(stage, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, content);
    return { path: file.path, size: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') };
  });
  const zipPath = path.join(dir, p.zipName), verification = path.join(dir, 'verification.json');
  const result = { ...p, dir, zipPath, files, createdAt: new Date().toISOString() };
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'zip.ps1'), '-Source', stage, '-Destination', zipPath, '-Report', verification], { windowsHide: true, timeout: 300000, stdio: 'pipe' });
    let actual = JSON.parse(fs.readFileSync(verification, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(actual)) actual = [actual];
    if (actual.length !== files.length || actual.some(x => { const expected = files.find(f => f.path === x.path); return !expected || expected.sha256 !== x.sha256 || expected.size !== x.size || x.path.includes('\\'); })) throw new Error('Nội dung ZIP không khớp commit.');
    fs.writeFileSync(path.join(dir, 'deploy-files.txt'), files.map(x => x.path).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'deleted-files.txt'), p.deleted.join('\n') + (p.deleted.length ? '\n' : ''));
    result.zipBytes = fs.statSync(zipPath).size;
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    // Only this newly created file is removed. Existing outputs are never replaced.
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    throw new Error(`Đóng ZIP thất bại: ${String(e.stderr || e.message)}`);
  }
}
function publish(result) {
  if (!result.tag || result.environment !== 'prod' || !fs.existsSync(result.zipPath)) throw new Error('Cần ZIP production đã xác minh trước khi tạo/push tag.');
  if (!tagCheck(result.repo, result.tag, result.targetSha)) git(result.repo, ['tag', result.tag, result.targetSha]);
  try { git(result.repo, ['push', 'origin', `refs/tags/${result.tag}:refs/tags/${result.tag}`]); }
  catch (e) { throw new Error(`Tag local đã tồn tại; push chưa thành công. Có thể thử lại, không cần tạo lại ZIP. ${e.message}`); }
  return { message: `Đã push tag ${result.tag} lên origin. Chưa upload hoặc deploy.` };
}
module.exports = { preview, build, publish, tags, history, historyDir, OUTPUT_ROOT };
