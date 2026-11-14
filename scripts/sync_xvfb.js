/**
 * Jasna-LTX 基于 puppeteer-real-browser 网络响应全链路拦截同步引擎 (sync_xvfb.js)
 * 核心升级：
 * 1. 在 page.goto 之前挂载 page.on('response') 监听器，静默捕获页面前端自身通过 Turnstile 后返回的 200 JSON 数据；
 * 2. 严禁手动发送无凭据裸 fetch('/api/items')；
 * 3. 延长至 30 秒探测期，每 5 秒打印页面文本摘要、Turnstile iframe 状态与 /api/ 响应流水；
 * 4. 严格遵守四大铁律与 strict_verify.js 质检规范。
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
  console.log('=== [Jasna-LTX] 启动 puppeteer-real-browser 深度响应拦截同步引擎 ===');
  console.log('[Sync] 正在初始化真实渲染环境与持久化 Profile...');

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
    const apiResponses = [];

    // 1. 【核心改造】：在 page.goto 之前挂载 response 拦截器，捕获页面自己发起的合法网络请求
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/api/')) {
        const status = res.status();
        apiResponses.push({ status, url, time: new Date().toISOString().split('T')[1].slice(0, 8) });
        console.log(`[Network 监听] 捕获页面原生接口: HTTP ${status} -> ${url}`);

        if (status === 200) {
          try {
            const json = await res.json();
            const list = Array.isArray(json.items) ? json.items : (Array.isArray(json.data?.items) ? json.data.items : null);
            if (list && list.length > 3000) {
              console.log(`[Network 监听] ✨ 成功捕获官方原生全量片库数据！条目数: ${list.length}`);
              capturedData = { items: list, raw: json };
            }
          } catch (e) {}
        }
      }
    });

    console.log(`[Sync] 正在打开官方原站唯一数据源: ${SITE_URL} ...`);
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log('[Sync] 页面已加载，开始 30 秒全流程状态巡检（每 5 秒打印一次实时诊断）...');

    // 2. 30 秒循环检测，每 5 秒输出一次详尽探针状态
    for (let step = 1; step <= 6; step++) {
      await new Promise(r => setTimeout(r, 5000));
      const elapsed = step * 5;

      // 诊断 A：Turnstile iframe 状态
      const frames = page.frames();
      const turnstileFrames = frames.filter(f => f.url().includes('challenges.cloudflare.com') || f.url().includes('turnstile'));
      const turnstileInfo = turnstileFrames.length > 0
        ? `存在 (${turnstileFrames.length} 个, 来源: ${turnstileFrames[0].url().slice(0, 60)}...)`
        : '不存在 (或已通过)';

      // 诊断 B：页面可见文本摘要 (前 200 字)
      const textSummary = await page.evaluate(() => {
        try {
          const bodyText = document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : '';
          return bodyText.slice(0, 200);
        } catch (e) {
          return `提取异常: ${e.message}`;
        }
      });

      // 诊断 C：当前捕获状态
      const currentApiCount = apiResponses.length;
      const latestApi = apiResponses.length > 0 ? apiResponses[apiResponses.length - 1] : null;

      console.log(`\n--- [巡检诊断第 ${step}/6 次 (${elapsed}s)] ---`);
      console.log(`[Turnstile 状态]: ${turnstileInfo}`);
      console.log(`[页面文本摘要]: "${textSummary || '(页面暂无文字内容)'}"`);
      console.log(`[接口响应流水]: 已记录 ${currentApiCount} 次请求，最新: ${latestApi ? `HTTP ${latestApi.status} ${latestApi.url}` : '暂无 /api/ 响应'}`);

      if (capturedData) {
        console.log(`[Sync] ✨ 已于第 ${elapsed} 秒成功截获官方原生数据，提前终止等待！`);
        break;
      }
    }

    // 页面若已经渲染完毕，做最后一次上下文 DOM / 变量探测
    if (!capturedData) {
      const inPageData = await page.evaluate(() => {
        try {
          const elem = document.getElementById('ltx-items');
          if (elem && elem.textContent) {
            const j = JSON.parse(elem.textContent);
            if (Array.isArray(j.items) && j.items.length > 3000) return j;
          }
        } catch (e) {}
        return null;
      });
      if (inPageData) {
        console.log(`[Sync] ✨ 从页面 DOM #ltx-items 提取到数据: ${inPageData.items.length} 条！`);
        capturedData = inPageData;
      }
    }

    await browser.close();
    browserInstance = null;

    // 【铁律二】：严禁虚假兜底！未捕获到合法数据必须抛异常报错中断
    if (!capturedData || !Array.isArray(capturedData.items) || capturedData.items.length < 3193) {
      console.error('\n❌ [Sync Fatal Error] 30 秒监听期结束，未能从页面网络响应或 DOM 中捕获到官方原生数据！');
      console.error(`[诊断汇总] 页面记录的所有 /api/ 响应流水:`, JSON.stringify(apiResponses, null, 2));
      console.error('【铁律二触发】严禁虚假兜底！任务判定为失败，以非 0 退出码中断！');
      process.exit(1);
    }

    const officialItems = capturedData.items;
    console.log(`\n[Sync] ✨ 成功获取官方原生全量片库数据，总计: ${officialItems.length} 部作品！`);

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
    console.log('=== [Jasna-LTX] 官方原站同步圆满完成 ===');

  } catch (err) {
    if (browserInstance) await browserInstance.close().catch(() => {});
    console.error('❌ [Sync Fatal Error]', err.message);
    process.exit(1);
  }
})();
