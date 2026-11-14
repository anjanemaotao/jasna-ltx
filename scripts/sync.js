/**
 * Jasna-LTX 专属原站镜像同步脚本 (Node.js)
 * 严格原则：仅从官方原站 https://ltx.libray.workers.dev/ 同步，绝不接入外部第三方种子源！
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'movies.json');
const INDEX_FILE = path.join(__dirname, '..', 'index.html');

async function syncWithOriginal() {
  console.log('=== Jasna-LTX 原站镜像同步启动 ===');
  console.log('[Sync] 正在检查官方原站 https://ltx.libray.workers.dev/ 更新...');

  const originalUrl = 'https://ltx.libray.workers.dev/api/items';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(originalUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://ltx.libray.workers.dev/'
      }
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.items && data.items.length > 0) {
        // 确保 pending_links 格式安全
        data.items.forEach(it => {
          if (!Array.isArray(it.pending_links)) it.pending_links = [];
          if (!Array.isArray(it.links)) it.links = [];
        });
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
        
        // 同步更新 index.html
        if (fs.existsSync(INDEX_FILE)) {
          let html = fs.readFileSync(INDEX_FILE, 'utf8');
          const minified = JSON.stringify(data);
          html = html.replace(
            /<script id="ltx-items" type="application\/json">[\s\S]*?<\/script>/,
            `<script id="ltx-items" type="application/json">${minified}</script>`
          );
          fs.writeFileSync(INDEX_FILE, html, 'utf8');
        }
        console.log(`[Sync] ✨ 成功从官方原站同步更新！总计: ${data.items.length} 部作品`);
        return;
      }
    } else {
      console.log(`[Sync] 官方原站响应 HTTP ${resp.status} (受 Cloudflare 保护)，保持当前纯净数据库。`);
    }
  } catch (err) {
    console.log('[Sync] 连接官方原站提示:', err.message, '，保持当前纯净数据库。');
  }

  // 保持当前纯正库容不变
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`[Sync] 当前纯正原站库容保持不变: ${(data.items || []).length} 部作品`);
  }
}

syncWithOriginal().catch(console.error);
