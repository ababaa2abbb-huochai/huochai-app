// 瀏覽器走一遍完整流程並截圖：node test/e2e/walk.js <截圖資料夾>
import { chromium } from 'playwright';
import { serve } from './serve.js';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shots = process.argv[2] || join(root, 'test', 'e2e', 'shots');
mkdirSync(shots, { recursive: true });

const server = await serve(join(root, 'dist-demo'), 4321);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());

let n = 0;
const shot = async (name) => {
  n += 1;
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: true });
};
const toast = async () => {
  const t = page.locator('.toast');
  try {
    await t.waitFor({ timeout: 4000 });
    return await t.innerText();
  } catch {
    return '(沒有提示)';
  }
};
const nav = (label) => page.locator('nav.nav button', { hasText: label }).click();
const as = async (name) => {
  const sel = page.locator('.demo-bar select');
  const value = await sel.locator('option', { hasText: name }).first().getAttribute('value');
  await sel.selectOption(value);
  await page.waitForFunction((n) => {
    const s = document.querySelector('.demo-bar select');
    return s && s.options[s.selectedIndex].text.startsWith(n);
  }, name, { timeout: 5000 }).catch(() => problems.push('切換身分沒成功：' + name));
  await page.waitForTimeout(600);
};
const log = (...a) => console.log(...a);
const where = async (label) => {
  const who = await page.locator('.demo-bar select').evaluate((s) => s.options[s.selectedIndex].text).catch(() => '?');
  const clock = await page.locator('.demo-bar .clock').innerText().catch(() => '?');
  console.log(`  [${label}] ${who} ${clock}`);
};

try {
  await page.goto('http://localhost:4321/');
  await page.locator('.brand').waitFor({ timeout: 60000 });
  await shot('月曆');

  // 點一天看名單
  await page.locator('.grid .cell').nth(12).click();
  await shot('月曆-選一天');

  // 我的班：長苓的邀請
  await nav('我的班');
  await shot('我的班-邀請');
  await page.locator('button', { hasText: '確認出班' }).first().click();
  log('確認邀請：', await toast());
  await shot('我的班-已確認');

  // 我的火柴
  await nav('我的火柴');
  await shot('我的火柴-列表');
  await page.locator('.case-card').first().click();
  await shot('我的火柴-詳情-第一天');
  await page.locator('.tabs button').nth(1).click();
  await shot('我的火柴-詳情-第二天');

  // 填班
  await nav('填班');
  await shot('填班');
  const cells = page.locator('.avail-cell:not([disabled])');
  await cells.nth(3).click();
  await cells.nth(3).click();
  await cells.nth(4).click();
  await shot('填班-點過');

  // 點火柴
  await nav('點火柴');
  await shot('點火柴-空白');
  await page.locator('button', { hasText: '＋ 選日期' }).click();
  await page.locator('.sheet [aria-label="下個月"]').click();
  await page.waitForTimeout(300);
  await page.locator('.sheet .avail-cell:not([disabled])').nth(8).click();
  await page.locator('.sheet .avail-cell:not([disabled])').nth(9).click();
  await shot('點火柴-選日期');
  await page.locator('.sheet button', { hasText: '完成' }).click();
  await page.locator('input[placeholder="例：中山區"]').fill('松山區');
  await page.locator('.seg button', { hasText: '整理' }).first().click();
  // 第一天排 4 個人
  const addBtns = page.locator('button', { hasText: '＋ 加入順位' });
  for (let i = 0; i < 4; i++) await addBtns.first().click();
  await shot('點火柴-排好順位');
  // 第一次合作沒填時薪的人補上
  const wages = page.locator('input[aria-label$="的時薪"]');
  for (let i = 0; i < await wages.count(); i++) {
    if (!(await wages.nth(i).inputValue())) await wages.nth(i).fill('260');
  }
  await page.locator('button.link', { hasText: '複製到其他天' }).click();
  log('複製：', await toast());
  await page.locator('.btn.primary.block').click();
  log('點燃：', await toast());
  await shot('點燃後-詳情');

  // 切成第一位被邀請的人，婉拒
  const firstInvited = await page.locator('.list li:has(.chip.ember) .row > span').first().innerText().catch(() => null);
  log('第一位邀請中：', firstInvited);
  const nameOnly = firstInvited?.split(/\s/)[0];
  if (nameOnly) {
    await as(nameOnly);
    await nav('我的班');
    await shot('被邀請的人-我的班');
    await where('婉拒前');
    const card = page.locator('article', { hasText: '松山區' }).first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await card.locator('button', { hasText: '婉拒' }).click();
    await page.waitForTimeout(300);
    log('婉拒：', await toast());
    await where('婉拒後');
    await as('蘿蔔');
    await where('切回蘿蔔');
    await nav('我的火柴');
    await page.locator('.case-card', { hasText: '松山區' }).click();
    await shot('婉拒後自動補位');
  }

  // 快轉一天：超時的人
  await page.locator('.demo-bar button', { hasText: '＋1 天' }).click();
  await page.waitForTimeout(800);
  await shot('快轉一天後');

  // 修改案件
  await page.locator('button', { hasText: '修改案件' }).click();
  await shot('修改案件');
  await page.locator('.sheet [aria-label="關閉"]').click();

  // 替換、加人
  const replaceBtn = page.locator('button', { hasText: '替換' }).first();
  if (await replaceBtn.count()) {
    await replaceBtn.click();
    await shot('替換');
    await page.locator('.sheet [aria-label="關閉"]').click();
  }

  // 替換：先把一位直接加入，再替換她
  await page.locator('button.link', { hasText: '直接加入' }).first().click();
  log('直接加入：', await toast());
  await page.waitForTimeout(600);
  await page.locator('button', { hasText: '替換' }).first().click();
  await page.locator('.sheet .btn.sm').first().click();
  await shot('替換-選人');
  await page.locator('.sheet .btn.primary').click();
  log('替換：', await toast());
  await shot('替換後');

  // 通知
  await page.locator('[aria-label="返回"]').click();
  await page.locator('[aria-label^="通知"]').click();
  await shot('通知');

  // 管理
  await page.locator('[aria-label="管理"]').click();
  await shot('管理');
} catch (e) {
  problems.push('步驟失敗: ' + e.message.split('\n')[0]);
  await shot('失敗當下');
} finally {
  console.log('\n問題：', problems.length ? '\n' + problems.join('\n') : '無');
  await browser.close();
  server.close();
}
