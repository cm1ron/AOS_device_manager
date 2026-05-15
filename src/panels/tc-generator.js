(function () {
  const ZOOM_KEY = (id) => `wv-zoom:${id}`;
  const URL_KEY = (id) => `wv-last-url:${id}`;

  // 저장된 마지막 URL 을 한 번만 강제 리셋해야 할 때 사용.
  // - id 변경/삭제는 절대 금지(기존 사용자 영향)
  // - 새 항목은 배열에 push 만 하면 됨
  const URL_MIGRATIONS = [
    { id: 'reset-jira-2026-05', webviewIds: ['jira-webview'] },
  ];
  try {
    for (const m of URL_MIGRATIONS) {
      const flag = `wv-migration:${m.id}`;
      if (localStorage.getItem(flag)) continue;
      for (const wid of (m.webviewIds || [])) {
        localStorage.removeItem(URL_KEY(wid));
      }
      localStorage.setItem(flag, '1');
    }
  } catch {}

  // Jira issue URL 패턴 (atlassian.net/browse/XXX-123)
  const JIRA_BROWSE_RE = /^https?:\/\/[^/]*atlassian\.net\/browse\//i;

  function isJiraIssueUrl(url) {
    return JIRA_BROWSE_RE.test(url || '');
  }

  function navigateInWebview(wv, url) {
    if (!wv || !url) return;
    try {
      const p = wv.loadURL(url);
      if (p && typeof p.catch === 'function') p.catch(() => { try { wv.setAttribute('src', url); } catch {} });
    } catch { try { wv.setAttribute('src', url); } catch {} }
  }

  function activateJiraPanel() {
    console.log('[tc-gen] activateJiraPanel');
    let switched = false;
    try {
      if (window.App && typeof App.switchPanel === 'function') {
        App.switchPanel('jira');
        switched = true;
      }
    } catch (e) { console.warn('[tc-gen] App.switchPanel 실패', e); }
    if (!switched) {
      // fallback: 좌측 nav-btn 직접 클릭
      const btn = document.querySelector('.nav-btn[data-panel="jira"], .nav-popover-item[data-panel="jira"]');
      if (btn) { btn.click(); switched = true; }
    }
    if (!switched) {
      // 마지막 수단: panel.active 토글 직접
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      const p = document.getElementById('panel-jira');
      if (p) p.classList.add('active');
    }
  }

  function routeToJira(url) {
    activateJiraPanel();
    const wv = document.getElementById('jira-webview');
    // switchPanel 직후 webview 가 즉시 layout 안 됐을 수 있어 약간 지연
    setTimeout(() => navigateInWebview(wv, url), 50);
  }

  function bind(prefix) {
    const wv = document.getElementById(`${prefix}-webview`);
    const reload = document.getElementById(`${prefix}-reload`);
    const back = document.getElementById(`${prefix}-back`);
    const fwd = document.getElementById(`${prefix}-forward`);
    const ext = document.getElementById(`${prefix}-open-external`);
    const urlLabel = document.getElementById(`${prefix}-url-label`);
    if (!wv) return;

    const wvId = `${prefix}-webview`;

    // 마지막 URL 저장
    const saveUrl = (url) => {
      if (!url) return;
      try { localStorage.setItem(URL_KEY(wvId), url); } catch {}
    };
    wv.addEventListener('did-navigate', (e) => {
      if (urlLabel && e && e.url) urlLabel.textContent = e.url;
      if (e && e.url) saveUrl(e.url);
    });
    wv.addEventListener('did-navigate-in-page', (e) => {
      if (urlLabel && e && e.url) urlLabel.textContent = e.url;
      if (e && e.url) saveUrl(e.url);
    });

    // Confluence 등에서 Jira 티켓 링크 클릭 → Jira 패널로 라우팅
    // will-navigate 는 main 프로세스에서 처리 (preventDefault 가 renderer 에서는 effective 하지 않음).
    // _blank / window.open 만 renderer 에서 가로채면 충분.
    if (prefix !== 'jira') {
      wv.addEventListener('new-window', (e) => {
        if (isJiraIssueUrl(e.url)) {
          e.preventDefault && e.preventDefault();
          routeToJira(e.url);
        }
      });
    }

    // 줌: dom-ready 시 저장된 값 복원
    wv.addEventListener('dom-ready', () => {
      try {
        const saved = parseFloat(localStorage.getItem(ZOOM_KEY(wvId)) || '1');
        if (saved && saved > 0) wv.setZoomFactor(saved);
      } catch {}
    });

    // 디버그가 필요할 때만 켜기 (woodman msal 등 도배 방지)
    // wv.addEventListener('console-message', (e) => { if (e && e.message) console.log(`[${prefix}-wv]`, e.message); });

    reload && reload.addEventListener('click', () => { try { wv.reload(); } catch {} });
    back && back.addEventListener('click', () => { try { if (wv.canGoBack()) wv.goBack(); } catch {} });
    fwd && fwd.addEventListener('click', () => { try { if (wv.canGoForward()) wv.goForward(); } catch {} });
    ext && ext.addEventListener('click', () => {
      const url = (() => { try { return wv.getURL(); } catch { return ''; } })();
      if (window.api && window.api.openExternal) window.api.openExternal(url);
      else { try { require('electron').shell.openExternal(url); } catch { window.open(url, '_blank'); } }
    });
  }

  // 줌 단축키 (활성 패널의 webview 에 적용)
  function setupZoomShortcuts() {
    const findActiveWebview = () => {
      const panel = document.querySelector('.panel.active');
      if (!panel) return null;
      const wvs = panel.querySelectorAll('webview');
      for (const wv of wvs) {
        const r = wv.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return wv;
      }
      return null;
    };
    const adjust = (delta) => {
      const wv = findActiveWebview();
      if (!wv) return;
      try {
        const cur = wv.getZoomFactor() || 1;
        let next = delta === 0 ? 1 : Math.max(0.3, Math.min(3, cur + delta));
        wv.setZoomFactor(next);
        try { localStorage.setItem(ZOOM_KEY(wv.id), String(next)); } catch {}
      } catch {}
    };
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '=') { adjust(0.1); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { adjust(-0.1); e.preventDefault(); }
      else if (e.key === '0') { adjust(0); e.preventDefault(); }
    });
    // Ctrl + 마우스휠
    window.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const wv = findActiveWebview();
      if (!wv) return;
      e.preventDefault();
      adjust(e.deltaY < 0 ? 0.1 : -0.1);
    }, { passive: false });
  }

  async function attachPreloadAndLoad() {
    let preloadUrl = '';
    try { preloadUrl = await window.api.getWebviewPreloadPath(); } catch (e) {
      console.warn('[tc-gen] preload path 가져오기 실패', e);
    }
    console.log('[tc-gen] preload URL =', preloadUrl);
    ['tc-webview', 'orca-webview', 'woodman-webview', 'sable-webview', 'github-webview'].forEach((id) => {
      const wv = document.getElementById(id);
      if (!wv) return;
      const defaultSrc = wv.getAttribute('data-src');
      const part = wv.getAttribute('data-partition');
      if (part) wv.setAttribute('partition', part);
      if (preloadUrl) wv.setAttribute('preload', preloadUrl);
      wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      if (window.attachWebviewReloadShortcut) window.attachWebviewReloadShortcut(wv);

      // 마지막 URL 복원 (없으면 default)
      let initialSrc = defaultSrc;
      try {
        const saved = localStorage.getItem(URL_KEY(id));
        if (saved && /^https?:\/\//i.test(saved)) initialSrc = saved;
      } catch {}
      console.log('[tc-gen] webview', id, 'partition=', part, 'src=', initialSrc);
      if (initialSrc) wv.setAttribute('src', initialSrc);
    });
  }

  // 패널 history (사이드바 카테고리 뒤로/앞으로)
  const PanelNav = {
    history: [],
    cursor: -1,
    suppress: false,
    push(name) {
      if (this.suppress) return;
      // 같은 패널 연속 진입은 무시
      if (this.cursor >= 0 && this.history[this.cursor] === name) return;
      this.history = this.history.slice(0, this.cursor + 1);
      this.history.push(name);
      this.cursor = this.history.length - 1;
      // 너무 많이 안 쌓이게
      if (this.history.length > 50) {
        this.history = this.history.slice(-50);
        this.cursor = this.history.length - 1;
      }
    },
    canBack() { return this.cursor > 0; },
    canForward() { return this.cursor >= 0 && this.cursor < this.history.length - 1; },
    back() {
      if (!this.canBack()) return;
      this.cursor--;
      const name = this.history[this.cursor];
      this.suppress = true;
      try { if (window.App && App.switchPanel) App.switchPanel(name); } finally { this.suppress = false; }
    },
    forward() {
      if (!this.canForward()) return;
      this.cursor++;
      const name = this.history[this.cursor];
      this.suppress = true;
      try { if (window.App && App.switchPanel) App.switchPanel(name); } finally { this.suppress = false; }
    },
  };
  window.PanelNav = PanelNav;

  // App.switchPanel 후킹: 호출될 때마다 history push
  function hookSwitchPanel() {
    if (!window.App || !App.switchPanel || App._panelNavHooked) return;
    const orig = App.switchPanel.bind(App);
    App.switchPanel = function (name) {
      const ret = orig(name);
      try { PanelNav.push(name); } catch {}
      return ret;
    };
    App._panelNavHooked = true;
  }

  function init() {
    bind('tc');
    bind('orca');
    bind('woodman');
    bind('sable');
    bind('github');
    // jira / confluence 는 issue-tabs.js 에서 탭 시스템으로 관리
    attachPreloadAndLoad();
    setupZoomShortcuts();

    // Jira issue 라우팅은 issue-tabs.js 에서 처리

    // webview 안에서 발생한 줌 변경(키/휠) → webContents id 로 매핑해서 localStorage 저장
    try {
      if (window.api && window.api.onWebviewZoomChanged) {
        const idMap = () => {
          const m = new Map();
          document.querySelectorAll('webview').forEach((w) => {
            try { if (typeof w.getWebContentsId === 'function') m.set(w.getWebContentsId(), w.id); } catch {}
          });
          return m;
        };
        window.api.onWebviewZoomChanged((wcId, factor) => {
          try {
            const id = idMap().get(wcId);
            if (id) localStorage.setItem(ZOOM_KEY(id), String(factor));
          } catch {}
        });
      }
    } catch {}
    // App 이 로드된 후 후킹 (약간 지연)
    setTimeout(hookSwitchPanel, 100);
    setTimeout(hookSwitchPanel, 500);

    const GH_LAST_URL_KEY = 'github.lastUrl';
    const GH_DEFAULT_URL = 'https://github.krafton.com/sbx/qa-automation/releases';
    // 1회성 마이그레이션: 이전 default(`/sbx/qa-automation`)가 마지막으로 저장돼 있으면 새 default로 교체
    try {
      const _last = localStorage.getItem(GH_LAST_URL_KEY);
      if (!_last || /\/sbx\/qa-automation\/?$/.test(_last)) {
        localStorage.setItem(GH_LAST_URL_KEY, GH_DEFAULT_URL);
      }
    } catch {}

    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('.github-quicklink');
      if (!btn) return;
      const url = btn.dataset.url;
      if (!url) return;
      const wv = document.getElementById('github-webview');
      const lbl = document.getElementById('github-url-label');
      if (wv) {
        try {
          const p = wv.loadURL(url);
          if (p && typeof p.catch === 'function') p.catch(() => { try { wv.src = url; } catch {} });
        } catch { try { wv.src = url; } catch {} }
      }
      if (lbl) lbl.textContent = url;
    }, true);

    // GitHub webview: 마지막 방문 URL 기억 → 패널 진입 시 복원
    const gwv = document.getElementById('github-webview');
    if (gwv) {
      const saveUrl = (u) => {
        if (!u || !/^https?:/.test(u)) return;
        try { localStorage.setItem(GH_LAST_URL_KEY, u); } catch {}
        const lbl = document.getElementById('github-url-label');
        if (lbl) lbl.textContent = u;
      };
      gwv.addEventListener('did-navigate', (e) => saveUrl(e.url));
      gwv.addEventListener('did-navigate-in-page', (e) => saveUrl(e.url));
      gwv.addEventListener('dom-ready', () => {
        // 첫 dom-ready 시 마지막 URL 있으면 그쪽으로, 아니면 default
        if (gwv.dataset._restored) return;
        gwv.dataset._restored = '1';
        let target = GH_DEFAULT_URL;
        try { target = localStorage.getItem(GH_LAST_URL_KEY) || GH_DEFAULT_URL; } catch {}
        const cur = gwv.getURL ? gwv.getURL() : '';
        if (target && target !== cur) {
          try { gwv.loadURL(target); } catch {}
        }
        const lbl = document.getElementById('github-url-label');
        if (lbl) lbl.textContent = target;
      });
    }
    try {
      localStorage.removeItem('tc-dark-mode');
      localStorage.removeItem('orca-dark-mode');
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
