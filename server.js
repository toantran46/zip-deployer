const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const core = require('./core');

function createServer(defaultRepo = '', { outputRoot } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const instance = crypto.randomUUID();
  let currentPreview, currentBuild;
  const assets = { '/': ['index.html', 'text/html'], '/app.css': ['app.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/i18n.js': ['i18n.js', 'text/javascript'] };
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Chỉ truy cập từ cửa sổ mini app trên máy này.' });
    if (req.method === 'GET' && req.url === '/health') return json(200, { app: 'zip-deployer', instance });
    if (req.method === 'GET' && assets[req.url]) {
      const [file, type] = assets[req.url];
      let data = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
      if (file === 'index.html') data = data.replace('__TOKEN__', token);
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(data);
    }
    if (req.headers['x-app-token'] !== token) return json(403, { error: 'Phiên làm việc không hợp lệ. Mở lại app.' });
    try {
      if (req.method === 'GET' && req.url === '/api/context') return json(200, { repo: defaultRepo });
      if (req.method === 'GET' && req.url === '/api/history') return json(200, { builds: core.history(outputRoot) });
      if (req.method === 'GET' && req.url === '/api/download') {
        if (!currentBuild) throw new Error('Chưa có ZIP đã xác minh.');
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${currentBuild.zipName}"` });
        return fs.createReadStream(currentBuild.zipPath).pipe(res);
      }
      if (req.method !== 'POST' || !['/api/preview', '/api/build', '/api/publish', '/api/reveal', '/api/tags', '/api/shutdown'].includes(req.url)) return json(404, { error: 'Không tìm thấy thao tác.' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return json(415, { error: 'Yêu cầu JSON.' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('Yêu cầu quá lớn.'); }
      const body = JSON.parse(raw || '{}');
      if (req.url === '/api/preview') {
        currentPreview = null; currentBuild = null;
        currentPreview = core.preview(body); return json(200, currentPreview);
      }
      if (req.url === '/api/build') {
        if (!currentPreview || body.id !== currentPreview.id) throw new Error('Hãy xem trước lại danh sách file.');
        currentBuild = core.build(currentPreview, { acknowledgeDeletes: body.acknowledgeDeletes === true, outputRoot });
        return json(200, currentBuild);
      }
      if (req.url === '/api/publish') {
        if (!currentBuild || body.id !== currentBuild.id || body.confirmTag !== currentBuild.tag) throw new Error('Xác nhận đúng tag của ZIP đã tạo.');
        return json(200, core.publish(currentBuild));
      }
      if (req.url === '/api/tags') return json(200, { tags: core.tags(body.repo) });
      if (req.url === '/api/reveal') {
        // Only the current build or a folder listed in deploy history can be opened.
        const dir = body.dir ? core.historyDir(body.dir, outputRoot) : currentBuild?.dir;
        if (!dir) throw new Error('Chưa có kết quả.');
        // No windowsHide: Explorer applies SW_HIDE to the folder window it opens, so it stayed invisible.
        const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' });
        child.on('error', () => {}); child.unref(); return json(200, { dir });
      }
      json(200, { message: 'Đã dừng app. Bạn có thể đóng tab này.' });
      server.close();
    } catch (e) { json(400, { error: e.message }); }
  });
  return { server, instance };
}

if (require.main === module) {
  const repoIndex = process.argv.indexOf('--repo');
  const { server, instance } = createServer(repoIndex >= 0 ? path.resolve(process.argv[repoIndex + 1]) : undefined);
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    const runtime = path.join(__dirname, 'runtime'); fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'instance.json'), JSON.stringify({ url, instance, pid: process.pid }));
    console.log(url);
    if (process.argv.includes('--open')) {
      const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, windowsHide: true, stdio: 'ignore' });
      child.on('error', () => {}); child.unref();
    }
  });
}
module.exports = { createServer };
