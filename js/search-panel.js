// search-panel.js - 搜索 + 登录 UI
// 不强制登录：页面直接加载播放器，后台静默 /api/status
// 未登录时搜索按钮显示"登录后搜索"，点击才弹登录面板
// 搜索框防抖 300ms + AbortController 取消旧请求
console.log('[search-panel.js] loaded');

(function () {
  let searchAbort = null; // AbortController，取消旧搜索
  let qrPollTimer = null;
  let currentQuery = '';
  let currentPage = 0;
  let hasMore = false;
  let loadingMore = false;
  let totalRendered = 0;
  let biliResolved = null;
  const SEARCH_PAGE_SIZE = 30;
  const BILI_SUBTITLE_LIMIT = 1024 * 1024;
  const BILI_COVER_LIMIT = 5 * 1024 * 1024;
  const SEARCH_PROVIDER_KEY = 'searchLastProvider';
  const PROVIDERS = {
    netease: { label: '网易云', loginTitle: '登录网易云音乐', loginHint: '请使用网易云音乐 App 扫码登录', cacheKey: 'neteaseLoginState' },
    qq: { label: 'QQ', loginTitle: '登录 QQ 音乐', loginHint: '请使用 QQ 音乐 App 扫码登录', cacheKey: 'qqLoginState' },
    bilibili: { label: '哔哩哔哩', loginTitle: 'B 站 Cookie', loginHint: '粘贴 bilibili.com Cookie 并验证，通过后才会保存登录状态。', cacheKey: 'bilibiliLoginState' },
  };
  let activeProvider = loadSavedProvider();
  let activeLoginType = 'qq';
  const loginStates = {
    netease: { loggedIn: false, nickname: null, trustedUntil: 0 },
    qq: { loggedIn: false, nickname: null, trustedUntil: 0 },
    bilibili: { loggedIn: false, nickname: null, trustedUntil: 0 },
  };

  function loadSavedProvider() {
    try {
      const saved = localStorage.getItem(SEARCH_PROVIDER_KEY);
      return PROVIDERS[saved] ? saved : 'netease';
    } catch (e) {
      return 'netease';
    }
  }

  function saveActiveProvider() {
    try { localStorage.setItem(SEARCH_PROVIDER_KEY, activeProvider); } catch (e) {}
  }

  // ===== 创建 UI DOM =====
  function ensureUI() {
    if (document.getElementById('search-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'search-overlay';
    overlay.className = 'search-overlay';
    overlay.innerHTML = `
      <div class="search-panel">
        <div class="search-header">
          <div class="search-field">
            <input type="text" id="search-input" placeholder="输入后按回车搜索..." autocomplete="off">
            <button type="button" id="search-submit" class="search-submit" aria-label="搜索">
              <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"/></svg>
            </button>
          </div>
          <div class="provider-switch" data-provider-switch role="tablist" aria-label="音乐平台">
            <button type="button" data-provider="netease" class="active">网易云</button>
            <button type="button" data-provider="qq">QQ</button>
            <button type="button" data-provider="bilibili">哔哩哔哩</button>
          </div>
          <div class="search-status" id="search-status"></div>
        </div>
        <div class="search-results" id="search-results"></div>
        <div class="search-toast" id="search-toast" role="status" aria-live="polite"></div>
      </div>
      <div class="login-panel login-hidden" id="login-panel">
        <button class="login-close" id="login-close" aria-label="关闭">&times;</button>
        <div class="login-content">
          <div class="provider-switch login-provider-switch" data-provider-switch role="tablist" aria-label="音乐平台">
            <button type="button" data-provider="netease" class="active">网易云</button>
            <button type="button" data-provider="qq">QQ</button>
            <button type="button" data-provider="bilibili">哔哩哔哩</button>
          </div>
          <h3 id="login-title">登录网易云音乐</h3>
          <p class="login-hint" id="login-hint">请使用网易云音乐 App 扫码登录</p>
          <div class="login-qr-section" id="login-qr-section">
            <div class="login-type-switch" id="login-type-switch">
              <button type="button" data-login-type="qq" class="active">QQ音乐扫码</button>
              <button type="button" data-login-type="wechat">微信扫码</button>
            </div>
            <div class="qr-wrap">
              <div class="qr-spinner" id="qr-spinner"></div>
              <img id="qr-image" class="qr-image" alt="登录二维码">
            </div>
            <p class="qr-status" id="qr-status">正在生成二维码...</p>
            <button class="qr-refresh" id="qr-refresh">刷新二维码</button>
          </div>
          <div class="login-cookie-section login-hidden" id="login-cookie-section">
            <textarea id="login-bili-cookie-text" rows="5" placeholder="粘贴 bilibili.com Cookie，通常包含 SESSDATA、bili_jct 等字段"></textarea>
            <p class="qr-status" id="login-bili-cookie-status">Cookie 会先验证有效性，通过后才保存到本地 HttpOnly Cookie。</p>
            <div class="login-cookie-actions">
              <button type="button" id="login-bili-cookie-verify">验证并登录</button>
              <button type="button" id="login-bili-cookie-clear">清除登录</button>
            </div>
          </div>
          <div class="login-session login-hidden" id="login-session">
            <div class="login-session-mark">✓</div>
            <div class="login-session-title" id="login-session-title">已登录</div>
            <div class="login-session-name" id="login-session-name"></div>
            <button type="button" class="login-logout" id="login-logout">退出登录</button>
          </div>
        </div>
      </div>
      <div class="bili-panel login-hidden" id="bili-panel">
        <div class="bili-head">
          <h3>B站导入</h3>
          <button type="button" class="bili-close" id="bili-close" aria-label="关闭">&times;</button>
        </div>
        <div class="bili-row">
          <input type="text" id="bili-input" placeholder="粘贴 BV 号、B站链接或 b23.tv 短链" autocomplete="off">
          <button type="button" id="bili-resolve">解析</button>
        </div>
        <div class="bili-status" id="bili-status"></div>
        <div class="bili-preview login-hidden" id="bili-preview">
          <img id="bili-cover-preview" alt="">
          <div class="bili-preview-info">
            <div class="bili-title" id="bili-title"></div>
            <div class="bili-artist" id="bili-artist"></div>
          </div>
        </div>
        <label class="bili-field login-hidden" id="bili-page-field"><span>分 P</span><select id="bili-page"></select></label>
        <label class="bili-check"><input type="checkbox" id="bili-bg-video"> 使用视频作为背景</label>
        <label class="bili-field"><span>字幕</span><input type="file" id="bili-subtitle-file" accept=".srt,.vtt,.lrc,.json,text/*,application/json"></label>
        <label class="bili-field"><span>封面</span><input type="file" id="bili-cover-file" accept="image/*"></label>
        <details class="bili-cookie">
          <summary>可选：导入 B站 Cookie</summary>
          <textarea id="bili-cookie-text" rows="3" placeholder="从浏览器复制 bilibili.com Cookie；只保存在本站 HttpOnly Cookie 中"></textarea>
          <div class="bili-cookie-actions">
            <button type="button" id="bili-login">导入 Cookie</button>
            <button type="button" id="bili-logout">清除 B站登录</button>
          </div>
        </details>
        <button type="button" class="bili-add" id="bili-add">添加到歌单</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // 事件绑定
    document.getElementById('login-close').onclick = () => hideLogin();
    document.getElementById('qr-refresh').onclick = () => startLogin();
    document.getElementById('login-logout').onclick = () => logoutActiveProvider({ stayInLogin: true });
    document.getElementById('login-bili-cookie-verify').onclick = () => importBiliLoginCookie();
    document.getElementById('login-bili-cookie-clear').onclick = () => logoutBiliFromLogin();
    document.getElementById('login-panel').onclick = (e) => {
      if (e.target.id === 'login-panel') hideLogin();
    };
    const legacyBiliPanel = document.getElementById('bili-panel');
    if (legacyBiliPanel) legacyBiliPanel.remove();
    let pointerDownOnOverlay = false;
    overlay.addEventListener('mousedown', (e) => {
      pointerDownOnOverlay = e.target === overlay;
    });
    overlay.addEventListener('mouseup', (e) => {
      if (pointerDownOnOverlay && e.target === overlay) {
        hideSearch();
      }
      pointerDownOnOverlay = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) hideSearch();
    });

    const input = document.getElementById('search-input');
    const submit = document.getElementById('search-submit');
    const results = document.getElementById('search-results');
    const submitSearch = () => doSearch(input.value.trim());
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitSearch();
      }
    };
    submit.onclick = submitSearch;
    document.querySelectorAll('[data-provider-switch]').forEach((switchEl) => {
      switchEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-provider]');
        if (!btn) return;
        setActiveProvider(btn.dataset.provider);
      });
    });
    document.getElementById('login-type-switch').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-login-type]');
      if (!btn) return;
      activeLoginType = btn.dataset.loginType;
      updateProviderUI();
      startLogin();
    });
    results.addEventListener('scroll', () => {
      if (!hasMore || loadingMore) return;
      if (results.scrollTop + results.clientHeight >= results.scrollHeight - 160) {
        loadSearchPage(false);
      }
    });
    enableDragScroll(results);
  }

  let debounceTimer = null;

  function revealOverlay(overlay) {
    if (!overlay) return;
    if (overlay.classList.contains('show')) return;
    overlay.dataset.visible = '1';
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    requestAnimationFrame(() => {
      if (overlay.dataset.visible === '1') overlay.classList.add('show');
    });
  }

  function concealOverlay(overlay) {
    if (!overlay) return;
    overlay.dataset.visible = '0';
    overlay.classList.remove('show');
  }

  function enableDragScroll(el) {
    let dragging = false;
    let startY = 0;
    let startScroll = 0;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      if (e.target.closest('input, textarea, select, label, a, [contenteditable="true"]')) return;
      dragging = true;
      startY = e.clientY;
      startScroll = el.scrollTop;
      el.classList.add('dragging');
      e.preventDefault();
    });
    addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.scrollTop = startScroll - (e.clientY - startY);
    });
    addEventListener('mouseup', () => {
      dragging = false;
      el.classList.remove('dragging');
    });
  }

  // ===== 搜索按钮（放到选曲层） =====
  function ensureSearchButton() {
    if (document.getElementById('search-btn')) return;
    const picker = document.getElementById('song-picker');
    if (!picker) return;
    const btn = document.createElement('button');
    btn.id = 'search-btn';
    btn.className = 'picker-search-btn';
    btn.setAttribute('aria-label', 'search');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"/></svg>';
    btn.onclick = (e) => {
      e.stopPropagation();
      if (isSearchShown()) hideSearch();
      else showSearch();
    };
    picker.appendChild(btn);
  }

  function ensureAuthButton() {
    if (document.getElementById('netease-auth-btn')) return;
    const picker = document.getElementById('song-picker');
    if (!picker) return;
    const btn = document.createElement('button');
    btn.id = 'netease-auth-btn';
    btn.className = 'picker-auth-btn';
    btn.type = 'button';
    btn.onclick = async (e) => {
      e.stopPropagation();
      ensureUI();
      updateProviderUI();
      const overlay = document.getElementById('search-overlay');
      overlay.classList.add('login-mode');
      revealOverlay(overlay);
      showLogin();
    };
    picker.appendChild(btn);
    updateSearchButton();
  }


  // ===== 登录状态 =====
  function providerState(provider) {
    return loginStates[provider || activeProvider] || loginStates.netease;
  }

  function setActiveProvider(provider) {
    if (!PROVIDERS[provider] || provider === activeProvider) return;
    activeProvider = provider;
    saveActiveProvider();
    currentQuery = '';
    currentPage = 0;
    hasMore = false;
    loadingMore = false;
    totalRendered = 0;
    if (searchAbort) { searchAbort.abort(); searchAbort = null; }
    const input = document.getElementById('search-input');
    const resultsEl = document.getElementById('search-results');
    const statusEl = document.getElementById('search-status');
    if (input) input.value = '';
    if (resultsEl) resultsEl.innerHTML = '';
    if (statusEl) statusEl.textContent = '';
    updateProviderUI();
    updateSearchButton();
    if (activeProvider === 'bilibili') {
      stopQRLogin();
      renderBiliImportView();
    }
    checkStatus({ allowDemote: true, provider: activeProvider });
    const overlay = document.getElementById('search-overlay');
    if (overlay && overlay.classList.contains('show') && overlay.classList.contains('login-mode') && !isLoginTrusted(activeProvider)) {
      startLogin();
    } else if (overlay && overlay.classList.contains('show') && overlay.classList.contains('login-mode')) {
      stopQRLogin();
    }
  }

  function updateProviderUI() {
    const meta = PROVIDERS[activeProvider] || PROVIDERS.netease;
    const state = providerState(activeProvider);
    const isBili = activeProvider === 'bilibili';
    document.querySelectorAll('[data-provider-switch] button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.provider === activeProvider);
    });
    const searchField = document.querySelector('.search-field');
    const searchInput = document.getElementById('search-input');
    const searchSubmit = document.getElementById('search-submit');
    if (searchField) searchField.classList.toggle('bili-active', isBili);
    if (searchInput) {
      searchInput.disabled = isBili;
      searchInput.placeholder = isBili ? 'B站导入不使用搜索框' : '输入后按回车搜索...';
    }
    if (searchSubmit) searchSubmit.disabled = isBili;
    const title = document.getElementById('login-title');
    const hint = document.getElementById('login-hint');
    if (title) title.textContent = state.loggedIn ? (meta.label + '已登录') : meta.loginTitle;
    if (hint) hint.textContent = state.loggedIn ? '当前平台已经授权，可直接搜索和播放。' : meta.loginHint;
    const typeSwitch = document.getElementById('login-type-switch');
    if (typeSwitch) {
      typeSwitch.style.display = activeProvider === 'qq' ? 'flex' : 'none';
      typeSwitch.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.loginType === activeLoginType);
      });
    }
    const qrSection = document.getElementById('login-qr-section');
    const cookieSection = document.getElementById('login-cookie-section');
    const session = document.getElementById('login-session');
    const sessionTitle = document.getElementById('login-session-title');
    const sessionName = document.getElementById('login-session-name');
    if (qrSection) qrSection.classList.toggle('login-hidden', state.loggedIn || isBili);
    if (cookieSection) cookieSection.classList.toggle('login-hidden', !isBili || state.loggedIn);
    if (session) session.classList.toggle('login-hidden', !state.loggedIn);
    if (sessionTitle) sessionTitle.textContent = meta.label + '已登录';
    if (sessionName) sessionName.textContent = state.nickname || '授权状态已保存';
  }

  function loadCachedLoginState(provider) {
    const meta = PROVIDERS[provider];
    if (!meta) return;
    try {
      const raw = localStorage.getItem(meta.cacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw);
      if (!cached || !cached.loggedIn) return;
      const state = providerState(provider);
      state.loggedIn = true;
      state.nickname = cached.nickname || null;
      state.trustedUntil = Date.now() + 10 * 60 * 1000;
    } catch (e) {
      console.warn('[search] 读取本地登录状态失败', e);
    }
  }

  function saveCachedLoginState(provider) {
    provider = provider || activeProvider;
    const meta = PROVIDERS[provider];
    const state = providerState(provider);
    if (!meta) return;
    try {
      if (!state.loggedIn) {
        localStorage.removeItem(meta.cacheKey);
        return;
      }
      localStorage.setItem(meta.cacheKey, JSON.stringify({
        loggedIn: true,
        nickname: state.nickname || '',
        updatedAt: Date.now(),
      }));
    } catch (e) {
      console.warn('[search] 保存本地登录状态失败', e);
    }
  }

  function trustLoginFor(ms, provider) {
    providerState(provider).trustedUntil = Date.now() + ms;
  }

  function isLoginTrusted(provider) {
    const state = providerState(provider);
    return state.loggedIn || Date.now() < state.trustedUntil;
  }

  function providerNeedsSearchLogin(provider) {
    return provider !== 'bilibili';
  }

  async function logoutActiveProvider(options) {
    options = options || {};
    const provider = activeProvider;
    const state = providerState(provider);
    try {
      await NetEase.logout(provider);
    } catch (err) {
      console.warn('[search] 退出登录失败', err);
      const sessionName = document.getElementById('login-session-name');
      const status = document.getElementById('qr-status');
      const message = '退出登录失败：' + (err.message || err);
      if (sessionName) sessionName.textContent = message;
      if (status) status.textContent = message;
      else showSearchToast('退出登录失败：' + (err.message || err));
      return false;
    }
    state.loggedIn = false;
    state.nickname = null;
    state.trustedUntil = 0;
    saveCachedLoginState(provider);
    updateSearchButton();
    updateProviderUI();
    if (options.stayInLogin) startLogin();
    return true;
  }

  async function checkStatus(options) {
    options = options || {};
    const provider = options.provider || activeProvider;
    const state = providerState(provider);
    try {
      const data = await NetEase.status(options.force, provider);
      if (data.logged_in) {
        state.loggedIn = true;
        state.nickname = data.nickname;
        trustLoginFor(30000, provider);
      } else if (!isLoginTrusted(provider) || options.allowDemote) {
        state.loggedIn = false;
        state.nickname = null;
        state.trustedUntil = 0;
      }
      saveCachedLoginState(provider);
      if (provider === activeProvider) {
        updateSearchButton();
        updateProviderUI();
      }
      return state.loggedIn;
    } catch (e) {
      console.warn('[search] 状态检查失败', e);
      return isLoginTrusted(provider);
    }
  }

  function updateSearchButton() {
    const btn = document.getElementById('search-btn');
    const authBtn = document.getElementById('netease-auth-btn');
    const state = providerState(activeProvider);
    const label = PROVIDERS[activeProvider].label;
    if (authBtn) {
      authBtn.textContent = '登录/退出';
      authBtn.classList.toggle('logged-in', state.loggedIn);
      authBtn.title = state.loggedIn ? (state.nickname || (label + '已登录')) : ('登录' + label);
    }
    if (!btn) return;
    btn.title = state.loggedIn ? (state.nickname ? state.nickname : (label + '已登录')) : ('登录' + label + '后搜索');
  }

  // ===== 显示/隐藏 =====
  async function showSearch() {
    ensureUI();
    updateProviderUI();
    const overlay = document.getElementById('search-overlay');
    revealOverlay(overlay);
    if (!providerNeedsSearchLogin(activeProvider)) {
      overlay.classList.remove('login-mode');
      document.getElementById('login-panel').classList.add('login-hidden');
      stopQRLogin();
      renderBiliImportView();
      setTimeout(() => {
        const input = document.getElementById('bili-input');
        if (input) input.focus();
      }, 0);
    } else if (!isLoginTrusted(activeProvider)) {
      overlay.classList.add('login-mode');
      const ok = await checkStatus({ force: true, provider: activeProvider });
      if (ok) {
        overlay.classList.remove('login-mode');
        document.getElementById('login-panel').classList.add('login-hidden');
        document.getElementById('search-input').focus();
      } else {
        showLogin();
      }
    } else {
      overlay.classList.remove('login-mode');
      document.getElementById('login-panel').classList.add('login-hidden');
      document.getElementById('search-input').focus();
    }
  }

  function isSearchShown() {
    const overlay = document.getElementById('search-overlay');
    return !!(overlay && overlay.classList.contains('show'));
  }

  function hideSearch() {
    const overlay = document.getElementById('search-overlay');
    concealOverlay(overlay);
    if (overlay) overlay.classList.remove('login-mode');
    // P0-60/61: 关闭面板清理所有进行中的东西
    clearTimeout(debounceTimer);
    if (searchAbort) { searchAbort.abort(); searchAbort = null; }
    stopQRLogin(); // 停 QR 轮询
  }

  function showLogin() {
    document.getElementById('login-panel').classList.remove('login-hidden');
    updateProviderUI();
    if (activeProvider === 'bilibili') {
      stopQRLogin();
      return;
    }
    if (isLoginTrusted(activeProvider)) {
      stopQRLogin();
      return;
    }
    startLogin();
  }

  function hideLogin() {
    document.getElementById('login-panel').classList.add('login-hidden');
    stopQRLogin();
    // 如果已登录，聚焦搜索框
    if (isLoginTrusted(activeProvider) || !providerNeedsSearchLogin(activeProvider)) {
      document.getElementById('search-overlay').classList.remove('login-mode');
      if (activeProvider === 'bilibili') renderBiliImportView();
      else document.getElementById('search-input').focus();
    } else {
      hideSearch();
    }
  }

  function showBiliImport() {
    ensureUI();
    activeProvider = 'bilibili';
    saveActiveProvider();
    updateProviderUI();
    const overlay = document.getElementById('search-overlay');
    revealOverlay(overlay);
    overlay.classList.remove('login-mode');
    const searchPanel = overlay.querySelector('.search-panel');
    if (searchPanel) searchPanel.classList.remove('login-hidden');
    document.getElementById('login-panel').classList.add('login-hidden');
    renderBiliImportView();
    setBiliStatus('粘贴 BV 号或链接后解析');
    setTimeout(() => document.getElementById('bili-input').focus(), 0);
  }

  function hideBiliImport() {
    const overlay = document.getElementById('search-overlay');
    const searchPanel = overlay && overlay.querySelector('.search-panel');
    if (searchPanel) searchPanel.classList.remove('login-hidden');
    if (overlay) {
      concealOverlay(overlay);
      overlay.classList.remove('login-mode');
    }
  }


  function renderBiliImportView() {
    const results = document.getElementById('search-results');
    const status = document.getElementById('search-status');
    if (!results) return;
    if (status) status.textContent = '粘贴 BV 号或 B 站链接导入到本地';
    results.innerHTML = `
      <div class="bili-import-view">
        <div class="bili-row">
          <input type="text" id="bili-input" placeholder="粘贴 BV 号、B站链接或 b23.tv 短链" autocomplete="off">
          <button type="button" id="bili-resolve">解析</button>
        </div>
        <div class="bili-status" id="bili-status">粘贴链接后解析，添加时会下载音频、歌词和封面到本地。</div>
        <div class="bili-preview login-hidden" id="bili-preview">
          <img id="bili-cover-preview" alt="">
          <div class="bili-preview-info"><div class="bili-title" id="bili-title"></div><div class="bili-artist" id="bili-artist"></div></div>
        </div>
        <label class="bili-field login-hidden" id="bili-page-field"><span>分 P</span><select id="bili-page"></select></label>
        <label class="bili-check"><input type="checkbox" id="bili-bg-video"> 下载视频并作为背景</label>
        <label class="bili-field"><span>歌词</span><select id="bili-subtitle-source"><option value="video">使用视频字幕</option><option value="upload">上传字幕文件</option><option value="none">不使用歌词</option></select></label>
        <label class="bili-field login-hidden" id="bili-subtitle-track-field"><span>字幕轨</span><select id="bili-subtitle-track"></select></label>
        <label class="bili-field"><span>字幕</span><input type="file" id="bili-subtitle-file" accept=".srt,.vtt,.lrc,.json,text/*,application/json"></label>
        <label class="bili-field"><span>封面</span><input type="file" id="bili-cover-file" accept="image/*"></label>
        <div class="bili-progress login-hidden" id="bili-progress"><span></span><i></i></div>
        <button type="button" class="bili-add" id="bili-add">下载并添加到歌单</button>
      </div>`;
    document.getElementById('bili-resolve').onclick = () => resolveBiliInput();
    document.getElementById('bili-add').onclick = () => addBiliTrack();
    document.getElementById('bili-subtitle-source').onchange = () => updateBiliSubtitleUI();
    document.getElementById('bili-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); resolveBiliInput(); }
    });
    updateBiliSubtitleUI();
  }

  function setBiliStatus(message) {
    const status = document.getElementById('bili-status');
    if (status) status.textContent = message || '';
  }

  function updateBiliSubtitleUI() {
    const source = document.getElementById('bili-subtitle-source');
    const file = document.getElementById('bili-subtitle-file');
    if (!source || !file) return;
    const field = file.closest('.bili-field');
    const needsUpload = source.value === 'upload';
    const trackField = document.getElementById('bili-subtitle-track-field');
    if (field) field.classList.toggle('login-hidden', !needsUpload);
    file.disabled = !needsUpload;
    if (!needsUpload) file.value = '';
    if (trackField) {
      const subtitles = currentBiliSubtitles();
      trackField.classList.toggle('login-hidden', source.value !== 'video' || subtitles.length <= 1);
    }
  }

  function currentBiliSubtitles() {
    const page = selectedBiliPage();
    return (page && Array.isArray(page.subtitles) && page.subtitles.length)
      ? page.subtitles
      : ((biliResolved && Array.isArray(biliResolved.subtitles)) ? biliResolved.subtitles : []);
  }

  function renderBiliSubtitleOptions() {
    const select = document.getElementById('bili-subtitle-track');
    if (!select) return;
    const subtitles = currentBiliSubtitles();
    select.innerHTML = '';
    subtitles.forEach((sub, index) => {
      const option = document.createElement('option');
      option.value = sub.trackKey || sub.key || sub.id || sub.lan || String(index + 1);
      option.textContent = sub.label || sub.lan || ('字幕 ' + (index + 1));
      select.appendChild(option);
    });
    updateBiliSubtitleUI();
  }

  function selectedBiliPage() {
    const select = document.getElementById('bili-page');
    if (!biliResolved || !biliResolved.pages || !biliResolved.pages.length) return null;
    const cid = Number(select && select.value || biliResolved.pages[0].cid);
    return biliResolved.pages.find(page => Number(page.cid) === cid) || biliResolved.pages[0];
  }

  async function resolveBiliInput() {
    const input = document.getElementById('bili-input');
    const value = input.value.trim();
    if (!value) { setBiliStatus('请输入 BV 号或 B站链接'); return; }
    setBiliStatus('解析中...');
    biliResolved = null;
    try {
      const data = await NetEase.bilibiliResolve(value);
      biliResolved = data;
      renderBiliResolved(data);
      setBiliStatus((data.pages && data.pages.length > 1) ? '已解析，选择分 P 后添加' : '已解析，可以添加');
    } catch (e) {
      setBiliStatus('解析失败：' + (e.message || e));
    }
  }

  function renderBiliResolved(data) {
    const preview = document.getElementById('bili-preview');
    const cover = document.getElementById('bili-cover-preview');
    const title = document.getElementById('bili-title');
    const artist = document.getElementById('bili-artist');
    const pageField = document.getElementById('bili-page-field');
    const select = document.getElementById('bili-page');
    if (preview) preview.classList.remove('login-hidden');
    if (cover) {
      const firstPage = data.pages && data.pages[0];
      cover.src = firstPage ? NetEase.coverUrl(data.bvid + ':' + firstPage.cid, 'bilibili') : '';
    }
    if (title) title.textContent = data.title || data.bvid || 'B站视频';
    if (artist) artist.textContent = data.artist || 'Bilibili';
    if (select) {
      select.innerHTML = '';
      (data.pages || []).forEach(page => {
        const option = document.createElement('option');
        option.value = page.cid;
        option.textContent = 'P' + page.page + ' · ' + page.title;
        select.appendChild(option);
      });
      select.onchange = () => renderBiliSubtitleOptions();
    }
    if (pageField) pageField.classList.toggle('login-hidden', !(data.pages && data.pages.length > 1));
    renderBiliSubtitleOptions();
  }

  async function importBiliCookie() {
    const textarea = document.getElementById('bili-cookie-text');
    const cookie = textarea.value.trim();
    if (!cookie) { setBiliStatus('请先粘贴 B站 Cookie'); return; }
    setBiliStatus('正在导入 Cookie...');
    try {
      const data = await NetEase.bilibiliLogin(cookie);
      textarea.value = '';
      setBiliStatus(data.logged_in ? ('B站已登录：' + (data.nickname || '已授权')) : 'Cookie 已保存，但暂未验证为登录态');
    } catch (e) {
      setBiliStatus('导入失败：' + (e.message || e));
    }
  }

  async function importBiliLoginCookie() {
    const textarea = document.getElementById('login-bili-cookie-text');
    const status = document.getElementById('login-bili-cookie-status');
    const btn = document.getElementById('login-bili-cookie-verify');
    const cookie = textarea ? textarea.value.trim() : '';
    if (!cookie) {
      if (status) status.textContent = '请先粘贴 B站 Cookie。';
      return;
    }
    if (btn) btn.disabled = true;
    if (status) status.textContent = '正在验证 Cookie...';
    try {
      const data = await NetEase.bilibiliLogin(cookie);
      const state = providerState('bilibili');
      state.loggedIn = !!data.logged_in;
      state.nickname = data.nickname || null;
      state.trustedUntil = state.loggedIn ? Date.now() + 30000 : 0;
      saveCachedLoginState('bilibili');
      if (textarea && state.loggedIn) textarea.value = '';
      if (status) {
        status.textContent = state.loggedIn
          ? ('验证成功，已登录' + (state.nickname ? '：' + state.nickname : '。'))
          : 'Cookie 无效或已过期，请重新复制。';
      }
      updateSearchButton();
      updateProviderUI();
    } catch (e) {
      const state = providerState('bilibili');
      state.loggedIn = false;
      state.nickname = null;
      state.trustedUntil = 0;
      saveCachedLoginState('bilibili');
      if (status) status.textContent = '验证失败：' + (e.message || e);
      updateSearchButton();
      updateProviderUI();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function logoutBiliFromLogin() {
    const status = document.getElementById('login-bili-cookie-status');
    if (status) status.textContent = '正在清除 B站登录...';
    await logoutBili();
    const state = providerState('bilibili');
    state.loggedIn = false;
    state.nickname = null;
    state.trustedUntil = 0;
    saveCachedLoginState('bilibili');
    updateSearchButton();
    updateProviderUI();
    if (status) status.textContent = '已清除 B站登录，可重新粘贴 Cookie。';
  }


  async function importBiliLocalCookie() {
    const btn = document.getElementById('bili-login-local');
    if (btn) btn.disabled = true;
    setBiliStatus('正在从本机 Chrome/Edge 读取 B 站 Cookie...');
    try {
      const data = await NetEase.bilibiliImportLocalCookie();
      setBiliStatus(data.logged_in ? ('已导入 ' + (data.source || '浏览器') + ' Cookie：' + (data.nickname || '已登录')) : '已读取 Cookie，但未验证为登录状态');
    } catch (e) {
      setBiliStatus('一键获取失败：' + (e.message || e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function logoutBili() {
    setBiliStatus('正在清除 B站登录...');
    try {
      await NetEase.logout('bilibili');
      setBiliStatus('已清除 B站登录');
    } catch (e) {
      setBiliStatus('清除失败：' + (e.message || e));
    }
  }


  async function addBiliTrack() {
    if (!biliResolved) { setBiliStatus('请先解析 B 站链接'); return; }
    const page = selectedBiliPage();
    if (!page) { setBiliStatus('没有可添加的分 P'); return; }
    const id = biliResolved.bvid + ':' + page.cid;
    const key = 'bilibili:' + id;
    if (Player.hasTrack(key)) { setBiliStatus('这首已经在歌单里了'); return; }
    const addBtn = document.getElementById('bili-add');
    const progress = document.getElementById('bili-progress');
    const fill = progress && progress.querySelector('i');
    const label = progress && progress.querySelector('span');
    const subtitleSource = (document.getElementById('bili-subtitle-source') || {}).value || 'video';
    const subtitleTrack = document.getElementById('bili-subtitle-track');
    const subtitleFile = document.getElementById('bili-subtitle-file').files[0];
    const coverFile = document.getElementById('bili-cover-file').files[0];
    const backgroundVideo = document.getElementById('bili-bg-video').checked;
    if (subtitleSource === 'upload' && !subtitleFile) { setBiliStatus('请选择要上传的字幕文件'); return; }
    if (subtitleFile && subtitleFile.size > BILI_SUBTITLE_LIMIT) { setBiliStatus('字幕太大，最大 1MB'); return; }
    if (coverFile && coverFile.size > BILI_COVER_LIMIT) { setBiliStatus('封面太大，最大 5MB'); return; }
    addBtn.disabled = true;
    if (progress) progress.classList.remove('login-hidden');
    if (fill) fill.style.width = '0%';
    setBiliStatus('创建本地导入任务...');
    try {
      const form = new FormData();
      form.append('input', document.getElementById('bili-input').value.trim() || biliResolved.bvid);
      form.append('cid', String(page.cid));
      form.append('background_video', backgroundVideo ? '1' : '0');
      form.append('subtitle_source', subtitleSource);
      if (subtitleSource === 'video' && subtitleTrack && subtitleTrack.value) {
        form.append('subtitle_track', subtitleTrack.value);
        form.append('subtitle_id', subtitleTrack.value);
      }
      if (subtitleSource === 'upload' && subtitleFile) form.append('subtitle_file', subtitleFile, subtitleFile.name);
      if (coverFile) form.append('cover_file', coverFile, coverFile.name);
      const job = await NetEase.bilibiliImport(form);
      const result = await pollBiliImportJob(job.job_id, { fill, label });
      const track = result.track;
      if (!track) throw new Error('导入完成但没有返回歌曲信息');
      const added = Player.addTrack(track);
      prewarmTrack(track);
      setBiliStatus(added.added ? '已下载并添加到歌单' : '这首已经在歌单里了');
      refreshSearchAddStates();
    } catch (e) {
      setBiliStatus('添加失败：' + (e.message || e));
    } finally {
      addBtn.disabled = false;
    }
  }

  async function pollBiliImportJob(jobId, ui) {
    while (true) {
      const job = await NetEase.bilibiliImportStatus(jobId);
      const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
      if (ui && ui.fill) ui.fill.style.width = progress + '%';
      if (ui && ui.label) ui.label.textContent = job.message || job.step || '下载中';
      setBiliStatus((job.message || '下载中') + ' ' + progress + '%');
      if (job.status === 'done') return job.result || {};
      if (job.status === 'failed') throw new Error(job.error || job.message || '导入失败');
      await new Promise(resolve => setTimeout(resolve, 850));
    }
  }

  async function storeBiliFile(key, file, limit, label) {
    if (file.size > limit) throw new Error(label + '太大，最大 ' + Math.round(limit / 1024 / 1024) + 'MB');
    if (window.BiliAssets && !(await window.BiliAssets.enoughSpace(file.size))) {
      throw new Error('浏览器本地存储空间不足');
    }
    if (!window.BiliAssets) throw new Error('当前浏览器不支持本地上传存储');
    return await window.BiliAssets.putBlob(key, file, { name: file.name, type: file.type || '' });
  }

  // ===== 二维码登录 =====
  let currentUnikey = null;
  let qrGeneration = 0; // P0-62: 防多次刷新二维码响应乱序

  async function startLogin() {
    const myGen = ++qrGeneration; // 作废旧 generation 的回调
    const provider = activeProvider;
    if (provider === 'bilibili') {
      stopQRLogin();
      updateProviderUI();
      const status = document.getElementById('login-bili-cookie-status');
      if (status) status.textContent = '粘贴 Cookie 后点击验证并登录。';
      return;
    }
    const loginType = provider === 'qq' ? activeLoginType : undefined;
    if (isLoginTrusted(provider)) {
      stopQRLogin();
      updateProviderUI();
      return;
    }
    const qrImg = document.getElementById('qr-image');
    const qrStatus = document.getElementById('qr-status');
    const qrRefresh = document.getElementById('qr-refresh');
    const qrSpinner = document.getElementById('qr-spinner');
    // 显示加载动画，隐藏二维码
    if (qrImg) { qrImg.classList.add('qr-loading'); qrImg.src = ''; }
    if (qrSpinner) qrSpinner.classList.add('show');
    if (qrStatus) qrStatus.textContent = '正在生成二维码...';
    if (qrRefresh) qrRefresh.style.display = 'none';
    // 作废旧 key（让进行中的轮询自然退出），但不调 stopQRLogin（会清 currentUnikey）
    currentUnikey = null;
    clearQRTimer();

    try {
      const data = await withTimeout(
        NetEase.createQR(provider, loginType),
        provider === 'qq' ? 20000 : 15000,
        (PROVIDERS[provider] ? PROVIDERS[provider].label : '登录') + '二维码生成超时，请点刷新重试'
      );
      if (myGen !== qrGeneration) return; // 已被新刷新取代，丢弃
      currentUnikey = data.unikey;
      // 隐藏 spinner，显示二维码
      if (qrSpinner) qrSpinner.classList.remove('show');
      if (qrImg) { qrImg.classList.remove('qr-loading'); qrImg.src = data.qrcode_b64; }
      if (qrStatus) {
        qrStatus.textContent = provider === 'qq'
          ? (activeLoginType === 'wechat' ? '请用微信扫码登录 QQ 音乐' : '请用 QQ 音乐 App 扫码登录')
          : '请用网易云音乐 App 扫码登录';
      }
      startQRPoll(data.poll_interval || 1500);
    } catch (e) {
      if (myGen !== qrGeneration) return;
      if (qrSpinner) qrSpinner.classList.remove('show');
      if (qrStatus) qrStatus.textContent = '生成二维码失败: ' + (e.message || e);
      if (qrRefresh) qrRefresh.style.display = 'inline-block';
    }
  }

  function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message || '请求超时')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function startQRPoll(interval) {
    clearQRTimer(); // 只清 timer，不清 currentUnikey（否则轮询回调首帧就退出）
    const pollKey = currentUnikey; // 固定本轮 key，避免被新二维码覆盖
    const provider = activeProvider;
    const poll = async () => {
      if (!currentUnikey || currentUnikey !== pollKey) return; // key 变了/失效，停止
      try {
        const data = await NetEase.checkQR(currentUnikey, provider);
        if (currentUnikey !== pollKey) return; // 异步返回时 key 已变，丢弃
        const code = data.code;
        const qrStatus = document.getElementById('qr-status');
        if (code === 800) {
          if (qrStatus) qrStatus.textContent = data.message || '二维码已过期';
          document.getElementById('qr-refresh').style.display = 'inline-block';
          clearQRTimer();
        } else if (code === 801) {
          if (qrStatus) qrStatus.textContent = '等待扫码...';
        } else if (code === 802) {
          if (qrStatus) qrStatus.textContent = '已扫码，请在手机上确认';
        } else if (code === 803) {
          if (qrStatus) qrStatus.textContent = '登录成功！';
          clearQRTimer();
          currentUnikey = null;
          const state = providerState(provider);
          state.loggedIn = true;
          state.nickname = data.nickname || state.nickname;
          trustLoginFor(30000, provider);
          saveCachedLoginState(provider);
          // 后台再确认一次，但不要用短暂 false 覆盖刚扫码成功的状态。
          checkStatus({ force: true, provider: provider });
          updateSearchButton();
          updateProviderUI();
          setTimeout(() => hideLogin(), 800);
        } else if (code === 8821) {
          // 风控：需要行为验证码，停止轮询，提示用户
          if (qrStatus) qrStatus.textContent = '需要行为验证码验证\n请在手机端完成安全验证，然后点刷新重试';
          document.getElementById('qr-refresh').style.display = 'inline-block';
          clearQRTimer();
        } else {
          if (qrStatus) qrStatus.textContent = data.message || ('状态: ' + code);
        }
      } catch (e) {
        console.warn('[qr] 轮询失败', e);
        // 网络错误：保留二维码，继续重试
      }
      // 继续轮询（key 未变才继续）
      if (currentUnikey === pollKey) {
        qrPollTimer = setTimeout(poll, interval);
      }
    };
    qrPollTimer = setTimeout(poll, interval);
  }

  // P0-4 拆分：clearQRTimer 只清定时器，不清 key
  function clearQRTimer() {
    if (qrPollTimer) { clearTimeout(qrPollTimer); qrPollTimer = null; }
  }
  // stopQRLogin：彻底停止（清 timer + 作废 key）
  function stopQRLogin() {
    clearQRTimer();
    currentUnikey = null;
  }

  // ===== 搜索 =====
  async function doSearch(q) {
    const resultsEl = document.getElementById('search-results');
    const statusEl = document.getElementById('search-status');
    if (!resultsEl) return;
    if (activeProvider === 'bilibili') {
      renderBiliImportView();
      return;
    }

    // 取消旧请求
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();

    if (!q) {
      currentQuery = '';
      currentPage = 0;
      hasMore = false;
      loadingMore = false;
      totalRendered = 0;
      if (searchAbort) { searchAbort.abort(); searchAbort = null; }
      resultsEl.innerHTML = '';
      if (statusEl) statusEl.textContent = '';
      return;
    }

    if (!isLoginTrusted(activeProvider)) {
      if (statusEl) statusEl.textContent = '正在确认登录状态...';
      const ok = await checkStatus({ force: true, allowDemote: true, provider: activeProvider });
      if (!ok) {
        resultsEl.innerHTML = '<div class="search-empty">请先登录' + PROVIDERS[activeProvider].label + '</div>';
        showLogin();
        return;
      }
    }

    currentQuery = q;
    currentPage = 0;
    hasMore = true;
    loadingMore = false;
    totalRendered = 0;
    resultsEl.innerHTML = '';
    resultsEl.scrollTop = 0;
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    if (statusEl) statusEl.textContent = '搜索中...';
    loadSearchPage(true);
  }

  // ===== 渲染搜索结果（用 textContent 防 XSS） =====
  async function loadSearchPage(reset) {
    const resultsEl = document.getElementById('search-results');
    const statusEl = document.getElementById('search-status');
    if (!resultsEl || !currentQuery || loadingMore || !hasMore || !searchAbort) return;
    loadingMore = true;
    const signal = searchAbort.signal;
    const nextPage = currentPage + 1;
    if (!reset && statusEl) statusEl.textContent = '加载更多...';
    try {
      const data = await NetEase.search(currentQuery, nextPage, SEARCH_PAGE_SIZE, { signal: signal, provider: activeProvider });
      if (signal.aborted || !searchAbort || searchAbort.signal !== signal) return;
      const songs = data.songs || [];
      renderResults(songs, { append: !reset });
      currentPage = nextPage;
      totalRendered += songs.length;
      hasMore = songs.length >= SEARCH_PAGE_SIZE;
      if (statusEl) {
        statusEl.textContent = hasMore
          ? (totalRendered + ' 首结果')
          : (totalRendered ? totalRendered + ' 首结果，已到底' : '无搜索结果');
      }
    } catch (e) {
      if (!searchAbort || searchAbort.signal !== signal) return;
      if (e.name === 'AbortError' || e.code === 'ABORTED') return;
      if (searchAbort && searchAbort.signal.aborted) return;
      if (e.code === 'LOGIN_REQUIRED' || e.httpStatus === 401) {
        const state = providerState(activeProvider);
        state.loggedIn = false;
        state.nickname = null;
        state.trustedUntil = 0;
        saveCachedLoginState(activeProvider);
        showLogin();
        if (statusEl) statusEl.textContent = '登录状态已过期，请重新扫码';
        return;
      }
      if (statusEl) statusEl.textContent = '搜索失败: ' + (e.message || e);
      console.error('[search] failed', e);
    } finally {
      loadingMore = false;
      if (hasMore && resultsEl && resultsEl.scrollHeight <= resultsEl.clientHeight + 20) {
        setTimeout(() => loadSearchPage(false), 0);
      }
    }
  }

  const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 16.6 4.9 12.3l-1.4 1.4 5.7 5.7L20.8 7.8l-1.4-1.4L9.2 16.6Z"/></svg>';
  const PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>';
  const LOADING_DOTS = '<span class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
  function vipLabel(song) {
    if (!song) return '';
    if (song.vip && song.vip.required && song.vip.label) return song.vip.label;
    return song.quality && song.quality.label ? song.quality.label : '';
  }

  function searchTrackKey(song) {
    return (song.source || activeProvider) + ':' + song.id;
  }

  function setSearchAddState(btn, added) {
    if (!btn) return;
    btn.classList.toggle('added', added);
    btn.innerHTML = added ? CHECK_SVG : PLUS_SVG;
    btn.title = added ? '已添加到歌单' : '添加到歌单';
    btn.setAttribute('aria-label', btn.title);
    btn.disabled = added;
  }

  function refreshSearchAddStates() {
    document.querySelectorAll('#search-results .search-add[data-track-key]').forEach(btn => {
      setSearchAddState(btn, Player.hasTrack(btn.dataset.trackKey));
    });
  }

  function renderResults(songs, options) {
    options = options || {};
    const resultsEl = document.getElementById('search-results');
    if (!options.append) resultsEl.innerHTML = '';
    if (!songs.length && !options.append) {
      resultsEl.innerHTML = '<div class="search-empty">无搜索结果</div>';
      return;
    }
    songs.forEach(song => {
      const item = document.createElement('div');
      item.className = 'search-item';
      const label = vipLabel(song);
      if (label) {
        item.classList.add('vip-marked');
        if (song.vip && song.vip.required) item.classList.add('vip-required');
        else item.classList.add('quality-marked');
        item.dataset.vip = label;
      }

      // 封面（走 /api/cover/ 代理）
      const cover = document.createElement('img');
      cover.className = 'search-cover';
      const provider = song.source || activeProvider;
      cover.src = NetEase.coverUrl(song.id, provider);
      cover.alt = '';
      cover.onerror = () => { cover.style.visibility = 'hidden'; };
      item.appendChild(cover);

      // 信息
      const info = document.createElement('div');
      info.className = 'search-info';
      const title = document.createElement('div');
      title.className = 'search-title';
      title.textContent = song.name; // textContent 防 XSS
      info.appendChild(title);
      const artist = document.createElement('div');
      artist.className = 'search-artist';
      artist.textContent = song.artist;
      info.appendChild(artist);
      item.appendChild(info);

      // 添加按钮
      const addBtn = document.createElement('button');
      addBtn.className = 'search-add';
      addBtn.dataset.trackKey = searchTrackKey(song);
      setSearchAddState(addBtn, Player.hasTrack(addBtn.dataset.trackKey));
      addBtn.onclick = () => addToPlaylist(song, addBtn);
      item.appendChild(addBtn);

      resultsEl.appendChild(item);
    });
  }

  async function addToPlaylist(song, btn) {
    const provider = song.source || activeProvider;
    const key = provider + ':' + song.id;
    if (Player.hasTrack(key)) {
      setSearchAddState(btn, true);
      return;
    }
    const track = {
      source: provider,
      neteaseId: provider === 'netease' ? song.id : undefined,
      qqId: provider === 'qq' ? song.id : undefined,
      qqSongId: provider === 'qq' ? (song.qqSongId || '') : undefined,
      songmid: provider === 'qq' ? (song.songmid || song.id) : undefined,
      id: song.id,
      title: song.name,
      artist: song.artist,
      audio: NetEase.streamUrl(song.id, 'standard', provider),
      cover: NetEase.coverUrl(song.id, provider),
      duration: song.duration,
      vip: song.vip,
    };
    btn.disabled = true;
    btn.innerHTML = LOADING_DOTS;
    btn.title = '正在检查音频源';
    const playable = await canPlayTrack(track);
    if (!playable.ok) {
      btn.disabled = false;
      btn.innerHTML = PLUS_SVG;
      btn.title = '添加到歌单';
      btn.classList.remove('added');
      showSearchToast(playable.message || '添加失败');
      console.warn('[search] 音频源不可播放', song.id, playable.message);
      return;
    }
    // 添加到歌单（懒加载歌词，audio/cover 走代理）
    // P0-69: addTrack 返回 {index, added}，去重时定位原曲
    const result = Player.addTrack(track);
    setSearchAddState(btn, true);
    prewarmTrack(track);
    console.log('[search] 已添加:', song.name, 'index', result.index);
  }

  async function canPlayTrack(track) {
    try {
      const info = await NetEase.songUrl(track.id, 'standard', track.source || 'netease');
      if (info && info.playable) {
        return { ok: true };
      }
      const vipReason = track.vip && track.vip.required && track.vip.reason;
      return { ok: false, message: (info && info.reason) || vipReason || '歌曲暂不可播放' };
    } catch (e) {
      const vipReason = track.vip && track.vip.required && track.vip.reason;
      return { ok: false, message: (e && e.message) || vipReason || '音频源验证失败' };
    }
  }

  function prewarmTrack(track) {
    if (!track || !track.id) return;
    if (window.LyricsStore) {
      window.LyricsStore.load(track).catch(() => {});
    }
  }

  // ===== 初始化 =====
  let toastTimer = null;
  function showSearchToast(message) {
    const toast = document.getElementById('search-toast');
    if (!toast) return;
    toast.textContent = message || '添加失败';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function init() {
    loadCachedLoginState('netease');
    loadCachedLoginState('qq');
    loadCachedLoginState('bilibili');
    ensureSearchButton();
    ensureAuthButton();

    updateProviderUI();
    window.addEventListener('player:playlist-changed', refreshSearchAddStates);
    // P0-64: 注册登录失效回调（401/LOGIN_REQUIRED 时清除前端登录态）
    if (typeof NetEase.setAuthExpiredHandler === 'function') {
      NetEase.setAuthExpiredHandler(() => {
        const state = providerState(activeProvider);
        state.loggedIn = false;
        state.nickname = null;
        state.trustedUntil = 0;
        saveCachedLoginState(activeProvider);
        updateSearchButton();
        console.log('[search] 登录态已失效');
      });
    }
    // 后台静默检查登录态（不阻塞播放器）
    setTimeout(() => {
      checkStatus({ allowDemote: true, provider: 'netease' });
      checkStatus({ allowDemote: true, provider: 'qq' });
      checkStatus({ allowDemote: true, provider: 'bilibili' });
    }, 500);
  }

  // DOM ready 后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
