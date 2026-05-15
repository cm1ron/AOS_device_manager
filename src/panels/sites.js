// Hub / Hiker × dev / staging / live = 6개 사이트 패널
// 각 패널은 자기 종류의 탭만 가짐.
//   - dev 패널의 + : 새 환경 키워드 입력 → 새 탭
//   - staging/live 패널의 + : 같은 URL 로 새 탭 (복사·비교용)
// 좌측 nav 에서 환경 클릭 → SiteTabs.open(site, kind, env?) → 해당 패널로 전환 + 탭 활성/추가

(function () {
  const SESSION_KEY = 'sites.session.v3';
  const SITES = {
    hub: {
      label: 'Hub',
      icon: '<img src="../assets/icon-hub.png" style="width:18px;height:18px;object-fit:contain;vertical-align:middle">',
      dev:     { template: (env) => `https://eterno-${env}.ovdr.io/`,           prefix: 'https://eterno-', suffix: '.ovdr.io/' },
      staging: { url: 'https://eterno-release-qa.overdare.com/' },
      live:    { url: 'https://create.overdare.com/' },
    },
    hiker: {
      label: 'Hiker',
      icon: '<img class="tab-img-light-on-dark" src="../assets/icon-hiker.png" style="width:18px;height:18px;object-fit:contain;vertical-align:middle">',
      dev:     { template: (env) => `https://hiker-${env}.ovdr.io/login`,       prefix: 'https://hiker-', suffix: '.ovdr.io/login' },
      staging: { url: 'https://hiker-release-qa.ovdr.io/login' },
      live:    { url: 'https://hiker-live.ovdr.io/' },
    },
  };
  // 탭바 아이콘은 사이트 아이콘으로 통일 (KIND_ICON 은 더 이상 사용 안 함, kind 라벨만 사용)
  const KIND_LABEL = { dev: 'dev', staging: 'release-qa', live: 'live' };

  let preloadUrl = '';

  // panel key = `${site}-${kind}`
  // state[key] = { tabs: [{ id, env? }], active }
  const state = {};
  for (const s of Object.keys(SITES)) for (const k of ['dev', 'staging', 'live']) state[`${s}-${k}`] = { tabs: [], active: null };

  let _saveTimer = null;
  function loadSession() {
    try {
      const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        for (const key of Object.keys(state)) {
          if (raw[key] && Array.isArray(raw[key].tabs)) {
            state[key].tabs = raw[key].tabs.filter(Boolean);
            state[key].active = raw[key].active || null;
          }
        }
      }
    } catch { /* ignore */ }
  }
  function saveSession() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    }, 200);
  }

  let _uid = 0;
  const nextId = (key, env) => `${key}-${env || 'fixed'}-${++_uid}`;

  function _activate(key, id) {
    document.querySelectorAll(`#${key}-tab-list .site-tab`).forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === id);
    });
    document.querySelectorAll(`#${key}-stack .site-instance`).forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === id);
    });
  }

  function _renderTab(site, kind, tab) {
    const key = `${site}-${kind}`;
    const tabEl = document.createElement('button');
    tabEl.className = 'site-tab';
    tabEl.dataset.tabId = tab.id;
    const label = kind === 'dev' ? `dev: ${tab.env}` : KIND_LABEL[kind];
    tabEl.innerHTML = `
      <span class="site-tab-icon">${SITES[site].icon}</span>
      <span class="site-tab-name"></span>
      <span class="site-tab-close" title="닫기">×</span>
    `;
    tabEl.querySelector('.site-tab-name').textContent = label;
    tabEl.title = label;
    tabEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('site-tab-close')) {
        e.stopPropagation();
        close(site, kind, tab.id);
      } else {
        state[key].active = tab.id;
        _activate(key, tab.id);
        saveSession();
      }
    });
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); close(site, kind, tab.id); }
    });
    document.getElementById(`${key}-tab-list`).appendChild(tabEl);

    const inst = document.createElement('div');
    inst.className = 'site-instance';
    inst.dataset.tabId = tab.id;

    if (kind !== 'dev') {
      const url = SITES[site][kind].url;
      const tb = document.createElement('div');
      tb.className = 'site-dev-toolbar';
      tb.innerHTML = `
        <span>${SITES[site].icon} ${SITES[site].label} / ${KIND_LABEL[kind]}</span>
        <span class="site-static-url"></span>
        <button class="btn btn-sm site-static-reload" title="새로고침">↻</button>
        <button class="btn btn-sm site-static-devtools" title="개발자 도구">🔧</button>
        <button class="btn btn-sm site-static-external" title="외부 브라우저에서 열기 (MetaMask 등)">↗</button>
      `;
      const urlEl = tb.querySelector('.site-static-url');
      urlEl.textContent = url; urlEl.title = url;
      tb.querySelector('.site-static-reload').addEventListener('click', () => {
        try { inst.querySelector('webview').reload(); } catch { /* ignore */ }
      });
      tb.querySelector('.site-static-devtools').addEventListener('click', () => {
        try { inst.querySelector('webview').openDevTools(); } catch { /* ignore */ }
      });
      tb.querySelector('.site-static-external').addEventListener('click', (ev) => {
        const u = (() => { try { return inst.querySelector('webview').getURL() || url; } catch { return url; } })();
        _showBrowserMenu(ev.currentTarget, u);
      });
      inst.appendChild(tb);
    }

    if (kind === 'dev') {
      const tb = document.createElement('div');
      tb.className = 'site-dev-toolbar';
      tb.innerHTML = `
        <span>${SITES[site].icon} ${SITES[site].label} / dev</span>
        <span class="site-url-prefix"></span>
        <input type="text" class="site-env-input" placeholder="qa" />
        <span class="site-url-suffix"></span>
        <button class="btn btn-sm site-dev-go">이동</button>
        <button class="btn btn-sm site-dev-reload" title="새로고침">↻</button>
        <button class="btn btn-sm site-dev-qa" title="qa 환경으로 이동">qa</button>
        <button class="btn btn-sm site-dev-devtools" title="개발자 도구">🔧</button>
        <button class="btn btn-sm site-dev-external" title="외부 브라우저에서 열기 (MetaMask 등)">↗</button>
        <span class="site-current-url"></span>
      `;
      tb.querySelector('.site-url-prefix').textContent = SITES[site].dev.prefix;
      tb.querySelector('.site-url-suffix').textContent = SITES[site].dev.suffix;
      const input = tb.querySelector('.site-env-input');
      input.value = tab.env || 'qa';
      const cur = tb.querySelector('.site-current-url');
      const apply = () => {
        const env = (input.value || 'qa').trim();
        if (!env) return;
        tab.env = env;
        const url = SITES[site].dev.template(env);
        const wv = inst.querySelector('webview');
        try { wv.setAttribute('src', url); } catch { /* ignore */ }
        cur.textContent = url; cur.title = url;
        tabEl.querySelector('.site-tab-name').textContent = `dev: ${env}`;
        tabEl.title = `dev: ${env}`;
        saveSession();
      };
      tb.querySelector('.site-dev-go').addEventListener('click', apply);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      tb.querySelector('.site-dev-reload').addEventListener('click', () => {
        try { inst.querySelector('webview').reload(); } catch { /* ignore */ }
      });
      tb.querySelector('.site-dev-qa').addEventListener('click', () => { input.value = 'qa'; apply(); });
      tb.querySelector('.site-dev-devtools').addEventListener('click', () => {
        try { inst.querySelector('webview').openDevTools(); } catch { /* ignore */ }
      });
      tb.querySelector('.site-dev-external').addEventListener('click', (ev) => {
        const wv = inst.querySelector('webview');
        let u;
        try { u = (wv && wv.getURL && wv.getURL()) || SITES[site].dev.template((input.value || 'qa').trim() || 'qa'); }
        catch { u = SITES[site].dev.template('qa'); }
        _showBrowserMenu(ev.currentTarget, u);
      });
      inst.appendChild(tb);
    }

    const wv = document.createElement('webview');
    wv.style.cssText = 'flex:1;width:100%;height:100%';
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    if (window.attachWebviewReloadShortcut) window.attachWebviewReloadShortcut(wv);
    // partition 통일 (krafton-sso): MS SSO 한 번 로그인하면 모든 사이트 자동 로그인
    wv.setAttribute('partition', 'persist:krafton-sso');
    if (preloadUrl) wv.setAttribute('preload', preloadUrl);

    const initialUrl = kind === 'dev' ? SITES[site].dev.template(tab.env) : SITES[site][kind].url;

    if (kind === 'dev') {
      wv.addEventListener('did-navigate', (e) => {
        const cur = inst.querySelector('.site-current-url');
        if (cur && e?.url) { cur.textContent = e.url; cur.title = e.url; }
      });
    }

    // 같은 사이트 도메인 (hub*.ovdr.io / hiker*.ovdr.io / *.overdare.com) 링크는 새 탭으로,
    // 그 외는 외부 브라우저로
    const isSameSite = (href) => {
      try {
        const u = new URL(href, initialUrl);
        const host = u.hostname.toLowerCase();
        if (site === 'hiker') return /(^|\.)ovdr\.io$/.test(host) && host.startsWith('hiker');
        if (site === 'hub')   return /(^|\.)overdare\.com$/.test(host) || (/(^|\.)ovdr\.io$/.test(host) && host.startsWith('eterno'));
        return false;
      } catch { return false; }
    };
    wv.addEventListener('new-window', (e) => {
      e.preventDefault();
      const href = e.url;
      if (!href) return;
      if (isSameSite(href)) {
        const newTab = { id: nextId(`${site}-${kind}`, kind === 'dev' ? tab.env : kind), env: tab.env };
        state[`${site}-${kind}`].tabs.push(newTab);
        _renderTab(site, kind, newTab);
        state[`${site}-${kind}`].active = newTab.id;
        _activate(`${site}-${kind}`, newTab.id);
        const newInst = document.querySelector(`#${site}-${kind}-stack .site-instance[data-tab-id="${newTab.id}"]`);
        const newWv = newInst && newInst.querySelector('webview');
        if (newWv) setTimeout(() => { try { newWv.setAttribute('src', href); } catch {} }, 0);
        saveSession();
      } else {
        try { window.api.openExternal(href); } catch {}
      }
    });

    inst.appendChild(wv);
    document.getElementById(`${key}-stack`).appendChild(inst);
    setTimeout(() => { try { wv.setAttribute('src', initialUrl); } catch { /* ignore */ } }, 0);
  }

  function open(site, kind, env, opts = {}) {
    if (!SITES[site] || !KIND_LABEL[kind]) return;
    const key = `${site}-${kind}`;
    if (kind === 'dev') {
      env = (env || 'qa').trim();
      // forceNew 면 같은 env 가 있어도 새 탭 추가
      let tab = opts.forceNew ? null : state[key].tabs.find(t => t.env === env);
      if (!tab) {
        tab = { id: nextId(key, env), env };
        state[key].tabs.push(tab);
        _renderTab(site, kind, tab);
      }
      state[key].active = tab.id;
      _activate(key, tab.id);
    } else {
      // staging/live: 탭이 하나도 없으면 만들고, 있으면 마지막 활성 탭으로
      if (state[key].tabs.length === 0) {
        const tab = { id: nextId(key, kind) };
        state[key].tabs.push(tab);
        _renderTab(site, kind, tab);
        state[key].active = tab.id;
      } else if (!state[key].tabs.find(t => t.id === state[key].active)) {
        state[key].active = state[key].tabs[0].id;
      }
      _activate(key, state[key].active);
    }
    saveSession();
  }

  function addCopy(site, kind) {
    const key = `${site}-${kind}`;
    const tab = { id: nextId(key, kind) };
    state[key].tabs.push(tab);
    _renderTab(site, kind, tab);
    state[key].active = tab.id;
    _activate(key, tab.id);
    saveSession();
  }

  function close(site, kind, id) {
    const key = `${site}-${kind}`;
    const idx = state[key].tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const wasActive = state[key].active === id;
    document.querySelector(`#${key}-tab-list [data-tab-id="${id}"]`)?.remove();
    document.querySelector(`#${key}-stack [data-tab-id="${id}"]`)?.remove();
    state[key].tabs.splice(idx, 1);

    if (state[key].tabs.length === 0) {
      // 모든 탭 닫힘 → 기본 탭 자동 복원
      if (kind === 'dev') {
        const defaultTab = { id: nextId(key, 'qa'), env: 'qa' };
        state[key].tabs.push(defaultTab);
        _renderTab(site, kind, defaultTab);
        state[key].active = defaultTab.id;
        _activate(key, defaultTab.id);
      } else {
        const defaultTab = { id: nextId(key, kind) };
        state[key].tabs.push(defaultTab);
        _renderTab(site, kind, defaultTab);
        state[key].active = defaultTab.id;
        _activate(key, defaultTab.id);
      }
    } else if (wasActive) {
      const next = state[key].tabs[Math.min(idx, state[key].tabs.length - 1)];
      state[key].active = next.id;
      _activate(key, next.id);
    }
    saveSession();
  }

  // ----------------- 외부 브라우저 메뉴 -----------------
  let _browserMenu = null;
  function _hideBrowserMenu() { if (_browserMenu) { _browserMenu.remove(); _browserMenu = null; } }
  function _showBrowserMenu(anchor, url) {
    _hideBrowserMenu();
    const menu = document.createElement('div');
    menu.className = 'site-add-popover';
    menu.style.minWidth = '180px';
    menu.innerHTML = `
      <div class="site-add-title">외부 브라우저로 열기</div>
      <div class="site-add-actions" style="flex-direction:column;align-items:stretch;gap:4px">
        <button class="btn btn-sm" data-browser="chrome">🟢 Chrome</button>
        <button class="btn btn-sm" data-browser="edge">🟦 Edge</button>
        <button class="btn btn-sm" data-browser="whale">🐳 Whale</button>
        <button class="btn btn-sm" data-browser="">🌐 기본 브라우저</button>
      </div>
    `;
    document.body.appendChild(menu);
    menu.addEventListener('click', (e) => e.stopPropagation());
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, r.right - 200) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    menu.querySelectorAll('button[data-browser]').forEach((b) => {
      b.addEventListener('click', async () => {
        const browser = b.dataset.browser;
        try {
          const res = await window.api.openExternal(url, { browser });
          if (!res || !res.ok) console.warn('[sites] openExternal 실패', res);
        } catch (err) { console.warn('[sites] openExternal err', err); }
        _hideBrowserMenu();
      });
    });
    _browserMenu = menu;
  }

  // ----------------- + 버튼 + add 팝오버 -----------------
  let _addPop = null;
  function _hideAddPopover() { if (_addPop) { _addPop.remove(); _addPop = null; } }
  function _onDocClickForAddPop(e) {
    if (!_addPop) return;
    if (_addPop.contains(e.target)) return;
    _hideAddPopover();
  }
  function _showDevAddPopover(site, anchor) {
    _hideAddPopover();
    const pop = document.createElement('div');
    pop.className = 'site-add-popover';
    pop.innerHTML = `
      <div class="site-add-title">새 dev 환경 탭</div>
      <div class="site-add-row">
        <span class="site-url-prefix"></span>
        <input type="text" class="site-env-input site-add-input" placeholder="qa" />
        <span class="site-url-suffix"></span>
      </div>
      <div class="site-add-actions">
        <button class="btn btn-sm site-add-cancel">취소</button>
        <button class="btn btn-sm site-add-ok">추가</button>
      </div>
    `;
    pop.querySelector('.site-url-prefix').textContent = SITES[site].dev.prefix;
    pop.querySelector('.site-url-suffix').textContent = SITES[site].dev.suffix;
    document.body.appendChild(pop);
    pop.addEventListener('click', (e) => e.stopPropagation());
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left - 220) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    const input = pop.querySelector('.site-add-input');
    setTimeout(() => input.focus(), 0);
    const submit = () => {
      const env = (input.value || '').trim();
      if (!env) { input.focus(); return; }
      open(site, 'dev', env, { forceNew: true });
      _hideAddPopover();
    };
    pop.querySelector('.site-add-ok').addEventListener('click', submit);
    pop.querySelector('.site-add-cancel').addEventListener('click', _hideAddPopover);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    _addPop = pop;
  }

  function _bindAddButtons() {
    document.querySelectorAll('.site-tab-add').forEach((btn) => {
      const site = btn.dataset.site;
      const kind = btn.dataset.kind;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (kind === 'dev') {
          // 현재 활성 dev 탭의 입력칸 값을 그대로 받아 새 탭 추가
          const key = `${site}-${kind}`;
          const activeId = state[key].active;
          const activeInst = activeId ? document.querySelector(`#${key}-stack .site-instance[data-tab-id="${activeId}"]`) : null;
          const input = activeInst?.querySelector('.site-env-input');
          const env = (input?.value || 'qa').trim() || 'qa';
          open(site, 'dev', env, { forceNew: true });
        } else {
          addCopy(site, kind);
        }
      });
    });
    // capture 단계로 전역 클릭 감지 → 팝오버 외부면 닫기
    document.addEventListener('mousedown', _onDocClickForAddPop, true);
    document.addEventListener('mousedown', (e) => {
      if (_browserMenu && !_browserMenu.contains(e.target)) _hideBrowserMenu();
    }, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { _hideAddPopover(); _hideBrowserMenu(); } });
    window.addEventListener('blur', () => { _hideAddPopover(); _hideBrowserMenu(); });
  }

  function _ensureDefaultTabs() {
    for (const site of Object.keys(SITES)) {
      const devKey = `${site}-dev`;
      if (state[devKey].tabs.length === 0) {
        const tab = { id: nextId(devKey, 'qa'), env: 'qa' };
        state[devKey].tabs.push(tab);
        state[devKey].active = tab.id;
      }
      // staging/live 는 첫 진입 시 _open 에서 만들어짐 (lazy)
    }
  }

  function _renderAll() {
    for (const key of Object.keys(state)) {
      const [site, kind] = key.split('-');
      for (const tab of state[key].tabs) _renderTab(site, kind, tab);
      if (state[key].active) _activate(key, state[key].active);
      else if (state[key].tabs[0]) {
        state[key].active = state[key].tabs[0].id;
        _activate(key, state[key].active);
      }
    }
  }

  async function init() {
    try { preloadUrl = await window.api.getWebviewPreloadPath(); } catch { /* ignore */ }
    loadSession();
    _ensureDefaultTabs();
    _renderAll();
    _bindAddButtons();
  }

  window.SiteTabs = { open, close };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
