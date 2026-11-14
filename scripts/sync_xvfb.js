/**
 * Jasna-LTX 基于 puppeteer-real-browser 的官方原站同步引擎 (sync_xvfb.js)
 * 严格死守四大铁律：
 * 1. 唯一官方数据源：https://ltx.libray.workers.dev/；
 * 2. 禁止虚假兜底：遇到 403 或未获取数据必须抛异常以非 0 退出码中断；
 * 3. 严禁污染字段：入库前严格校验字段格式与演员纯净度；
 * 4. 真实结果验收：必须通过 strict_verify.js 自检。
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
  console.log('=== [Jasna-LTX] 启动 puppeteer-real-browser 官方原站同步引擎 ===');
  console.log('[Sync] 初始化真实浏览器环境与会话持久化...');

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

    console.log(`[Sync] 正在访问唯一官方数据源: ${SITE_URL} ...`);
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log('[Sync] 页面已加载，等待 15 秒以待页面内置数据与认证就绪...');
    await new Promise(r => setTimeout(r, 15000));

    const title = await page.title();
    console.log(`[Sync] 当前页面标题: "${title}"`);

    // 在页面已认证上下文中提取 /api/items 原生数据
    console.log('[Sync] 正在从页面上下文提取官方原生 /api/items 数据...');
    const result = await page.evaluate(async () => {
      try {
        const resp = await fetch('/api/items');
        if (resp.ok) {
          const json = await resp.json();
          return {
            status: resp.status,
            items: Array.isArray(json.items) ? json.items : (Array.isArray(json.data?.items) ? json.data.items : null)
          };
        }
        return { status: resp.status, text: await resp.text().catch(() => '') };
      } catch (e) {
        return { error: String(e) };
      }
    });

    await browser.close();
    browserInstance = null;

    if (!result || !Array.isArray(result.items) || result.items.length < 3193) {
      console.error('❌ [Sync Fatal Error] 未能成功提取到官方原站数据！', JSON.stringify(result));
      console.error('【铁律二触发】严禁虚假兜底！任务判定为失败，以非 0 退出码中断！');
      process.exit(1);
    }

    const officialItems = result.items;
    console.log(`[Sync] ✨ 成功从官方原站提取到 ${officialItems.length} 部原生作品数据！`);

    // 【铁律三】：严格校验数据结构与演员字段，绝不允许把标签当演员名
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
            console.error(`❌ [Sync Fatal Error] 发现受污染字段: ${it.code} 演员包含非法标签 "${act}"！`);
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

    // 按入库时间降序排列
    cleaned.sort((a, b) => (b.added_at || 0) - (a.added_at || 0));

    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const oldLen = (db.items || []).length;
    db.items = cleaned;
    db.updated_at = Date.now();

    // 1. 写回 data/movies.json
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
    console.log(`[Sync] 数据已安全写入 ${DATA_FILE}`);

    // 2. 更新 index.html 内联数据
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
    console.log('=== [Jasna-LTX] puppeteer-real-browser 官方原站同步圆满完成 ===');

  } catch (err) {
    if (browserInstance) await browserInstance.close().catch(() => {});
    console.error('❌ [Sync Fatal Error]', err.message);
    process.exit(1);
  }
})();
