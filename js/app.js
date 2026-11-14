// Jasna-LTX 核心前端引擎 (完整支持原站 api/items 格式与本地格式)
(function() {
  'use strict';

  // 状态中心
  const state = {
    allMovies: [],
    filteredMovies: [],
    displayMovies: [],
    pageSize: 30,
    currentPage: 1,
    currentSort: 'score',
    confirmFilter: 'all', // 'all' | 'confirmed' | 'unconfirmed'
    searchQuery: '',
    actorQuery: '',
    selectedActor: '',
    showOnlyWant: false,
    wantList: new Set(JSON.parse(localStorage.getItem('jasna_wants') || '[]')),
    settings: JSON.parse(localStorage.getItem('jasna_settings') || JSON.stringify({
      trimFilename: true,
      showZh: true,
      aria2Url: 'http://localhost:6800/jsonrpc',
      aria2Token: '',
      aria2Dir: '',
      cid115: '0'
    }))
  };

  // DOM 元素引用
  const dom = {
    globalSearch: document.getElementById('global-search'),
    actorSearch: document.getElementById('actor-search'),
    actorList: document.getElementById('actor-list'),
    cardsContainer: document.getElementById('cards-container'),
    sentinel: document.getElementById('sentinel'),
    toast: document.getElementById('toast'),
    toastText: document.getElementById('toast-text'),
    wantCount: document.getElementById('want-count'),
    btnWant: document.getElementById('btn-want'),
    btnShuffle: document.getElementById('btn-shuffle'),
    btnBatch: document.getElementById('btn-batch'),
    btnSettings: document.getElementById('btn-settings'),
    updateTimeText: document.getElementById('update-time-text'),
    updateIndicator: document.getElementById('update-indicator'),
    tabCountAll: document.getElementById('tab-count-all'),
    tabCountConfirmed: document.getElementById('tab-count-confirmed'),
    tabCountUnconfirmed: document.getElementById('tab-count-unconfirmed'),
    batchCount: document.getElementById('batch-count'),
    // 弹窗
    modalBatch: document.getElementById('modal-batch'),
    modalSettings: document.getElementById('modal-settings'),
    batchLinksText: document.getElementById('batch-links-text'),
    batchModalCount: document.getElementById('batch-modal-count'),
    batchModalSize: document.getElementById('batch-modal-size'),
    btnCopyAllLinks: document.getElementById('btn-copy-all-links')
  };

  // 初始化入口
  async function init() {
    bindEvents();
    loadSettingsIntoUI();
    updateWantBadge();

    try {
      const resp = await fetch('data/movies.json');
      const rawData = await resp.json();
      
      // 兼容原站 api/items 结构与自定义 movies 结构
      let rawList = [];
      if (Array.isArray(rawData)) {
        rawList = rawData;
      } else if (rawData.items && Array.isArray(rawData.items)) {
        rawList = rawData.items;
      } else if (rawData.movies && Array.isArray(rawData.movies)) {
        rawList = rawData.movies;
      }

      // 标准化数据模型
      state.allMovies = rawList.map(item => normalizeMovie(item));

      // 更新时间戳
      if (rawData.updated_at) {
        const d = new Date(typeof rawData.updated_at === 'number' ? rawData.updated_at : rawData.updated_at);
        const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        dom.updateTimeText.textContent = `资源更新于 ${dateStr}`;
        if (rawData.nyaa) {
          dom.updateIndicator.title = `最后更新时间：${d.toLocaleString()}\n上次自动检查 nyaa：${rawData.nyaa.checked_at ? new Date(rawData.nyaa.checked_at).toLocaleString() : '未知'}`;
        }
      } else if (rawData.metadata) {
        if (rawData.metadata.last_added) {
          dom.updateTimeText.textContent = `资源更新于 ${rawData.metadata.last_added.substring(5, 16)}`;
          dom.updateIndicator.title = `最后一次新增资源：${rawData.metadata.last_added}\n上次自动检查 nyaa：${rawData.metadata.last_checked_nyaa || '未知'}`;
        }
      }
      
      applyFilters();
      initObserver();
    } catch (err) {
      console.error('加载本地数据库失败:', err);
      showToast('加载数据库失败，请刷新重试');
    }
  }

  // 统一数据格式转换
  function normalizeMovie(m) {
    const rawLinks = m.links || (m.download ? [m.download.link] : []);
    const firstLink = rawLinks[0] || '';
    const isEd2k = firstLink.startsWith('ed2k://');
    const isMagnet = firstLink.startsWith('magnet:?');

    // 解析体积
    let size = m.download?.size || '未知';
    if (size === '未知' && isEd2k) {
      const parts = firstLink.split('|');
      if (parts[3]) {
        const bytes = parseInt(parts[3], 10);
        if (!isNaN(bytes)) {
          size = (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
        }
      }
    }

    return {
      code: m.code || '',
      title: m.title || '',
      title_zh: m.title_zh || m.title || '',
      actresses: m.actors || m.actresses || [],
      maker: m.maker || '',
      date: m.date || '',
      added: m.added_at ? new Date(m.added_at).toISOString() : (m.added || ''),
      confirmed: m.pending !== undefined ? !m.pending : (m.confirmed !== false),
      score: m.score || 0,
      javdb_score: m.score || m.javdb_score || 0,
      javdb_votes: m.votes || m.javdb_votes || 0,
      cover_url: m.cover || m.cover_url || '',
      subtitle_url: m.subtitle || m.subtitle_url || '',
      shot: m.shot || '',
      links: rawLinks,
      download: {
        type: isEd2k ? 'ed2k' : (isMagnet ? 'magnet' : 'http'),
        size: size,
        link: firstLink
      }
    };
  }

  // 绑定交互事件
  function bindEvents() {
    // 全局快捷键 /
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== dom.globalSearch && document.activeElement !== dom.actorSearch) {
        e.preventDefault();
        dom.globalSearch.focus();
      }
    });

    // 搜索监听
    dom.globalSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      applyFilters();
    });

    dom.actorSearch.addEventListener('input', (e) => {
      state.actorQuery = e.target.value.trim().toLowerCase();
      renderSidebar();
    });

    // 排序按钮组
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentSort = btn.dataset.sort;
        applyFilters();
      });
    });

    // 状态切换选项卡
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.confirmFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    // 想看开关
    dom.btnWant.addEventListener('click', () => {
      state.showOnlyWant = !state.showOnlyWant;
      dom.btnWant.classList.toggle('active', state.showOnlyWant);
      applyFilters();
    });

    // 随机乱序
    dom.btnShuffle.addEventListener('click', () => {
      state.filteredMovies.sort(() => Math.random() - 0.5);
      renderCards(true);
      showToast('已随机打乱排序');
    });

    // 弹窗开关
    dom.btnBatch.addEventListener('click', openBatchModal);
    dom.btnSettings.addEventListener('click', () => dom.modalSettings.classList.add('open'));

    document.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.close;
        document.getElementById(modalId).classList.remove('open');
      });
    });

    // 复制全部链接
    dom.btnCopyAllLinks.addEventListener('click', () => {
      copyToClipboard(dom.batchLinksText.value, '已复制全部下载链接');
    });

    // 保存配置
    document.getElementById('btn-save-settings').addEventListener('click', saveSettingsFromUI);
  }

  // 综合过滤与排序调度
  function applyFilters() {
    let list = state.allMovies.slice();

    // 1. 确认状态过滤
    if (state.confirmFilter === 'confirmed') {
      list = list.filter(m => m.confirmed);
    } else if (state.confirmFilter === 'unconfirmed') {
      list = list.filter(m => !m.confirmed);
    }

    // 2. 想看过滤
    if (state.showOnlyWant) {
      list = list.filter(m => state.wantList.has(m.code));
    }

    // 3. 女优筛选
    if (state.selectedActor) {
      list = list.filter(m => (m.actresses || []).includes(state.selectedActor));
    }

    // 4. 全局搜索
    if (state.searchQuery) {
      const q = state.searchQuery;
      list = list.filter(m => {
        return (m.code && m.code.toLowerCase().includes(q)) ||
               (m.title && m.title.toLowerCase().includes(q)) ||
               (m.title_zh && m.title_zh.toLowerCase().includes(q)) ||
               (m.maker && m.maker.toLowerCase().includes(q)) ||
               ((m.actresses || []).some(a => a.toLowerCase().includes(q)));
      });
    }

    // 5. 排序规则
    list.sort((a, b) => {
      switch (state.currentSort) {
        case 'score':
          return (b.score || 0) - (a.score || 0);
        case 'date':
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        case 'added':
          return new Date(b.added).getTime() - new Date(a.added).getTime();
        case 'size':
          return parseSize(b.download?.size) - parseSize(a.download?.size);
        case 'code':
          return (a.code || '').localeCompare(b.code || '');
        default:
          return 0;
      }
    });

    state.filteredMovies = list;
    state.currentPage = 1;

    updateCounters();
    renderSidebar();
    renderCards(true);
  }

  // 更新计数
  function updateCounters() {
    const total = state.allMovies.length;
    const confirmed = state.allMovies.filter(m => m.confirmed).length;
    const unconfirmed = total - confirmed;

    dom.tabCountAll.textContent = total;
    dom.tabCountConfirmed.textContent = confirmed;
    dom.tabCountUnconfirmed.textContent = unconfirmed;
    dom.batchCount.textContent = state.filteredMovies.length;
  }

  // 渲染侧边栏女优列表
  function renderSidebar() {
    const actorCounts = {};
    state.allMovies.forEach(m => {
      (m.actresses || []).forEach(a => {
        actorCounts[a] = (actorCounts[a] || 0) + 1;
      });
    });

    let actors = Object.keys(actorCounts).map(name => ({
      name,
      count: actorCounts[name]
    }));

    if (state.actorQuery) {
      actors = actors.filter(a => a.name.toLowerCase().includes(state.actorQuery));
    }

    actors.sort((a, b) => b.count - a.count);

    let html = `
      <button class="actor-item ${!state.selectedActor ? 'active' : ''}" data-actor="">
        <span>全部作品</span>
        <span class="badge">${state.allMovies.length}</span>
      </button>
    `;

    actors.forEach(actor => {
      const isActive = state.selectedActor === actor.name;
      html += `
        <button class="actor-item ${isActive ? 'active' : ''}" data-actor="${escapeHtml(actor.name)}">
          <span>${escapeHtml(actor.name)}</span>
          <span class="badge">${actor.count}</span>
        </button>
      `;
    });

    dom.actorList.innerHTML = html;

    dom.actorList.querySelectorAll('.actor-item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedActor = btn.dataset.actor;
        applyFilters();
      });
    });
  }

  // 渲染作品卡片流
  function renderCards(reset = false) {
    if (reset) {
      dom.cardsContainer.innerHTML = '';
      state.currentPage = 1;
    }

    const start = (state.currentPage - 1) * state.pageSize;
    const end = start + state.pageSize;
    const chunk = state.filteredMovies.slice(start, end);

    if (chunk.length === 0 && reset) {
      dom.cardsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: var(--text-dim)">
          <div style="font-size: 2rem; margin-bottom: 8px;">🔍</div>
          <div>未找到匹配的 LTX 资源</div>
        </div>
      `;
      return;
    }

    const frag = document.createDocumentFragment();

    chunk.forEach(movie => {
      const isWanted = state.wantList.has(movie.code);
      const title = state.settings.showZh && movie.title_zh ? movie.title_zh : movie.title;
      const actress = (movie.actresses && movie.actresses[0]) || '未知';
      const dl = movie.download || { type: 'ed2k', size: '未知', link: '' };

      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `
        <div class="cover-wrapper">
          <img src="${movie.cover_url || ''}" alt="${movie.code}" loading="lazy" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 280 400\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23141418\\'/><text x=\\'50%\\' y=\\'50%\\' fill=\\'%235c5c68\\' font-size=\\'18\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\'>封面加载中</text></svg>'">
          <div class="overlay-tools">
            <span class="code-pill" title="点击复制番号">${movie.code}</span>
            <div class="card-top-actions">
              <button class="round-action-btn btn-want-card ${isWanted ? 'active' : ''}" title="${isWanted ? '取消想看' : '加入想看'}">
                ${isWanted ? '❤️' : '🤍'}
              </button>
            </div>
          </div>
          ${!movie.confirmed ? '<div class="tag-unconfirmed">待确认</div>' : ''}
          <div class="rating-badge">★ ${movie.score || movie.javdb_score || '0.00'} <small>${movie.javdb_votes || 0}</small></div>
        </div>
        <div class="card-info">
          <h3 class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
          <div class="meta-row">
            <span class="actor-tag">${escapeHtml(actress)}</span>
            <span class="date">${movie.date || ''}</span>
            <span class="maker-tag">${movie.maker || ''}</span>
            ${movie.subtitle_url ? `<a href="${movie.subtitle_url}" target="_blank" class="sub-badge" title="中文字幕直链">字</a>` : ''}
          </div>
          <div class="card-actions">
            <button class="copy-btn btn-copy-dl" title="复制下载链接">
              复制 ${dl.type.toUpperCase()} · ${dl.size}
            </button>
            <button class="download-btn btn-send-dl" title="添加到下载器">
              添加到下载
            </button>
          </div>
        </div>
      `;

      card.querySelector('.code-pill').addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(movie.code, `已复制番号 ${movie.code}`);
      });

      card.querySelector('.btn-want-card').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWant(movie.code);
        card.querySelector('.btn-want-card').textContent = state.wantList.has(movie.code) ? '❤️' : '🤍';
      });

      card.querySelector('.btn-copy-dl').addEventListener('click', (e) => {
        e.stopPropagation();
        let link = dl.link;
        if (state.settings.trimFilename && dl.type === 'ed2k') {
          link = link.replace(/\|file\|[^|]+\|/, `|file|${movie.code}.mp4|`);
        }
        copyToClipboard(link, `已复制 ${movie.code} 下载链接`);
      });

      card.querySelector('.btn-send-dl').addEventListener('click', (e) => {
        e.stopPropagation();
        sendToDownloader(movie);
      });

      card.querySelector('.actor-tag').addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedActor = actress;
        applyFilters();
      });

      frag.appendChild(card);
    });

    dom.cardsContainer.appendChild(frag);
  }

  // 无限滚动
  function initObserver() {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        const totalPages = Math.ceil(state.filteredMovies.length / state.pageSize);
        if (state.currentPage < totalPages) {
          state.currentPage++;
          renderCards(false);
        }
      }
    }, { threshold: 0.1 });

    observer.observe(dom.sentinel);
  }

  // 剪贴板
  function copyToClipboard(text, message = '已复制到剪贴板') {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => showToast(message));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(message);
    }
  }

  let toastTimer = null;
  function showToast(msg) {
    clearTimeout(toastTimer);
    dom.toastText.textContent = msg;
    dom.toast.classList.add('show');
    toastTimer = setTimeout(() => {
      dom.toast.classList.remove('show');
    }, 2200);
  }

  function toggleWant(code) {
    if (state.wantList.has(code)) {
      state.wantList.delete(code);
      showToast(`已移出想看：${code}`);
    } else {
      state.wantList.add(code);
      showToast(`已加入想看：${code}`);
    }
    localStorage.setItem('jasna_wants', JSON.stringify(Array.from(state.wantList)));
    updateWantBadge();
    if (state.showOnlyWant) {
      applyFilters();
    }
  }

  function updateWantBadge() {
    dom.wantCount.textContent = state.wantList.size;
  }

  function openBatchModal() {
    dom.batchModalCount.textContent = state.filteredMovies.length;
    let totalGB = 0;
    const links = [];

    state.filteredMovies.forEach(m => {
      if (m.download && m.download.link) {
        links.push(m.download.link);
        totalGB += parseSize(m.download.size);
      }
    });

    dom.batchModalSize.textContent = `${totalGB.toFixed(1)} GB`;
    dom.batchLinksText.value = links.join('\n');
    dom.modalBatch.classList.add('open');
  }

  async function sendToDownloader(movie) {
    const link = movie.download?.link;
    if (!link) {
      showToast('该作品暂无下载链接');
      return;
    }

    if (!state.settings.aria2Url) {
      dom.modalSettings.classList.add('open');
      showToast('请先配置 Aria2 RPC 地址');
      return;
    }

    showToast(`正在推送 ${movie.code} 到 Aria2...`);

    const rpcPayload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'aria2.addUri',
      params: []
    };

    if (state.settings.aria2Token) {
      rpcPayload.params.push(`token:${state.settings.aria2Token}`);
    }

    rpcPayload.params.push([link]);

    const options = {};
    if (state.settings.aria2Dir) {
      options.dir = state.settings.aria2Dir;
    }
    if (Object.keys(options).length > 0) {
      rpcPayload.params.push(options);
    }

    try {
      const resp = await fetch(state.settings.aria2Url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcPayload)
      });
      const res = await resp.json();
      if (res.result) {
        showToast(`✅ ${movie.code} 成功添加至 Aria2！`);
      } else {
        throw new Error(res.error?.message || '未知错误');
      }
    } catch (e) {
      console.warn('Aria2 推送失败:', e);
      showToast(`推送失败: 浏览器跨域阻止或 Aria2 未启动，已自动复制链接`);
      copyToClipboard(link);
    }
  }

  function loadSettingsIntoUI() {
    document.getElementById('setting-trim-filename').checked = state.settings.trimFilename;
    document.getElementById('setting-show-zh').checked = state.settings.showZh;
    document.getElementById('setting-aria2-url').value = state.settings.aria2Url || '';
    document.getElementById('setting-aria2-token').value = state.settings.aria2Token || '';
    document.getElementById('setting-aria2-dir').value = state.settings.aria2Dir || '';
    document.getElementById('setting-115-cid').value = state.settings.cid115 || '0';
  }

  function saveSettingsFromUI() {
    state.settings.trimFilename = document.getElementById('setting-trim-filename').checked;
    state.settings.showZh = document.getElementById('setting-show-zh').checked;
    state.settings.aria2Url = document.getElementById('setting-aria2-url').value.trim();
    state.settings.aria2Token = document.getElementById('setting-aria2-token').value.trim();
    state.settings.aria2Dir = document.getElementById('setting-aria2-dir').value.trim();
    state.settings.cid115 = document.getElementById('setting-115-cid').value.trim();

    localStorage.setItem('jasna_settings', JSON.stringify(state.settings));
    dom.modalSettings.classList.remove('open');
    showToast('配置已保存');
    applyFilters();
  }

  function parseSize(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/([\d.]+)\s*([GMK]?)B?/i);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    const unit = (match[2] || 'G').toUpperCase();
    if (unit === 'G') return val;
    if (unit === 'M') return val / 1024;
    if (unit === 'K') return val / (1024 * 1024);
    return val;
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  window.addEventListener('DOMContentLoaded', init);
})();