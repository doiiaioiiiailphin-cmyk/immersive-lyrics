// netease.js - frontend API client
console.log('[netease.js] loaded');

const NetEase = (function () {
  let apiToken = null;
  let onAuthExpired = null;
  let refreshPromise = null;

  function getToken() {
    if (apiToken) return apiToken;
    const meta = document.querySelector('meta[name="api-token"]');
    if (meta) {
      apiToken = meta.content;
      console.log('[netease] token loaded from meta');
    }
    return apiToken;
  }

  function setAuthExpiredHandler(fn) {
    onAuthExpired = fn;
  }

  async function refreshSession() {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const resp = await fetch('/?session_refresh=' + Date.now(), {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!resp.ok) throw new Error('刷新会话失败（HTTP ' + resp.status + '）');
        const html = await resp.text();
        const match = html.match(/<meta\s+name=["']api-token["']\s+content=["']([^"']+)["']/i);
        if (!match) throw new Error('刷新会话失败：缺少安全凭证');
        apiToken = match[1];
        console.log('[netease] session refreshed');
        return apiToken;
      })().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }

  function providerQuery(provider, prefix) {
    provider = provider || 'netease';
    if (provider === 'netease') return '';
    return (prefix || '?') + 'provider=' + encodeURIComponent(provider);
  }

  function appendProvider(url, provider) {
    provider = provider || 'netease';
    if (provider === 'netease') return url;
    return url + (url.includes('?') ? '&' : '?') + 'provider=' + encodeURIComponent(provider);
  }

  async function unwrapJsonResponse(resp) {
    const ct = resp.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) {
      const err = new Error('服务器返回非 JSON 响应（HTTP ' + resp.status + '）');
      err.code = 'BAD_RESPONSE';
      err.httpStatus = resp.status;
      throw err;
    }
    const data = await resp.json();
    if (!data.ok) {
      const err = new Error((data.error && data.error.message) || '请求失败');
      err.code = data.error && data.error.code;
      err.retryable = data.error && data.error.retryable;
      err.httpStatus = resp.status;
      throw err;
    }
    return data.data;
  }

  function isAuthError(e) {
    return !!(e && (e.code === 'LOGIN_REQUIRED' || e.httpStatus === 401));
  }

  function notifyAuthExpired(e) {
    if (isAuthError(e) && typeof onAuthExpired === 'function') onAuthExpired();
  }

  function timeoutSignal(options, fetchOpts) {
    if (options.signal) return null;
    const ctrl = new AbortController();
    fetchOpts.signal = ctrl.signal;
    const timer = setTimeout(() => ctrl.abort(), options.timeout || 20000);
    return { ctrl, timer };
  }

  async function request(path, options) {
    options = options || {};
    const retryAuth = options.__retryAuth !== false;
    const headers = Object.assign({}, options.headers || {});
    const tk = getToken();
    if (!tk) {
      const err = new Error('安全凭证缺失，请刷新页面');
      err.code = 'NO_TOKEN';
      throw err;
    }
    headers['X-Player-Token'] = tk;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const cleanOptions = Object.assign({}, options);
    delete cleanOptions.__retryAuth;
    const fetchOpts = Object.assign({}, cleanOptions, {
      method: options.method || 'GET',
      headers,
      credentials: 'same-origin',
    });
    if (options.body !== undefined) fetchOpts.body = JSON.stringify(options.body);
    const timeout = timeoutSignal(options, fetchOpts);
    try {
      const resp = await fetch(path, fetchOpts);
      return await unwrapJsonResponse(resp);
    } catch (e) {
      if (retryAuth && isAuthError(e)) {
        try {
          await refreshSession();
          const retryOptions = Object.assign({}, options, { __retryAuth: false });
          return await request(path, retryOptions);
        } catch (_) {
          notifyAuthExpired(e);
        }
      } else {
        notifyAuthExpired(e);
      }
      if (timeout && timeout.ctrl.signal.aborted) {
        const err = new Error('请求超时');
        err.code = 'TIMEOUT';
        throw err;
      }
      if (e.name === 'AbortError') {
        const err = new Error('请求已取消');
        err.code = 'ABORTED';
        throw err;
      }
      throw e;
    } finally {
      if (timeout) clearTimeout(timeout.timer);
    }
  }

  async function requestForm(path, formData, options) {
    options = options || {};
    const retryAuth = options.__retryAuth !== false;
    const headers = Object.assign({}, options.headers || {});
    const tk = getToken();
    if (!tk) {
      const err = new Error('安全凭证缺失，请刷新页面');
      err.code = 'NO_TOKEN';
      throw err;
    }
    headers['X-Player-Token'] = tk;
    const fetchOpts = {
      method: options.method || 'POST',
      headers,
      credentials: 'same-origin',
      body: formData,
    };
    const timeout = timeoutSignal(options, fetchOpts);
    try {
      const resp = await fetch(path, fetchOpts);
      return await unwrapJsonResponse(resp);
    } catch (e) {
      if (retryAuth && isAuthError(e)) {
        try {
          await refreshSession();
          const retryOptions = Object.assign({}, options, { __retryAuth: false });
          return await requestForm(path, formData, retryOptions);
        } catch (_) {
          notifyAuthExpired(e);
        }
      } else {
        notifyAuthExpired(e);
      }
      if (timeout && timeout.ctrl.signal.aborted) {
        const err = new Error('请求超时');
        err.code = 'TIMEOUT';
        throw err;
      }
      if (e.name === 'AbortError') {
        const err = new Error('请求已取消');
        err.code = 'ABORTED';
        throw err;
      }
      throw e;
    } finally {
      if (timeout) clearTimeout(timeout.timer);
    }
  }

  function status(force, provider) {
    let url = '/api/status';
    const params = [];
    if (force) params.push('force=1');
    if (provider && provider !== 'netease') params.push('provider=' + encodeURIComponent(provider));
    if (params.length) url += '?' + params.join('&');
    return request(url);
  }

  function logout(provider) {
    return request('/api/logout' + providerQuery(provider), { method: 'POST' });
  }

  function createQR(provider, loginType) {
    let url = '/api/qr/create' + providerQuery(provider);
    if (provider && provider !== 'netease' && loginType) {
      url += '&login_type=' + encodeURIComponent(loginType);
    }
    return request(url, { method: 'POST' });
  }

  function checkQR(key, provider) {
    let url = '/api/qr/check?key=' + encodeURIComponent(key);
    if (provider && provider !== 'netease') url += '&provider=' + encodeURIComponent(provider);
    return request(url);
  }

  function search(q, page, limit, options) {
    page = page || 1;
    limit = limit || 30;
    const opts = Object.assign({}, options || {});
    const provider = opts.provider || 'netease';
    delete opts.provider;
    return request('/api/search?q=' + encodeURIComponent(q) +
      '&page=' + page + '&limit=' + limit +
      (provider !== 'netease' ? '&provider=' + encodeURIComponent(provider) : ''), opts);
  }

  function songDetail(id, provider) {
    return request(appendProvider('/api/song/' + encodeURIComponent(id), provider));
  }

  function songUrl(id, level, provider, waitForPrewarm) {
    let url = '/api/song-url/' + encodeURIComponent(id);
    if (level) url += '?level=' + encodeURIComponent(level);
    url = appendProvider(url, provider);
    if (waitForPrewarm) url += (url.includes('?') ? '&' : '?') + 'wait=1';
    return request(url);
  }

  function lyrics(id, duration, provider, options) {
    options = options || {};
    let url = '/api/lyrics/' + encodeURIComponent(id);
    if (duration) url += '?duration=' + duration;
    if (options.qqSongId) url += (url.includes('?') ? '&' : '?') + 'song_id=' + encodeURIComponent(options.qqSongId);
    url = appendProvider(url, provider);
    return request(url);
  }

  function coverUrl(id, provider) {
    return appendProvider('/api/cover/' + encodeURIComponent(id), provider);
  }

  function streamUrl(id, level, provider) {
    let url = '/api/stream/' + encodeURIComponent(id);
    if (level) url += '?level=' + encodeURIComponent(level);
    return appendProvider(url, provider);
  }

  function bilibiliResolve(input) {
    return request('/api/bilibili/resolve?input=' + encodeURIComponent(input), { timeout: 25000 });
  }

  function bilibiliLogin(cookieText) {
    return request('/api/bilibili/login', {
      method: 'POST',
      body: { cookie: cookieText || '' },
      timeout: 25000,
    });
  }

  function bilibiliVideoUrl(id) {
    return '/api/bilibili/video-stream/' + encodeURIComponent(id);
  }

  function bilibiliImport(formData) {
    return requestForm('/api/bilibili/import', formData, { timeout: 30000 });
  }

  function bilibiliImportStatus(jobId) {
    return request('/api/bilibili/import/' + encodeURIComponent(jobId), { timeout: 10000 });
  }

  function bilibiliMediaUrl(mediaId, kind) {
    return '/api/bilibili/media/' + encodeURIComponent(mediaId) + '/' + encodeURIComponent(kind);
  }

  function bilibiliDeleteMedia(mediaId) {
    return request('/api/bilibili/media/' + encodeURIComponent(mediaId), { method: 'DELETE', timeout: 15000 });
  }

  function bilibiliImportLocalCookie() {
    return request('/api/bilibili/cookie/import-local', { method: 'POST', timeout: 25000 });
  }

  function cacheTrack(track) {
    return request('/api/cache-track', {
      method: 'POST',
      body: track || {},
      timeout: 180000,
    });
  }

  function cachedAudioUrl(mediaId) {
    return '/api/cache/media/' + encodeURIComponent(mediaId) + '/audio';
  }

  function deleteCachedMedia(mediaId) {
    return request('/api/cache/media/' + encodeURIComponent(mediaId), { method: 'DELETE', timeout: 15000 });
  }

  return {
    status,
    logout,
    createQR,
    checkQR,
    search,
    songDetail,
    songUrl,
    lyrics,
    coverUrl,
    streamUrl,
    bilibiliResolve,
    bilibiliLogin,
    bilibiliVideoUrl,
    bilibiliImport,
    bilibiliImportStatus,
    bilibiliMediaUrl,
    bilibiliDeleteMedia,
    bilibiliImportLocalCookie,
    cacheTrack,
    cachedAudioUrl,
    deleteCachedMedia,
    getToken,
    setAuthExpiredHandler,
  };
})();

window.NetEase = NetEase;
