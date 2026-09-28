const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { preview, build, publish, tags, history, historyDir } = require('./core');

function fixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-helper-test-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '-q'); git('config', 'user.name', 'Deploy test'); git('config', 'user.email', 'test@localhost');
  const write = (file, content) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), content); };
  write('old.php', 'old'); write('change.php', 'before');
  git('add', '.'); git('commit', '-qm', 'base'); git('tag', '1.0.0');
  fs.unlinkSync(path.join(repo, 'old.php'));
  write('change.php', 'committed'); write('folder/tên có dấu.txt', 'xin chào'); write('binary.bin', Buffer.from([0, 255, 128, 13, 10]));
  git('add', '-A'); git('commit', '-qm', 'target');
  const request = { repo, base: '1.0.0', target: 'HEAD', environment: 'prod', tag: '1.1.0' };
  return { repo, git, write, request };
}

test('ZIP uses committed bytes, slash paths, Unicode and binary; deletions require acknowledgment', () => {
  const f = fixture(); const p = preview(f.request);
  assert.deepEqual(p.deleted, ['old.php']);
  f.write('change.php', 'UNCOMMITTED');
  assert.throws(() => build(p, { outputRoot: path.join(f.repo, 'out') }), /xóa/);
  const result = build(p, { outputRoot: path.join(f.repo, 'out'), acknowledgeDeletes: true });
  assert.equal(result.files.length, 3);
  assert.equal(result.files.find(x => x.path === 'change.php').sha256, require('node:crypto').createHash('sha256').update('committed').digest('hex'));
  assert(result.files.some(x => x.path === 'folder/tên có dấu.txt'));
  assert(result.files.every(x => !x.path.includes('\\')));
  assert(fs.existsSync(result.zipPath));
  assert(!f.git('tag').includes('1.1.0'));
});

test('sensitive files block packaging and tooling is listed as excluded', () => {
  const f = fixture(); f.write('wp-config.php', 'secret'); f.write('docs/note.md', 'note');
  f.git('add', '.'); f.git('commit', '-qm', 'sensitive');
  const p = preview(f.request);
  assert(p.blocked.some(x => x.path === 'wp-config.php'));
  assert(p.excluded.includes('docs/note.md'));
  assert.throws(() => build(p, { acknowledgeDeletes: true, outputRoot: path.join(f.repo, 'out') }), /nhạy cảm/);
});

test('existing release tag cannot point elsewhere; invalid refs and tag rejected', () => {
  const f = fixture();
  assert.throws(() => preview({ ...f.request, tag: '1.0.0' }), /tag/i);
  assert.throws(() => preview({ ...f.request, target: '--help' }));
  assert.throws(() => preview({ ...f.request, tag: '../bad' }));
});

test('rename reports old path deletion and new committed path', () => {
  const f = fixture(); f.git('mv', 'change.php', 'renamed.php'); f.git('commit', '-qm', 'rename');
  const p = preview({ ...f.request, base: 'HEAD~1' });
  assert(p.deleted.includes('change.php'));
  assert(p.files.some(x => x.path === 'renamed.php'));
});

test('publish pushes only selected tag to a local bare remote; conflicts cannot overwrite', () => {
  const f = fixture(); const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-helper-remote-'));
  execFileSync('git', ['init', '--bare', '-q', remote], { windowsHide: true }); f.git('remote', 'add', 'origin', remote);
  const p = preview(f.request);
  const result = build(p, { outputRoot: path.join(f.repo, 'out'), acknowledgeDeletes: true });
  publish(result);
  assert.equal(f.git('rev-parse', '1.1.0').trim(), p.targetSha);
  assert.match(f.git('ls-remote', '--tags', 'origin'), /refs\/tags\/1.1.0/);
  f.git('tag', '-f', '1.1.0', '1.0.0');
  assert.throws(() => publish(result), /tag/i);
});

test('HTTP server protects operations and completes preview/build/download without a tag write', async t => {
  const { createServer } = require('./server');
  const f = fixture(); const outputRoot = path.join(f.repo, 'out'); const { server } = createServer(f.repo, { outputRoot });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/api/context')).status, 403);
  assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    require('node:http').get(url, { headers: { Host: 'untrusted.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  const html = await (await fetch(url)).text();
  const token = html.match(/name="app-token" content="([a-f0-9]+)"/)[1];
  const headers = { 'X-App-Token': token, 'Content-Type': 'application/json' };
  const post = (route, body) => fetch(url + '/api/' + route, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post('build', { id: 'stale' })).status, 400);
  const p = await (await post('preview', f.request)).json();
  assert.equal((await post('build', { id: p.id })).status, 400);
  const built = await post('build', { id: p.id, acknowledgeDeletes: true });
  assert.equal(built.status, 200); const output = await built.json();
  assert.equal((await post('publish', { id: p.id, confirmTag: 'WRONG' })).status, 400);
  const download = await fetch(url + '/api/download', { headers });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), fs.readFileSync(output.zipPath));
  assert.deepEqual((await (await post('tags', { repo: f.repo })).json()).tags, ['1.0.0']);
  assert.equal(path.dirname(output.dir), outputRoot); // tests never write into the real output/ history
  assert.deepEqual((await (await fetch(url + '/api/history', { headers })).json()).builds.map(x => x.dir), [output.dir]);
  assert.equal((await post('reveal', { dir: 'C:\\Windows' })).status, 400);
  assert(!f.git('tag').includes('1.1.0'));
  console.log(`Browser fixture: ${f.repo}`);
});

test('preview pins commit when branch moves and rejects symlinks and Windows-invalid paths', () => {
  const f = fixture(); const p = preview(f.request);
  f.write('change.php', 'later commit'); f.git('add', '.'); f.git('commit', '-qm', 'moved');
  const built = build(p, { acknowledgeDeletes: true, outputRoot: path.join(f.repo, 'out') });
  assert.equal(built.targetSha, p.targetSha);
  assert.equal(built.files.find(x => x.path === 'change.php').sha256, require('node:crypto').createHash('sha256').update('committed').digest('hex'));
  const oid = f.git('rev-parse', 'HEAD:change.php').trim();
  f.git('config', 'core.protectNTFS', 'false');
  f.git('update-index', '--add', '--cacheinfo', `120000,${oid},link.php`);
  f.git('update-index', '--add', '--cacheinfo', `100644,${oid},bad?.php`);
  f.git('commit', '-qm', 'unsafe paths');
  const unsafe = preview(f.request);
  assert(unsafe.blocked.some(x => x.path === 'link.php'));
  assert(unsafe.blocked.some(x => x.path === 'bad?.php'));
});

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

test('.zipignore "**/" also matches at the root and between segments', () => {
  const f = fixture();
  f.write('.zipignore', '**/*.log\na/**/b\n');
  f.write('debug.log', 'x'); f.write('logs/x.log', 'x'); f.write('a/b', 'x'); f.write('a/x/y/b', 'x'); f.write('ab', 'x');
  f.git('add', '.'); f.git('commit', '-qm', 'globs');
  const p = preview(f.request);
  for (const excluded of ['debug.log', 'logs/x.log', 'a/b', 'a/x/y/b']) assert(p.excluded.includes(excluded), excluded);
  assert(p.files.some(x => x.path === 'ab'));
});

test('UTF-16 .zipignore written by Windows PowerShell still applies', () => {
  const f = fixture();
  f.write('.zipignore', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('assets/*.map\r\n', 'utf16le')]));
  f.write('assets/app.js.map', 'x'); f.git('add', '.'); f.git('commit', '-qm', 'utf16');
  const p = preview(f.request);
  assert.deepEqual(p.ignoreRules, ['assets/*.map']);
  assert(p.excluded.includes('assets/app.js.map'));
});

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

test('every Vietnamese UI string has an English translation', () => {
  const EN = require('./public/i18n.js');
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const html = read('public/index.html'), js = read('public/app.js'), backend = read('core.js') + read('server.js') + js;
  const keys = [
    ...[...html.matchAll(/data-i18n>([^<]+)</g)].map(m => m[1].trim()),
    ...[...html.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)].map(m => m[1]),
    ...[...js.matchAll(/\b(?:t|notice|work)\('([^']+)'/g)].map(m => m[1]),
    ...[...backend.matchAll(/(?:new Error|error:|message:|reason:)\s*\(?'([^']+)'/g)].map(m => m[1]),
    ...[...backend.matchAll(/return '([^']+)';/g)].map(m => m[1]),
  ];
  const missing = [...new Set(keys)].filter(k => !(k in EN));
  assert.deepEqual(missing, []);
});
