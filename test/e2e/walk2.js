// 第二輪：撞期、改時間、改日期、減人、取消、熄滅
import { chromium } from 'playwright';
import { serve } from './serve.js';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shots = process.argv[2] || join(root, 'test', 'e2e', 'shots2');
mkdirSync(shots, { recursive: true });
const server = await serve(join(root, 'dist-demo'), 4323);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Taipei' });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
let n = 0;
const shot = async (name) => { n += 1; await page.waitForTimeout(400); await page.screenshot({ path: join(shots, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const lastToast = async () => { await page.waitForTimeout(500); return page.locator('.toast').innerText().catch(() => '(無)'); };
const nav = (label) => page.locator('nav.nav button', { hasText: label }).click();
const as = async (name) => {
  const sel = page.locator('.demo-bar select');
  await sel.selectOption(await sel.locator('option', { hasText: name }).first().getAttribute('value'));
  await page.waitForFunction((nm) => { const s = document.querySelector('.demo-bar select'); return s.options[s.selectedIndex].text.startsWith(nm); }, name);
  await page.waitForTimeout(500);
};
const step = (s) => console.log('▶', s);

try {
  await page.goto('http://localhost:4323/');
  await page.locator('.brand').waitFor({ timeout: 60000 });

  step('蘿蔔先答應長苓的邀請');
  await nav('我的班');
  const day = (await page.locator('article .facts dd b').first().innerText()); // 例如 11/4（三）
  await page.locator('button', { hasText: '確認出班' }).first().click();
  console.log('  ', await lastToast());

  step('在同一天點燃自己的火柴（我也出班）→ 撞期');
  await nav('月曆');
  // 找到那一天
  const m = Number(day.split('/')[0]);
  const d = Number(day.split('/')[1].split('（')[0]);
  const curMonth = await page.locator('h1.page').innerText();
  if (!curMonth.includes(` ${m} 月`)) await page.locator('[aria-label="下個月"]').click();
  await page.locator(`.grid .cell[aria-label^="${m}/${d}（"]`).click();
  await page.locator('button', { hasText: '用這天點火柴' }).click();
  await page.locator('input[placeholder="例：中山區"]').fill('內湖區');
  await page.locator('.seg button', { hasText: '打包' }).first().click();
  for (let i = 0; i < 3; i++) await page.locator('button', { hasText: '＋ 加入順位' }).first().click();
  const wages = page.locator('input[aria-label$="的時薪"]');
  for (let i = 0; i < await wages.count(); i++) if (!(await wages.nth(i).inputValue())) await wages.nth(i).fill('250');
  await page.locator('.btn.primary.block').click();
  await page.locator('.sheet').waitFor();
  await shot('撞期-三個選項');
  await page.locator('.option', { hasText: '跟客戶改日期' }).click();
  await page.waitForTimeout(800);
  await shot('撞期-改日期建議');
  await page.locator('.sheet [aria-label="關閉"]').click();
  await page.locator('.btn.primary.block').click();
  await page.locator('.option', { hasText: '這天只接洽' }).click();
  await shot('撞期-只接洽');
  await page.locator('.option', { hasText: '是，現場還是' }).click();
  console.log('  ', await lastToast());
  await shot('只接洽-點燃後');

  step('修改案件：改時間');
  const firstConfirmedCase = page.locator('h2', { hasText: '內湖區' });
  console.log('   在內湖區案件頁：', await firstConfirmedCase.count());
  // 先讓一位直接加入，才有人收到時間變更
  await page.locator('button.link', { hasText: '直接加入' }).first().click();
  await page.waitForTimeout(600);
  const directName = (await page.locator('.list li:has(.chip.dark) .row > span').nth(0).innerText());
  await page.locator('button', { hasText: '修改案件' }).click();
  await page.locator('.sheet input[type="time"]').first().fill('10:00');
  await shot('改時間');
  await page.locator('.sheet button', { hasText: '儲存基本資料' }).click();
  console.log('  ', await lastToast());
  await as(directName);
  await nav('我的班');
  await shot('女孩收到時間變更');
  await page.locator('button', { hasText: '沒辦法' }).first().click();
  console.log('  ', await lastToast());
  await as('蘿蔔');
  await nav('我的火柴');
  await page.locator('.case-card', { hasText: '內湖區' }).click();
  await shot('時間變更沒辦法後補位');

  step('減人：3 → 1');
  await page.locator('button', { hasText: '修改案件' }).click();
  await page.locator('.sheet [aria-label="減少人數"]').click();
  await page.locator('.sheet [aria-label="減少人數"]').click();
  await shot('減人');
  await page.locator('.sheet button', { hasText: '儲存這天的人手' }).click();
  console.log('  ', await lastToast());
  await shot('減人後');

  step('改日期');
  await page.locator('button', { hasText: '修改案件' }).click();
  await page.locator('.sheet button', { hasText: '改到別天' }).click();
  await page.locator('.sheet:last-of-type .avail-cell:not([disabled])').nth(5).click();
  console.log('  ', await lastToast());
  await shot('改日期後');

  step('取消自己答應的班（蘿蔔取消長苓的班）');
  await nav('我的班');
  await page.locator('button.link', { hasText: '取消這個班' }).first().click();
  await shot('取消-選原因');
  await page.locator('.option', { hasText: '身體不適' }).click();
  console.log('  ', await lastToast());
  await as('長苓');
  await page.locator('[aria-label^="通知"]').click();
  await shot('長苓收到取消通知');
  await as('蘿蔔');

  step('熄滅');
  await nav('我的火柴');
  await page.locator('.case-card', { hasText: '內湖區' }).click();
  await page.locator('button', { hasText: '熄滅這根火柴' }).click();
  await shot('熄滅確認');
  await page.locator('.sheet button', { hasText: '熄滅並通知大家' }).click();
  console.log('  ', await lastToast());
  await shot('熄滅後列表');
} catch (e) {
  problems.push('步驟失敗: ' + e.message.split('\n')[0]);
  await shot('失敗當下');
} finally {
  console.log('\n問題：', problems.length ? '\n' + problems.join('\n') : '無');
  await browser.close();
  server.close();
}
