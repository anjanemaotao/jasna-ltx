/**
 * Jasna-LTX 真实网络流侦察与全自动同步引擎 (sync_xvfb.js)
 * 严格死守五大铁律：
 * 1. 唯一官方数据源：https://ltx.libray.workers.dev/；
 * 2. 禁止虚假兜底：遇到 403 / 未获取数据必须抛异常以非 0 退出码中断；
 * 3. 严禁污染字段：入库前严格校验字段格式与演员纯净度；
 * 4. 真实结果验收：必须通过 strict_verify.js 自检；
 * 5. 先侦察后编码：严禁裸调 fetch，通过 page.on('request') / page.on('response') 完整捕获页面自身流量。
 */

const path = require('path');
const fs = require('fs');
const { connect } = require('puppeteer-real-browser');

const DATA_FILE = path.join(__dirname, '..', 'data', 'movies.json');
const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const PROFILE_DIR = path.join(__dirname, '..', 'chrome-profile');
const SITE_URL = 'https://ltx.libray.workers.dev/';

const BAD_ACTOR_KEYWORDS = ['診断', '巨乳', '人妻', '中出し', '調教', '痴女', 'エロ', '不倫', 'セックス', '健康', 'アナル'];

(async () => {
  console.log('=== [Jasna-LTX] 启动全链路网络流真实侦察引擎 ===');
  console.log('[Recon] 正在通过 puppeteer-real-browser 初始化真实环境与 Profile...');

  let browserInstance = null;
  try {
    const { browser, page } = await connect({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--lang=zh-CN,zh'
      ],
      customConfig: {
        userDataDir: PROFILE_DIR
      },
      turnstile: true
    });
    browserInstance = browser;

    let capturedData = null;
    const requestLog = [];
    const responseLog = [];

    // 1. 【先侦察后编码】：在 page.goto 之前挂载 request 监听器，记录页面自身发出的所有请求
    page.on('request', (req) => {
      const url = req.url();
      const method = req.method();
      const resourceType = req.resourceType();
      const record = { time: new Date().toISOString().split('T')[1].slice(0, 8), method, resourceType, url };
      requestLog.push(record);

      // 仅打印关键接口、脚本与 Cloudflare 验证请求，过滤高频图片/字体
      if (resourceType === 'xhr' || resourceType === 'fetch' || url.includes('/api/') || url.includes('cloudflare') || url.includes('turnstile')) {
        console.log(`[Request 发起] ${record.time} [${method}] (${resourceType}) -> ${url}`);
      }
    });

    // 2. 【先侦察后编码】：在 page.goto 之前挂载 response 监听器，记录所有真实响应状态
    page.on('response', async (res) => {
      const url = res.url();
      const status = res.status();
      const req = res.request();
      const resourceType = req.resourceType();
      const record = { time: new Date().toISOString().split('T')[1].slice(0, 8), status, url };
      responseLog.push(record);

      if (resourceType === 'xhr' || resourceType === 'fetch' || url.includes('/api/') || url.includes('cloudflare') || url.includes('turnstile')) {
        console.log(`[Response 接收] ${record.time} HTTP ${status} -> ${url}`);
      }

      // 如果页面自身发出的 /api/items 响应为 200，直接捕获原生响应体
      if (url.includes('/api/items') && status === 200) {
        try {
          const json = await res.json();
          const list = Array.isArray(json.items) ? json.items : (Array.isArray(json.data?.items) ? json.data.items : null);
          if (list && list.length > 3000) {
            console.log(`\n🎉 [Recon 捕获成功] 页面原生 /api/items 返回 200！成功提取 ${list.length} 部官方作品！`);
            capturedData = { items: list, raw: json };
          }
        } catch (e) {}
      }
    });

    console.log(`[Recon] 正在导航至官方目标页面: ${SITE_URL} ...`);
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[Recon] 页面已加载，启动 30 秒全时段真实网络侦察（每 5 秒打印一次快照）...\n');

    // 3. 每隔 5 秒打点一次：iframe 列表、document.body 文本前 200 字
    for (let step = 1; step <= 6; step++) {
      await new Promise(r => setTimeout(r, 5000));
      const elapsed = step * 5;

      // 提取所有 iframe URL
      const frames = page.frames();
      const iframeUrls = frames.map(f => f.url()).filter(u => u !== SITE_URL);

      // 提取 document.body.innerText.slice(0, 200)
      const bodyTextSnippet = await page.evaluate(() => {
        try {
          return document.body ? document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        } catch (e) {
          return `DOM读取错误: ${e.message}`;
        }
      });

      console.log(`==================== [侦察快照 第 ${step}/6 次 (${elapsed}s)] ====================`);
      console.log(`[当前 iframe 数量]: ${iframeUrls.length} 个`);
      if (iframeUrls.length > 0) {
        iframeUrls.forEach((u, i) => console.log(`  - iframe[${i}]: ${u}`));
      } else {
        console.log('  - 无外部 iframe');
      }
      console.log(`[页面前 200 字摘要]: "${bodyTextSnippet || '(页面暂无文字内容)'}"`);
      console.log(`[累计流量统计]: 已发出请求 ${requestLog.length} 个，接收响应 ${responseLog.length} 个`);
      console.log(`======================================================================\n`);

      if (capturedData) {
        console.log(`[Recon] ✨ 目标数据已捕获，提前完成侦察！`);
        break;
      }
    }

    await browser.close();
    browserInstance = null;

    // 【铁律二】：严禁虚假兜底！未捕获到有效数据必须抛异常报错退出
    if (!capturedData || !Array.isArray(capturedData.items) || capturedData.items.length < 3193) {
      console.error('❌ [Recon 结论] 30 秒真实网络侦察结束，页面自身未能完成过盾并触发 200 响应！');
      console.error('【铁律二触发】严禁虚假兜底！任务判定为未完成，以非 0 退出码中断！');
      process.exit(1);
    }

    const officialItems = capturedData.items;
    console.log(`[Sync] ✨ 严格模式：正在将捕获到的 ${officialItems.length} 部官方原生作品写入数据库...`);

    // 【铁律三】：严格字段模式校验
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
    console.log('=== [Jasna-LTX] 官方原站同步圆满完成 ===');

  } catch (err) {
    if (browserInstance) await browserInstance.close().catch(() => {});
    console.error('❌ [Recon Fatal Error]', err.message);
    process.exit(1);
  }
})();
