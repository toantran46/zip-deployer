const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { preview, build, publish } = require('./core');

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
  const f = fixture(); const { server } = createServer(f.repo);
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
