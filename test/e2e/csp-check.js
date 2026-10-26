import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.data': 'application/octet-stream' };
for (const csp of ["script-src 'self' 'wasm-unsafe-eval'", "script-src 'self'"]) {
  const server = createServer(async (req, res) => {
    const p = req.url.split('?')[0]; const f = join('dist-demo', p === '/' ? 'index.html' : p);
    try { const b = await readFile(f); res.writeHead(200, { 'Content-Type': T[extname(f)] || 'application/octet-stream', 'Content-Security-Policy': csp }); res.end(b); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(4330, r));
  const b = await chromium.launch(); const page = await b.newPage();
  const errs = []; page.on('console', (m) => m.type() === 'error' && errs.push(m.text())); page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4330/');
  const ok = await page.locator('.brand').waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
  console.log(csp, '=>', ok ? 'works' : 'FAILS', errs.slice(0, 2).join(' | ').slice(0, 200));
  await b.close(); server.close();
}
