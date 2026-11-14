#!/bin/bash
DIR="/data/home/jasna-ltx"
LOG_DIR="$DIR/logs"
LOG_FILE="$LOG_DIR/sync.log"
mkdir -p "$LOG_DIR"

echo "============================================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Jasna-LTX 开机/唤醒巡检同步任务触发" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"

cd "$DIR"

# 1. 优先拉取远端最新提交（避免冲突）
echo "[Git] 正在拉取远端最新代码..." >> "$LOG_FILE"
git pull origin main --rebase >> "$LOG_FILE" 2>&1 || echo "[Git] pull 提示: 当前已最新或已是最新提交" >> "$LOG_FILE"

# 2. 执行无盾官方发布流数据同步
echo "[Sync] 正在执行无盾官方发布流数据同步..." >> "$LOG_FILE"
node scripts/sync.js >> "$LOG_FILE" 2>&1

# 3. 统计当前最新条目数
ITEMS_COUNT=$(node -e "try { const d = require('./data/movies.json'); console.log((d.items || []).length); } catch(e) { console.log('0'); }")
echo "[Database] 当前片库条目总数: ${ITEMS_COUNT} 部作品" >> "$LOG_FILE"

# 4. 检查是否有新数据需要提交推送
if [ -n "$(git status --porcelain data/movies.json index.html)" ]; then
    echo "[Git] ✨ 检测到片库净增变动，正在自动提交并推送至 GitHub 仓库..." >> "$LOG_FILE"
    git add data/movies.json index.html
    git commit -m "chore(auto-sync): 云端自动同步最新片库至 ${ITEMS_COUNT} 部 [skip ci]" >> "$LOG_FILE" 2>&1
    if git push origin main >> "$LOG_FILE" 2>&1; then
        echo "[Git] 🚀 推送大获成功！GitHub 线上站点已同步更新至最新 ${ITEMS_COUNT} 部作品" >> "$LOG_FILE"
    else
        echo "[Git] ⚠️ 推送失败，请检查 SSH Deploy Key 写入权限" >> "$LOG_FILE"
    fi
else
    echo "[Git] 本地片库与远端完全对齐，无需重复提交。" >> "$LOG_FILE"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 本轮巡检同步执行完毕！" >> "$LOG_FILE"
