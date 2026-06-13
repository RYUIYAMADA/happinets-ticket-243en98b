/**
 * QA: JA/en 切替確認スクリーンショット
 * 対象: index.html / player-dashboard.html (player-form はログイン必須のため index 経由)
 * 方式: ローカルファイル直接 (file://)
 * 実行: node scripts/qa-i18n-toggle.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'file://' + path.resolve(__dirname, '..');
const OUT = path.resolve(__dirname, '../.qa-screenshots/i18n-toggle');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'sp', width: 390, height: 844 },
  { name: 'pc', width: 1280, height: 800 },
];

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  console.log('saved:', name + '.png');
}

async function setLang(page, lang) {
  await page.evaluate((l) => {
    localStorage.setItem('ht_lang', l);
  }, lang);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();

    // ─── index.html ───────────────────────────────────
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    await setLang(page, 'ja');
    await shot(page, `index-${vp.name}-ja`);

    await setLang(page, 'en');
    await shot(page, `index-${vp.name}-en`);

    // ─── player-dashboard.html (ログイン不要部分 / 未認証状態) ───
    await page.goto(BASE + '/player-dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    await setLang(page, 'ja');
    await shot(page, `dashboard-${vp.name}-ja`);

    await setLang(page, 'en');
    await shot(page, `dashboard-${vp.name}-en`);

    // ─── player-form.html (未認証状態) ───
    await page.goto(BASE + '/player-form.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    await setLang(page, 'ja');
    await shot(page, `form-${vp.name}-ja`);

    await setLang(page, 'en');
    await shot(page, `form-${vp.name}-en`);

    await ctx.close();
  }

  await browser.close();
  console.log('\nAll screenshots saved to:', OUT);
})().catch(e => { console.error(e); process.exit(1); });
