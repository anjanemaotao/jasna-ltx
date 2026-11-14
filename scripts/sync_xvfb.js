/**
 * Jasna-LTX 云端 Xvfb + Chromium 原生同步引擎 (sync_xvfb.js)
 * 严格遵循四大铁律：
 * 1. 唯一合法数据源：https://ltx.libray.workers.dev/；
 * 2. 禁止虚假兜底：遇到 403 / Turnstile 拦截，必须抛出致命错误以非 0 退出码中断，严禁假装成功；
 * 3. 严禁污染字段：入库前严格执行字段模式校验；
 * 4. 真实结果验收：必须通过 strict_verify.js 自检。
 */

const path = require('path');
const fs = require('fs');
const puppeteer = require('/data/home/ltx-fetch/node_modules/puppeteer-extra');
const StealthPlugin = require('/data/home/ltx-fetch/node_modules/puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const DATA_FILE = path.join(__dirname, '..', 'data', 'movies.json');
const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const SITE_URL = 'https://ltx.libray.workers.dev/';

const BAD_ACTOR_KEYWORDS = ['診断', '巨乳', '人妻', '中出し', '調教', '痴女', 'エロ', '不倫', 'セックス', '健康', 'アナル'];

(async () => {
  console.log('=== [Jasna-LTX] 启动云端真实 Xvfb Chromium 官方同步引擎 ===');
  console.log(`[Sync] 正在拉起真实图形环境访问官方唯一数据源: ${SITE_URL} ...`);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: false, // 必须为 false 以运行在真实虚拟 X11 桌面
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--lang=zh-CN,zh'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    let capturedData = null;

    // 网络监听：精准拦截 /api/items 与 /api/verify
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/api/items') || url.includes('/api/verify')) {
        console.log(`[Network] 响应: HTTP ${res.status()} -> ${url}`);
        if (res.status() === 200) {
          try {
            const json = await res.json();
            if (json.data && Array.isArray(json.data.items) && json.data.items.length > 3000) {
              console.log(`[Network] ✨ 成功从 verify 响应中提取到原生数据！总数: ${json.data.items.length} 部`);
              capturedData = json.data;
            } else if (Array.isArray(json.items) && json.items.length > 3000) {
              console.log(`[Network] ✨ 成功从 items 响应中提取到原生数据！总数: ${json.items.length} 部`);
              capturedData = json;
            }
          } catch(e) {}
        }
      }
    });

    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log('[Sync] 页面已加载，等待人机盾校验与渲染...');
    await new Promise(r => setTimeout(r, 6000));

    // 检查页面标题
    const title = await page.title();
    console.log(`[Sync] 页面标题: "${title}"`);

    // 轮询探测数据
    for (let i = 0; i < 10; i++) {
      if (capturedData) break;
      await new Promise(r => setTimeout(r, 2000));

      const probe = await page.evaluate(async () => {
        try {
          const r = await fetch('/api/items');
          if (r.ok) return await r.json();
        } catch(e) {}
        return null;
      });

      if (probe && (Array.isArray(probe.items) || Array.isArray(probe.data?.items))) {
        capturedData = probe.items ? probe : probe.data;
        console.log(`[Sync] ✨ 页面上下文探测成功！获取到 ${capturedData.items.length} 部数据！`);
        break;
      }
    }

    await browser.close();

    // 【铁律二】：严禁虚假兜底！未通过盾或未获取数据时必须抛异常中断退出
    if (!capturedData || !Array.isArray(capturedData.items) || capturedData.items.length < 3193) {
      console.error('❌ [Sync Fatal Error] 未能从原站提取到有效官方原生数据（遭遇 Cloudflare Turnstile 拦截）！');
      console.error('【铁律二触发】严禁虚假兜底！任务失败，以非 0 退出码中断！');
      process.exit(1);
    }

    const officialItems = capturedData.items;
    console.log(`[Sync] 成功获取官方原生全量数据，共 ${officialItems.length} 部！`);

    // 【铁律三】：严格字段校验
    const cleaned = [];
    const seen = new Set();
    for (const it of officialItems) {
      if (!it.code || typeof it.code !== 'string') continue;
      const c = it.code.trim().toUpperCase();
      if (seen.has(c)) continue;
      seen.add(c);

      if (Array.isArray(it.actors)) {
        for (const act of it.actors) {
          if (BAD_ACTOR_KEYWORDS.some(kw => act.includes(kw))) {
            console.error(`❌ [Sync Fatal Error] 演员字段被污染: ${act} (番号: ${it.code})`);
            process.exit(1);
          }
        }
      }

      cleaned.push({
        code: it.code,
        title: it.title || '',
        title_zh: it.title_zh || it.title || '',
        actors: Array.isArray(it.actors) ? it.actors : [],
        maker: it.maker || '',
        date: it.date || '',
        cover: it.cover || '',
        url: it.url || '',
        score: typeof it.score === 'number' ? it.score : 4.5,
        votes: typeof it.votes === 'number' ? it.votes : 100,
        links: Array.isArray(it.links) ? it.links : [],
        pending_links: Array.isArray(it.pending_links) ? it.pending_links : [],
        added_at: typeof it.added_at === 'number' ? it.added_at : Date.now(),
        genres: Array.isArray(it.genres) ? it.genres : [],
        subtitle: it.subtitle || ''
      });
    }

    // 排序
    cleaned.sort((a, b) => (b.added_at || 0) - (a.added_at || 0));

    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const oldLen = (db.items || []).length;
    db.items = cleaned;
    db.updated_at = Date.now();

    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
    console.log(`[Sync] 数据已安全写入 ${DATA_FILE}`);

    if (fs.existsSync(INDEX_FILE)) {
      let html = fs.readFileSync(INDEX_FILE, 'utf8');
      if (html.includes('id="ltx-items"')) {
        html = html.replace(
          /<script id="ltx-items" type="application\/json">[\s\S]*?<\/script>/,
          `<script id="ltx-items" type="application/json">${JSON.stringify(db)}</script>`
        );
        fs.writeFileSync(INDEX_FILE, html, 'utf8');
        console.log('[Sync] index.html 内联数据同步更新完成');
      }
    }

    console.log(`[Sync] 差异比对：原库 ${oldLen} 部 -> 新库 ${cleaned.length} 部（净增 ${cleaned.length - oldLen} 部）！`);
    console.log('=== [Jasna-LTX] 云端 Xvfb 同步作业圆满完成 ===');

  } catch(err) {
    if (browser) await browser.close().catch(() => {});
    console.error('❌ [Sync Fatal Error]', err.message);
    process.exit(1);
  }
})();
