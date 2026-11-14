/**
 * Jasna-LTX 全自动数据同步与更新脚本 (Node.js)
 * 功能：
 * 1. 定时巡检 Nyaa 上的 LTX 资源更新
 * 2. 提取番号并去重合并进 data.items (3,193+ 部作品)
 * 3. 自动更新时间戳并保存
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'movies.json');

function extractCode(text) {
  const match = text.match(/([a-zA-Z]{2,6})[-_]?(\d{3,5})/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2]}`;
}

async function fetchNyaaLTX() {
  console.log('[Sync] 正在检查 Nyaa LTX 最新种子发布...');
  const url = 'https://nyaa.si/?page=rss&q=LTX&c=0_0&f=0';
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Nyaa HTTP ${resp.status}`);

    const xml = await resp.text();
    const items = [];
    const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const rawTitle = match[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
      const torrentLink = match[2];
      const code = extractCode(rawTitle);
      if (code) {
        items.push({ rawTitle, torrentLink, code });
      }
    }
    console.log(`[Sync] 抓取到 ${items.length} 个最新 Nyaa LTX 种子项`);
    return items;
  } catch (err) {
    console.warn('[Sync] 请求 Nyaa 网络波动:', err.message);
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
  const itemList = data.items || data.movies || [];
  const existingCodes = new Set(itemList.map(m => (m.code || '').toUpperCase()));

  console.log(`[Sync] 当前数据库中共有 ${itemList.length} 部作品`);

  const nyaaItems = await fetchNyaaLTX();
  let newAddedCount = 0;

  for (const item of nyaaItems) {
    if (existingCodes.has(item.code)) continue;

    const codeClean = item.code.replace('-', '').toLowerCase();
    const newItem = {
      code: item.code,
      title: item.rawTitle,
      title_zh: item.rawTitle,
      actors: ["LTX New"],
      maker: item.code.split('-')[0],
      date: new Date().toISOString().split('T')[0],
      added_at: Date.now(),
      pending: false,
      score: 4.80,
      votes: 100,
      links: [item.torrentLink],
      subtitle: `https://www.subtitlecat.com/subs/${item.code}.srt`,
      cover: `https://pics.dmm.co.jp/digital/video/${codeClean}/${codeClean}pl.jpg`,
      genres: []
    };

    itemList.unshift(newItem);
    existingCodes.add(item.code);
    newAddedCount++;
    console.log(`[Sync] ✨ 成功入库新作品: ${item.code}`);
  }

  data.updated_at = Date.now();
  if (!data.nyaa) data.nyaa = {};
  data.nyaa.checked_at = Date.now();
  data.nyaa.added = newAddedCount;
  data.nyaa.ok = true;

  if (data.items) data.items = itemList;
  else data.movies = itemList;

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[Sync] 同步完成！本次新增: ${newAddedCount} 部，总计: ${itemList.length} 部`);
  console.log('==============================');
}

runSync().catch(console.error);