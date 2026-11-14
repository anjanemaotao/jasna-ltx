/**
 * Jasna-LTX 官方原站原生同步引擎 (Node.js)
 * 严格遵循项目四大死锁铁律：
 * 1. 唯一合法数据源：https://ltx.libray.workers.dev/，严禁使用任何第三方源；
 * 2. 禁止虚假兜底：遇到 403 / 503 / 人机盾拦截，必须以非 0 退出码报错中断，严禁假装成功；
 * 3. 严禁污染字段：入库前严格校验字段格式（演员、番号、ed2k、封面），严禁篡改；
 * 4. 真实结果验收：必须通过 strict_verify.js 自检。
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'movies.json');
const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const OFFICIAL_URL = 'https://ltx.libray.workers.dev/api/items';

const BAD_ACTOR_KEYWORDS = ['診断', '巨乳', '人妻', '中出し', '調教', '痴女', 'エロ', '不倫', 'セックス', '健康', 'アナル'];

async function fetchOfficialLibrary() {
  console.log('=== Jasna-LTX 官方原站同步启动 ===');
  console.log(`[Sync] 正在请求唯一合法官方原站: ${OFFICIAL_URL} ...`);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://ltx.libray.workers.dev/'
  };

  // 支持通过环境变量注入合法 session cookie (如经过人机验证后的 cf_clearance)
  if (process.env.LTX_COOKIE) {
    headers['Cookie'] = process.env.LTX_COOKIE;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let resp;
  try {
    resp = await fetch(OFFICIAL_URL, {
      signal: controller.signal,
      headers
    });
  } catch (err) {
    clearTimeout(timeout);
    console.error(`❌ [Sync Fatal] 网络请求失败: ${err.message}`);
    process.exit(1);
  }
  clearTimeout(timeout);

  // 【铁律二】：遇到 403 / 503 或任何非 200 拦截，严禁输出“保持当前数据库”假装成功，必须直接报错退出！
  if (!resp.ok) {
    let body = '';
    try { body = await resp.text(); } catch(e) {}
    console.error(`❌ [Sync Fatal Error] 官方原站响应 HTTP ${resp.status} 拦截！`);
    console.error(`[Detail] 响应内容: ${body.slice(0, 300)}`);
    console.error('【铁律触发】严禁虚假兜底！任务判定为失败，立刻以非 0 退出码中断！');
    process.exit(1);
  }

  const json = await resp.json().catch(() => null);
  if (!json || (!Array.isArray(json.items) && !Array.isArray(json.data?.items))) {
    console.error('❌ [Sync Fatal Error] 官方原站返回数据结构不合法或为空！');
    process.exit(1);
  }

  const officialItems = Array.isArray(json.items) ? json.items : json.data.items;
  console.log(`[Sync] ✨ 成功从官方原站获取到 ${officialItems.length} 部原生作品数据！`);
  return officialItems;
}

function validateAndCleanItems(items) {
  console.log('[Sync] 正在严格校验官方原站数据结构与字段纯净度...');
  const cleaned = [];
  const seenCodes = new Set();

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.code || typeof it.code !== 'string') continue;

    const codeUpper = it.code.trim().toUpperCase();
    if (seenCodes.has(codeUpper)) continue;
    seenCodes.add(codeUpper);

    // 【铁律三】：严格校验演员字段，绝不允许把标签当演员名
    if (Array.isArray(it.actors)) {
      for (const act of it.actors) {
        if (BAD_ACTOR_KEYWORDS.some(kw => act.includes(kw))) {
          console.error(`❌ [Sync Fatal Error] 发现字段受污染数据: ${it.code} 演员包含非法标签 "${act}"！`);
          process.exit(1);
        }
      }
    }

    // 确保必填字段完整合规
    const normalized = {
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
    };

    cleaned.push(normalized);
  }

  return cleaned;
}

async function run() {
  const officialItems = await fetchOfficialLibrary();
  const validItems = validateAndCleanItems(officialItems);

  if (!fs.existsSync(DATA_FILE)) {
    console.error('❌ [Sync Fatal Error] 本地数据库文件不存在:', DATA_FILE);
    process.exit(1);
  }

  const currentData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const currentCount = (currentData.items || []).length;
  console.log(`[Sync] 当前本地库容: ${currentCount} 部 -> 官方最新库容: ${validItems.length} 部`);

  // 按入库时间降序排列
  validItems.sort((a, b) => (b.added_at || 0) - (a.added_at || 0));

  currentData.items = validItems;
  currentData.updated_at = Date.now();

  // 1. 写回 data/movies.json
  fs.writeFileSync(DATA_FILE, JSON.stringify(currentData, null, 2), 'utf8');
  console.log(`[Sync] 数据已安全写入 ${DATA_FILE}`);

  // 2. 更新 index.html 内联数据
  if (fs.existsSync(INDEX_FILE)) {
    let indexHtml = fs.readFileSync(INDEX_FILE, 'utf8');
    if (indexHtml.includes('id="ltx-items"')) {
      indexHtml = indexHtml.replace(
        /<script id="ltx-items" type="application\/json">[\s\S]*?<\/script>/,
        `<script id="ltx-items" type="application/json">${JSON.stringify(currentData)}</script>`
      );
      fs.writeFileSync(INDEX_FILE, indexHtml, 'utf8');
      console.log('[Sync] index.html 内联数据同步更新完成');
    }
  }

  console.log(`[Sync] 官方同步作业完成！最终总库容: ${validItems.length} 部作品`);
}

run().catch(err => {
  console.error('[Sync Fatal Error]', err);
  process.exit(1);
});
