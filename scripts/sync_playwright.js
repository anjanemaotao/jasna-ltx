/**
 * Jasna-LTX 云端无头浏览器全自动同步脚本
 * 运行环境：GitHub Actions (Ubuntu) / 本地 Node.js
 * 核心特性：
 * 1. 真实 Chromium 内核渲染，抹除自动化指纹
 * 2. 自动捕获 /api/items 与 /api/verify 数据流
 * 3. 100% 官方原站对齐，无任何第三方数据污染
 * 4. 同时更新 data/movies.json 与 index.html 内联数据
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'movies.json');
const INDEX_FILE = path.join(__dirname, '..', 'index.html');

async function sync() {
  console.log('=== [Jasna-LTX] 启动云端真实无头浏览器同步 ===');
  const t0 = Date.now();

  const launchOptions = {
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-size=1920,1080'
    ]
  };

  // 本地代理支持
  if (process.env.HTTP_PROXY || process.env.http_proxy) {
    const proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy;
    console.log(`[Sync] 检测到代理配置: ${proxyUrl}`);
    launchOptions.proxy = { server: proxyUrl };
  } else if (process.platform === 'win32') {
    try {
      launchOptions.proxy = { server: 'http://127.0.0.1:10808' };
      console.log('[Sync] 本地环境：启用默认代理 127.0.0.1:10808');
    } catch(e) {}
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai'
  });

  const page = await context.newPage();

  // 抹除自动化痕迹
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  let capturedData = null;

  // 网络监听：任何发往 /api/ 的有效 JSON 自动拦截
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/items') || url.includes('/api/verify')) {
      console.log(`[Sync] 拦截到 API 响应: HTTP ${resp.status()} -> ${url}`);
      try {
        const json = await resp.json();
        if (json.data && Array.isArray(json.data.items) && json.data.items.length > 100) {
          console.log(`[Sync] ✨ 从 verify 响应成功提取全量数据！包含 ${json.data.items.length} 部作品`);
          capturedData = json.data;
        } else if (Array.isArray(json.items) && json.items.length > 100) {
          console.log(`[Sync] ✨ 从 items 响应成功提取全量数据！包含 ${json.items.length} 部作品`);
          capturedData = json;
        }
      } catch (e) {}
    }
  });

  console.log('[Sync] 正在访问原站: https://ltx.libray.workers.dev/ ...');
  await page.goto('https://ltx.libray.workers.dev/', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });

  // 轮询等待人机盾静默通过或手动触发
  console.log('[Sync] 等待 Turnstile 人机验证与核心数据就绪...');
  for (let i = 0; i < 8; i++) {
    if (capturedData) break;
    await page.waitForTimeout(2500);

    // 尝试点击可能存在的 Turnstile 交互复选框
    try {
      const frames = page.frames();
      for (const frame of frames) {
        if (frame.url().includes('challenges.cloudflare.com')) {
          const checkbox = frame.locator('input[type="checkbox"], .ctp-checkbox-label, #challenge-stage');
          if (await checkbox.isVisible().catch(() => false)) {
            console.log('[Sync] 检测到 Turnstile 挑战复选框，模拟真实点击...');
            await checkbox.click({ timeout: 2000 }).catch(() => {});
          }
        }
      }
    } catch (e) {}

    // 主动在页面上下文中探测 fetch('/api/items')
    if (!capturedData) {
      const probe = await page.evaluate(async () => {
        try {
          const r = await fetch('/api/items');
          if (r.ok) return await r.json();
        } catch (e) {}
        return null;
      }).catch(() => null);

      if (probe && Array.isArray(probe.items) && probe.items.length > 100) {
        console.log(`[Sync] ✨ 主动探测成功获取数据！作品数: ${probe.items.length}`);
        capturedData = probe;
        break;
      }
    }
  }

  await browser.close();

  if (!capturedData || !Array.isArray(capturedData.items) || capturedData.items.length === 0) {
    throw new Error('未能在超时时间内从原站获取到有效作品库数据（可能遭遇强风控盾）');
  }

  console.log(`[Sync] 数据验证通过！共包含 ${capturedData.items.length} 部原汁原味作品`);

  // 读取现有本地数据库对比增量
  let existingCount = 0;
  if (fs.existsSync(DATA_FILE)) {
    try {
      const old = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      existingCount = (old.items || []).length;
    } catch(e) {}
  }

  const diff = capturedData.items.length - existingCount;
  console.log(`[Sync] 差异比对：原库 ${existingCount} 部 -> 新库 ${capturedData.items.length} 部（净增 ${diff} 部）`);

  // 1. 安全写入 data/movies.json
  fs.writeFileSync(DATA_FILE, JSON.stringify(capturedData, null, 2), 'utf8');
  console.log(`[Sync] 数据已安全写入 ${DATA_FILE}`);

  // 2. 同时更新 index.html 内联数据
  if (fs.existsSync(INDEX_FILE)) {
    let html = fs.readFileSync(INDEX_FILE, 'utf8');
    const regex = /<script id="ltx-items" type="application\/json">[\s\S]*?<\/script>/;
    if (regex.test(html)) {
      html = html.replace(regex, `<script id="ltx-items" type="application/json">${JSON.stringify(capturedData)}</script>`);
      fs.writeFileSync(INDEX_FILE, html, 'utf8');
      console.log('[Sync] index.html 内联数据已完成同步刷新');
    }
  }

  console.log(`[Sync] 同步作业顺利完成！总耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('============================================');
}

sync().catch(err => {
  console.error('[Sync Fatal Error]', err.message);
  process.exit(1);
});
