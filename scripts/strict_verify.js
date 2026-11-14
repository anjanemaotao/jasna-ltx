/**
 * Jasna-LTX 严格自检脚本 (strict_verify.js)
 * 作用：执行三大防糊弄硬指标校验，任一不合格立刻 exit 1
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_FILE = path.join(__dirname, '..', 'data', 'movies.json');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'sync.log');

console.log('=== [strict-ltx-verify] 启动防糊弄严格自检 ===');

// 1. 日志排查
if (fs.existsSync(LOG_FILE)) {
  const logContent = fs.readFileSync(LOG_FILE, 'utf8');
  const lastChunk = logContent.slice(-2000);
  if (lastChunk.includes('HTTP 403') || lastChunk.includes('403 Forbidden') || lastChunk.includes('请先完成人机验证')) {
    console.error('❌ [自检失败] 日志中包含 403 / 人机验证拦截记录，严禁冒充成功！');
    process.exit(1);
  }
}

// 2. 数据文件校验
if (!fs.existsSync(DATA_FILE)) {
  console.error('❌ [自检失败] 数据库文件不存在！');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const items = data.items || [];
console.log(`[自检] 当前片库总数: ${items.length} 部`);

if (items.length < 3193) {
  console.error(`❌ [自检失败] 片库数据量低于基础线 3193 部！当前: ${items.length}`);
  process.exit(1);
}

// 3. 抽检最新入库的 5 条数据
const sample = items.slice(0, 5);
const BAD_ACTOR_KEYWORDS = ['診断', '巨乳', '人妻', '中出し', '調教', '痴女', 'エロ', '不倫', 'セックス', '健康', 'アナル'];

for (let i = 0; i < sample.length; i++) {
  const it = sample[i];
  if (!it.code || !it.title || !Array.isArray(it.links) || !Array.isArray(it.pending_links)) {
    console.error(`❌ [自检失败] 第 ${i + 1} 条数据结构缺失必填字段:`, it);
    process.exit(1);
  }

  // 校验演员名是否被标题/标签污染
  if (Array.isArray(it.actors)) {
    for (const act of it.actors) {
      if (BAD_ACTOR_KEYWORDS.some(kw => act.includes(kw))) {
        console.error(`❌ [自检失败] 检测到脏数据！演员字段被标签污染: "${act}" (番号: ${it.code})`);
        process.exit(1);
      }
    }
  }
}

console.log('✅ [自检通过] 最新 5 条数据结构纯净，无标签污染演员字段。');
console.log('=== [strict-ltx-verify] 严格自检全部合格 ===');
