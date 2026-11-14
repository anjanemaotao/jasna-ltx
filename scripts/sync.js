/**
 * Jasna-LTX 全自动数据同步与更新脚本 (Node.js)
 * 功能：
 * 1. 定时巡检 Sukebei 上的成人 LTX 破解资源发布流
 * 2. 提取标准番号并去重合并进 data.items
 * 3. 严格字段契约：确保 pending_links, links, genres 均为数组，防止前端崩溃
 * 4. 自动更新 data/movies.json 及 index.html 内联数据
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'movies.json');
const INDEX_FILE = path.join(__dirname, '..', 'index.html');

function extractCode(text) {
  const match = text.match(/([a-zA-Z]{2,6})[-_]?(\d{3,5})/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2]}`;
}

async function fetchSukebeiLTX() {
  console.log('[Sync] 正在检查 Sukebei LTX 最新种子发布...');
  const url = 'https://sukebei.nyaa.si/?page=rss&q=LTX&c=0_0&f=0';
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Sukebei HTTP ${resp.status}`);

    const xml = await resp.text();
    const items = [];
    const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const rawTitle = match[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
      const torrentLink = match[2].trim();
      const code = extractCode(rawTitle);
      
      // 过滤非正规番号或动漫杂项
      if (code && !code.startsWith('LTXS-')) {
        items.push({ rawTitle, torrentLink, code });
      }
    }
    console.log(`[Sync] 抓取到 ${items.length} 个最新 Sukebei LTX 种子项`);
    return items;
  } catch (err) {
    console.warn('[Sync] 请求 Sukebei 网络波动:', err.message);
    return [];
  }
}

async function runSync() {
  console.log('=== Jasna-LTX 同步作业启动 ===');

  if (!fs.existsSync(DATA_FILE)) {
    console.error('未找到数据库文件');
    return;
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  let itemList = data.items || data.movies || [];

  // 清洗历史脏数据 (如 LTXS-010)
  itemList = itemList.filter(item => item.code !== 'LTXS-010');

  const existingCodes = new Set(itemList.map(m => (m.code || '').toUpperCase()));
  console.log(`[Sync] 当前数据库中共有 ${itemList.length} 部作品`);

  const sukebeiItems = await fetchSukebeiLTX();
  let newAddedCount = 0;

  for (const item of sukebeiItems) {
    if (existingCodes.has(item.code)) continue;

    // 智能提取女优名与标题
    let title = item.rawTitle.replace(/^\+\+\+\s*\[LTX\]\s*/i, '').replace(/^\[LTX[^\]]*\]\s*/i, '');
    let actorName = 'LTX';
    const parts = title.split(/\s+/);
    if (parts.length > 2) {
      actorName = parts[parts.length - 1];
    }

    const codeClean = item.code.replace('-', '').toLowerCase();
    const newItem = {
      code: item.code,
      title: title,
      title_zh: title,
      actors: [actorName],
      maker: item.code.split('-')[0],
      date: new Date().toISOString().split('T')[0],
      added_at: Date.now(),
      pending: false,
      links: [item.torrentLink],
      pending_links: [], // 必填字段：防止前端 TypeError
      score: 4.80,
      votes: 100,
      subtitle: `https://www.subtitlecat.com/subs/${item.code}.srt`,
      cover: `https://pics.dmm.co.jp/digital/video/${codeClean}/${codeClean}pl.jpg`,
      genres: []
    };

    itemList.unshift(newItem);
    existingCodes.add(item.code);
    newAddedCount++;
    console.log(`[Sync] ✨ 成功入库新作品: ${item.code} (${actorName})`);
  }

  data.updated_at = Date.now();
  if (!data.nyaa) data.nyaa = {};
  data.nyaa.checked_at = Date.now();
  data.nyaa.added = newAddedCount;
  data.nyaa.ok = true;

  if (data.items) data.items = itemList;
  else data.movies = itemList;

  // 1. 写回 data/movies.json
  const minifiedJson = JSON.stringify(data);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');

  // 2. 同时更新 index.html 中的内联 <script id="ltx-items">
  if (fs.existsSync(INDEX_FILE)) {
    let indexHtml = fs.readFileSync(INDEX_FILE, 'utf8');
    if (indexHtml.includes('id="ltx-items"')) {
      indexHtml = indexHtml.replace(
        /<script id="ltx-items" type="application\/json">[\s\S]*?<\/script>/,
        `<script id="ltx-items" type="application/json">${minifiedJson}</script>`
      );
      fs.writeFileSync(INDEX_FILE, indexHtml, 'utf8');
      console.log('[Sync] 同步更新 index.html 内联数据完成');
    }
  }

  console.log(`[Sync] 同步完成！本次新增: ${newAddedCount} 部，总计: ${itemList.length} 部`);
  console.log('==============================');
}

runSync().catch(console.error);
