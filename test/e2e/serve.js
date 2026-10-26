// 簡單的靜態伺服器（給瀏覽器測試用）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.svg': 'image/svg+xml',
};

export function serve(dir, port) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const file = join(dir, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
