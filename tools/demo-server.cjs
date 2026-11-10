const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function createServer() {
  return http.createServer((req, res) => {
    let route;
    try { route = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
    if (route === '/') { res.writeHead(302, { Location: '/alice/status/123' }).end(); return; }
    if (/^\/[^/]+\/status\/\d+\/?$/.test(route)) route = '/demo/index.html';
    const allowed = route.startsWith('/demo/') || ['/extension/core.js', '/extension/editor-adapter.js', '/extension/content.js', '/extension/panel.css'].includes(route);
    const file = path.resolve(root, '.' + route);
    if (!allowed || !file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}
module.exports = { createServer };
if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, '127.0.0.1', () => console.log(`本地演示（模拟翻译）：http://127.0.0.1:${port}/alice/status/123`));
}
