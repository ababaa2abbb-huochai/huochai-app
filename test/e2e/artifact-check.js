import { chromium } from 'playwright';
import { serve } from './serve.js';
const server = await serve('artifact', 4331);
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4331/');
const ok = await page.locator('.brand').waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
console.log(ok ? 'artifact 版可以開啟' : '打不開', errs.join(' | ').slice(0, 300));
await b.close(); server.close();
