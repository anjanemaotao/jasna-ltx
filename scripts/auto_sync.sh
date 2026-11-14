#!/bin/bash
set -e

DIR="/data/home/jasna-ltx"
LOG_DIR="$DIR/logs"
LOG_FILE="$LOG_DIR/sync.log"
mkdir -p "$LOG_DIR"

echo "============================================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Jasna-LTX 官方原站同步任务启动" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"

cd "$DIR"

# 1. 检查远端代码
echo "[Git] 正在拉取远端最新代码..." >> "$LOG_FILE"
git pull origin main --rebase >> "$LOG_FILE" 2>&1 || echo "[Git] pull 提示: 当前已最新" >> "$LOG_FILE"

# 2. 执行官方原站同步（铁律：遇到 403 / 拦截直接非 0 中断退出）
echo "[Sync] 正在执行官方原站数据同步..." >> "$LOG_FILE"
if ! node scripts/sync.js >> "$LOG_FILE" 2>&1; then
    echo "❌ [$(date '+%Y-%m-%d %H:%M:%S')] [Sync FAILED] 官方原站同步失败中断（触发铁律二报错）！" >> "$LOG_FILE"
    exit 1
fi

# 3. 执行严格自检技能
echo "[Verify] 正在执行严格防糊弄自检..." >> "$LOG_FILE"
if ! node scripts/strict_verify.js >> "$LOG_FILE" 2>&1; then
    echo "❌ [$(date '+%Y-%m-%d %H:%M:%S')] [Verify FAILED] 自检未通过！" >> "$LOG_FILE"
    exit 1
fi

# 4. 统计条目总数
ITEMS_COUNT=$(node -e "try { const d = require('./data/movies.json'); console.log((d.items || []).length); } catch(e) { console.log('0'); }")
echo "[Database] 当前官方原站条目总数: ${ITEMS_COUNT} 部作品" >> "$LOG_FILE"

# 5. 检测变动并自动推送
if [ -n "$(git status --porcelain data/movies.json index.html)" ]; then
    echo "[Git] 检测到官方原站数据更新，正在提交并推送..." >> "$LOG_FILE"
    git add data/movies.json index.html
    git commit -m "chore(auto-sync): 官方原站原生数据自动同步至 ${ITEMS_COUNT} 部 [skip ci]" >> "$LOG_FILE" 2>&1
    git push origin main >> "$LOG_FILE" 2>&1
    echo "[Git] ✨ 成功推送到 GitHub 远端仓库！" >> "$LOG_FILE"
else
    echo "[Git] 本地数据已是官方最新，无需重复提交。" >> "$LOG_FILE"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 官方同步与自检全部顺利完成！" >> "$LOG_FILE"
