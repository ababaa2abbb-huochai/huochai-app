// 第三輪：鄰家女孩、缺人、開工
import { chromium } from 'playwright';
import { serve } from './serve.js';
import { mkdirSync } from 'node:fs';
const shots = process.argv[2] || 'test/e2e/shots3';
mkdirSync(shots, { recursive: true });
const server = await serve('dist-demo', 4324);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Taipei' });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
let n = 0;
const shot = async (name) => { n += 1; await page.waitForTimeout(400); await page.screenshot({ path: `${shots}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: true }); };
const toast = async () => { await page.waitForTimeout(500); return page.locator('.toast').innerText().catch(() => '(無)'); };
const nav = (l) => page.locator('nav.nav button', { hasText: l }).click();
const step = (s) => console.log('▶', s);
try {
  await page.goto('http://localhost:4324/');
  await page.locator('.brand').waitFor({ timeout: 60000 });
  step('點燃兩天後的案子，加一位鄰家女孩');
  await nav('點火柴');
  await page.locator('button', { hasText: '＋ 選日期' }).click();
  await page.locator('.sheet .avail-cell:not([disabled])').nth(2).click();
  await page.locator('.sheet button', { hasText: '完成' }).click();
  await page.locator('input[placeholder="例：中山區"]').fill('士林區');
  await page.locator('.seg button', { hasText: '上架' }).first().click();
  await page.locator('[aria-label="增加人數"]').click(); // 4 人含我
  await page.locator('button', { hasText: '＋ 加入順位' }).first().click();
  await page.locator('input[aria-label="鄰家女孩的名字"]').fill('小美');
  await page.locator('button', { hasText: '＋ 鄰家女孩' }).click();
  const wages = page.locator('input[aria-label$="的時薪"]');
  for (let i = 0; i < await wages.count(); i++) {
    const ph = await wages.nth(i).getAttribute('placeholder');
    if (ph === '必填' && !(await wages.nth(i).inputValue())) await wages.nth(i).fill('260');
  }
  await shot('點燃-含鄰家女孩');
  await page.locator('.btn.primary.block').click();
  console.log('  ', await toast());
  await shot('案件-缺人');
  step('在案件頁再加一位鄰家女孩，再移除');
  await page.locator('button', { hasText: '＋ 鄰家女孩' }).click();
  await page.locator('#guest-name').fill('阿華');
  await page.locator('#guest-wage').fill('300');
  await shot('加鄰家女孩');
  await page.locator('.sheet .btn.primary').click();
  console.log('  ', await toast());
  await shot('加了阿華');
  await page.locator('.list li', { hasText: '阿華' }).locator('button', { hasText: '移除' }).click();
  await page.locator('.sheet .btn.primary').click();
  console.log('  ', await toast());
  step('改成急件');
  const urgent = page.locator('button', { hasText: '改成急件' });
  if (await urgent.count()) { await urgent.click(); console.log('  ', await toast()); }
  await shot('急件後');
  step('快轉到開工');
  for (let i = 0; i < 3; i++) { await page.locator('.demo-bar button', { hasText: '＋1 天' }).click(); await page.waitForTimeout(700); }
  await page.locator('[aria-label="返回"]').click();
  await shot('我的火柴-開工後');
  await page.locator('[aria-label^="通知"]').click();
  await shot('通知-缺人提醒');
} catch (e) {
  problems.push('步驟失敗: ' + e.message.split('\n')[0]);
  await shot('失敗當下');
} finally {
  console.log('\n問題：', problems.length ? '\n' + problems.join('\n') : '無');
  await browser.close(); server.close();
}
