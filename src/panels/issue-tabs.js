// Jira / Confluence 탭 시스템 (sites.js 의 hub/hiker 와 유사)
// - 같은 도메인(*.atlassian.net) 링크는 새 탭으로 열림 (Ctrl+클릭, _blank, window.open)
// - 외부 도메인은 외부 브라우저 메뉴
// - 탭 세션 저장(localStorage), 마지막 URL 보존
// - 모든 탭이 닫히면 기본 탭 자동 복원

(function () {
  const SESSION_KEY = 'issue-tabs.session.v1';
  const SITES = {
    jira: {
      label: 'Jira',
      icon: '<img src="../assets/icon-jira.png" style="width:16px;height:16px;object-fit:contain;vertical-align:middle">',
      defaultUrl: 'https://overdare.atlassian.net/',
      partition: 'persist:jira',
      // 같은 사이트로 간주할 호스트
      isSameSite: (h) => /(^|\.)atlassian\.net$/i.test(h),
    },
    confluence: {
      label: 'Confluence',
      icon: '<img src="../assets/icon-confluence.png" style="width:16px;height:16px;object-fit:contain;vertical-align:middle">',
      defaultUrl: 'https://overdare.atlassian.net/wiki/spaces/NFTMetaverse/pages/32012044/00.+QA',
      partition: 'persist:confluence',
      isSameSite: (h) => /(^|\.)atlassian\.net$/i.test(h),
    },
  };

  const URL_KEY = (id) => `wv-last-url:${id}`;
  const ZOOM_KEY = (id) => `wv-zoom:${id}`;
  const JIRA_BROWSE_RE = /^https?:\/\/[^/]*atlassian\.net\/browse\//i;

  let preloadUrl = '';
  // state[site] = { tabs: [{ id, url? }], active }
  const state = {};
  for (const s of Object.keys(SITES)) state[s] = { tabs: [], active: null };

  let _uid = 0;
  const nextId = (site) => `${site}-tab-${++_uid}`;

  // ---------- 세션 저장/로드 ----------
  let _saveTimer = null;
  function loadSession() {
    try {
      const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        for (const s of Object.keys(state)) {
          if (raw[s] && Array.isArray(raw[s].tabs)) {
            state[s].tabs = raw[s].tabs.filter(Boolean);
            state[s].active = raw[s].active || null;
          }
        }
      }
    } catch {}
  }
  function saveSession() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch {}
    }, 200);
  }

  // ---------- 활성/탭 렌더 ----------
  function _activate(site, id) {
    document.querySelectorAll(`#${site}-tab-list .site-tab`).forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === id);
    });
    document.querySelectorAll(`#${site}-stack .site-instance`).forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === id);
    });
    // 헤더 url 라벨 갱신
    const inst = document.querySelector(`#${site}-stack .site-instance[data-tab-id="${id}"]`);
    const wv = inst && inst.querySelector('webview');
    const lbl = document.getElementById(`${site}-url-label`);
    if (lbl && wv) {
      try { lbl.textContent = wv.getURL() || tabUrl(site, id) || SITES[site].defaultUrl; } catch {}
    }
  }

  function tabUrl(site, id) {
    const t = state[site].tabs.find(x => x.id === id);
    return t && t.url;
  }

  function _renderTab(site, tab) {
    const tabEl = document.createElement('button');
    tabEl.className = 'site-tab';
    tabEl.dataset.tabId = tab.id;
    tabEl.innerHTML = `
      <span class="site-tab-icon">${SITES[site].icon}</span>
      <span class="site-tab-name"></span>
      <span class="site-tab-close" title="닫기">×</span>
    `;
    const labelEl = tabEl.querySelector('.site-tab-name');
    labelEl.textContent = SITES[site].label;
    tabEl.title = tab.url || SITES[site].defaultUrl;
    tabEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('site-tab-close')) {
        e.stopPropagation();
        close(site, tab.id);
      } else {
        state[site].active = tab.id;
        _activate(site, tab.id);
        saveSession();
      }
    });
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); close(site, tab.id); }
    });
    document.getElementById(`${site}-tab-list`).appendChild(tabEl);

    const inst = document.createElement('div');
    inst.className = 'site-instance';
    inst.dataset.tabId = tab.id;

    const wv = document.createElement('webview');
    wv.style.cssText = 'flex:1;width:100%;height:100%';
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('partition', SITES[site].partition);
    wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    if (preloadUrl) wv.setAttribute('preload', preloadUrl);
    if (window.attachWebviewReloadShortcut) window.attachWebviewReloadShortcut(wv);

    const initialUrl = tab.url || SITES[site].defaultUrl;

    // 탭 라벨/툴팁 자동 업데이트 + 마지막 URL 저장
    const onNav = (e) => {
      if (!e || !e.url) return;
      tab.url = e.url;
      tabEl.title = e.url;
      try { labelEl.textContent = pageTitleFromUrl(site, e.url); } catch {}
      const lbl = document.getElementById(`${site}-url-label`);
      if (lbl && state[site].active === tab.id) lbl.textContent = e.url;
      saveSession();
    };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    wv.addEventListener('page-title-updated', (e) => {
      if (e && e.title) { labelEl.textContent = trim(e.title); tabEl.title = `${e.title}\n${tab.url || ''}`; }
    });

    // 줌 복원
    wv.addEventListener('dom-ready', () => {
      try {
        const saved = parseFloat(localStorage.getItem(ZOOM_KEY(`${site}-webview`)) || '1');
        if (saved && saved > 0) wv.setZoomFactor(saved);
      } catch {}
    });

    // 같은 도메인 → 새 탭, 외부 → 외부 브라우저 메뉴
    wv.addEventListener('new-window', (e) => {
      e.preventDefault && e.preventDefault();
      const href = e.url;
      if (!href) return;
      let host = '';
      try { host = new URL(href, initialUrl).hostname.toLowerCase(); } catch {}
      if (SITES[site].isSameSite(host)) {
        openInNewTab(site, href);
      } else {
        try { window.api.openExternal(href); } catch {}
      }
    });

    inst.appendChild(wv);
    document.getElementById(`${site}-stack`).appendChild(inst);
    setTimeout(() => { try { wv.setAttribute('src', initialUrl); } catch {} }, 0);
  }

  function pageTitleFromUrl(site, url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/browse\/([A-Z]+-\d+)/i);
      if (m) return m[1];
      const seg = u.pathname.split('/').filter(Boolean).pop();
      return trim(decodeURIComponent(seg || SITES[site].label));
    } catch { return SITES[site].label; }
  }
  function trim(s, n = 24) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // ---------- 공개 함수 ----------
  function open(site, url) {
    if (!SITES[site]) return;
    if (state[site].tabs.length === 0) {
      const tab = { id: nextId(site), url: url || SITES[site].defaultUrl };
      state[site].tabs.push(tab);
      _renderTab(site, tab);
      state[site].active = tab.id;
    } else if (!state[site].tabs.find(t => t.id === state[site].active)) {
      state[site].active = state[site].tabs[0].id;
    }
    _activate(site, state[site].active);
    saveSession();
  }

  function openInNewTab(site, url) {
    const tab = { id: nextId(site), url: url || SITES[site].defaultUrl };
    state[site].tabs.push(tab);
    _renderTab(site, tab);
    state[site].active = tab.id;
    _activate(site, tab.id);
    saveSession();
  }

  function close(site, id) {
    const idx = state[site].tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const wasActive = state[site].active === id;
    document.querySelector(`#${site}-tab-list [data-tab-id="${id}"]`)?.remove();
    document.querySelector(`#${site}-stack [data-tab-id="${id}"]`)?.remove();
    state[site].tabs.splice(idx, 1);

    if (state[site].tabs.length === 0) {
      const tab = { id: nextId(site), url: SITES[site].defaultUrl };
      state[site].tabs.push(tab);
      _renderTab(site, tab);
      state[site].active = tab.id;
      _activate(site, tab.id);
    } else if (wasActive) {
      const next = state[site].tabs[Math.min(idx, state[site].tabs.length - 1)];
      state[site].active = next.id;
      _activate(site, next.id);
    }
    saveSession();
  }

  function activeWebview(site) {
    const id = state[site].active;
    if (!id) return null;
    const inst = document.querySelector(`#${site}-stack .site-instance[data-tab-id="${id}"]`);
    return inst && inst.querySelector('webview');
  }

  function navigate(site, url) {
    const wv = activeWebview(site);
    if (!wv || !url) return;
    try {
      const p = wv.loadURL(url);
      if (p && typeof p.catch === 'function') p.catch(() => { try { wv.setAttribute('src', url); } catch {} });
    } catch { try { wv.setAttribute('src', url); } catch {} }
  }

  // 헤더 버튼(reload/back/forward/external) 바인딩
  function bindHeader(site) {
    const reload = document.getElementById(`${site}-reload`);
    const back = document.getElementById(`${site}-back`);
    const fwd = document.getElementById(`${site}-forward`);
    const ext = document.getElementById(`${site}-open-external`);
    const newTabBtn = document.getElementById(`${site}-new-tab`);
    reload && reload.addEventListener('click', () => { const wv = activeWebview(site); try { wv && wv.reload(); } catch {} });
    back && back.addEventListener('click', () => { const wv = activeWebview(site); try { if (wv && wv.canGoBack()) wv.goBack(); } catch {} });
    fwd && fwd.addEventListener('click', () => { const wv = activeWebview(site); try { if (wv && wv.canGoForward()) wv.goForward(); } catch {} });
    ext && ext.addEventListener('click', () => {
      const wv = activeWebview(site);
      const url = (() => { try { return wv && wv.getURL(); } catch { return ''; } })();
      if (url && window.api && window.api.openExternal) window.api.openExternal(url);
    });
    newTabBtn && newTabBtn.addEventListener('click', () => openInNewTab(site, SITES[site].defaultUrl));
  }

  function _ensureDefaultTabs() {
    for (const s of Object.keys(SITES)) {
      if (state[s].tabs.length === 0) {
        const tab = { id: nextId(s), url: SITES[s].defaultUrl };
        state[s].tabs.push(tab);
        state[s].active = tab.id;
      }
    }
  }
  function _renderAll() {
    for (const s of Object.keys(state)) {
      for (const tab of state[s].tabs) _renderTab(s, tab);
      if (state[s].active) _activate(s, state[s].active);
      else if (state[s].tabs[0]) {
        state[s].active = state[s].tabs[0].id;
        _activate(s, state[s].active);
      }
    }
  }

  function activateJiraPanel() {
    try {
      if (window.App && typeof App.switchPanel === 'function') App.switchPanel('jira');
      else document.querySelector('.nav-btn[data-panel="jira"], .nav-popover-item[data-panel="jira"]')?.click();
    } catch {}
  }

  function routeJiraIssue(url) {
    activateJiraPanel();
    // 활성 탭이 atlassian 외 페이지면 새 탭, 아니면 현재 탭에서 이동
    const wv = activeWebview('jira');
    let curHost = '';
    try { curHost = wv && wv.getURL ? new URL(wv.getURL()).hostname : ''; } catch {}
    if (curHost && /atlassian\.net$/i.test(curHost)) {
      setTimeout(() => navigate('jira', url), 50);
    } else {
      openInNewTab('jira', url);
    }
  }

  async function init() {
    try { preloadUrl = await window.api.getWebviewPreloadPath(); } catch {}
    loadSession();
    _ensureDefaultTabs();
    _renderAll();
    for (const s of Object.keys(SITES)) bindHeader(s);

    // Confluence 등에서 main 프로세스가 보내는 jira issue url 라우팅
    try {
      if (window.api && window.api.onJiraOpenIssue) {
        window.api.onJiraOpenIssue((url) => {
          if (JIRA_BROWSE_RE.test(url)) routeJiraIssue(url);
        });
      }
    } catch {}
  }

  window.IssueTabs = { open, openInNewTab, close, activeWebview, navigate };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
