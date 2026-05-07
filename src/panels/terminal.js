/* global Terminal, FitAddon, WebLinksAddon, SearchAddon */

// 탭 1개 = 셸 1개 + xterm 인스턴스 1개
class TerminalTab {
  constructor(panel, opts = {}) {
    this.panel = panel;
    this.id = `tab-${++TerminalTab._uid}`;
    this.spawnOpts = opts;
    this.userLabel = opts.label || null;
    this.label = opts.label || '터미널';
    this.sessionId = null;
    this.term = null;
    this.fit = null;
    this.unsubData = null;
    this.unsubExit = null;
    this.resizeObserver = null;
    this.dirty = false;
    this.exited = false;
    this.statusText = '';

    this.tabEl = document.createElement('button');
    this.tabEl.className = 'terminal-tab';
    this.tabEl.title = this.label;
    this.tabEl.innerHTML = `
      <span class="terminal-tab-name"></span>
      <span class="terminal-tab-close" title="닫기">×</span>
    `;
    this.nameEl = this.tabEl.querySelector('.terminal-tab-name');
    this.closeEl = this.tabEl.querySelector('.terminal-tab-close');
    this._renderName();

    this.tabEl.addEventListener('click', (e) => {
      if (e.target === this.closeEl) {
        e.stopPropagation();
        this.panel.closeTab(this);
      } else {
        this.panel.activateTab(this);
      }
    });
    this.tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.panel.closeTab(this);
      }
    });

    this.containerEl = document.createElement('div');
    this.containerEl.className = 'terminal-instance';
    this.containerEl.dataset.tabId = this.id;
  }

  _renderName() {
    this.nameEl.textContent = this.label + (this.exited ? ' (종료됨)' : '');
    this.tabEl.classList.toggle('dirty', this.dirty && !this.panel.isActive(this));
  }

  setLabel(label) {
    this.label = label;
    this.tabEl.title = label;
    this._renderName();
  }

  markDirty() {
    if (this.panel.isActive(this)) return;
    this.dirty = true;
    this._renderName();
  }

  clearDirty() {
    if (!this.dirty) return;
    this.dirty = false;
    this._renderName();
  }

  async ensure() {
    if (!this.term) this._buildTerm();
    if (!this.sessionId && !this.exited) await this._spawn();
    this._refit();
    requestAnimationFrame(() => this._refit());
    setTimeout(() => this._refit(), 120);
    this.term.focus();
  }

  _buildTerm() {
    this.term = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: TerminalPanel._currentTheme(),
    });
    this.fit = new FitAddon.FitAddon();
    this.term.loadAddon(this.fit);
    try { this.term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch { /* optional */ }
    try { this.search = new SearchAddon.SearchAddon(); this.term.loadAddon(this.search); } catch { /* optional */ }

    this.term.open(this.containerEl);
    this.term.onData((data) => {
      if (this.sessionId != null) window.api.terminal.write(this.sessionId, data);
      // Ctrl+C (0x03) 직후 TUI 잔재 정리 위해 약간의 지연 후 fit/resize
      // + 화면 맨 아래로 스크롤하여 잔재가 위에 남아있어도 새 프롬프트는 아래에 보이게
      if (data === '\x03') {
        clearTimeout(this._sigintFitT);
        this._sigintFitT = setTimeout(() => {
          this._refit && this._refit();
          if (this.term) {
            try {
              this.term.scrollToBottom();
              this.term.write('\x1b[999;1H');
            } catch {}
          }
        }, 120);
      }
    });

    // xterm 안에서도 단축키가 동작하도록 가로채기
    const self = this;
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const ctrlShift = e.ctrlKey && e.shiftKey;
      const ctrl = e.ctrlKey && !e.shiftKey && !e.altKey;
      const k = e.key;
      if (ctrlShift && (k === 'C' || k === 'c')) {
        // 선택이 있으면 우리가 복사 처리(xterm 기본은 다소 불안정), 없으면 SIGINT 통과
        if (self.term.hasSelection()) { TerminalPanel.copySelection(); return false; }
        return true;
      }
      if (ctrlShift && (k === 'V' || k === 'v')) {
        // xterm 의 native paste 만 사용 → 중복 입력 방지. 여기선 키만 통과시킴.
        return true;
      }
      if (ctrlShift && (k === 'T' || k === 't')) { TerminalPanel.newTab(); return false; }
      if (ctrlShift && (k === 'W' || k === 'w')) { TerminalPanel.closeTab(self); return false; }
      if (ctrl && (k === 'f' || k === 'F')) { TerminalPanel.openSearch(); return false; }
      if (ctrl && (k === '=' || k === '+')) { TerminalPanel.adjustFontSize(1); return false; }
      if (ctrl && k === '-') { TerminalPanel.adjustFontSize(-1); return false; }
      if (ctrl && k === '0') { TerminalPanel.resetFontSize(); return false; }
      return true;
    });

    // 폰트 크기 적용
    if (TerminalPanel.fontSize) {
      try { this.term.options.fontSize = TerminalPanel.fontSize; } catch { /* ignore */ }
    }

    // 우클릭 메뉴
    this.containerEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      TerminalPanel.showContextMenu(e.clientX, e.clientY);
    });

    // Ctrl+휠로 폰트 줌
    this.containerEl.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      TerminalPanel.adjustFontSize(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    this.resizeObserver = new ResizeObserver(() => this._refit());
    this.resizeObserver.observe(this.containerEl);
  }

  async _spawn() {
    const cols = this.term?.cols || 100;
    const rows = this.term?.rows || 30;
    const createOpts = { cols, rows };
    if (this.spawnOpts?.shell) createOpts.shell = this.spawnOpts.shell;
    if (this.spawnOpts?.args) createOpts.args = this.spawnOpts.args;
    if (this.spawnOpts?.cwd) createOpts.cwd = this.spawnOpts.cwd;
    const res = await window.api.terminal.create(createOpts);
    if (res && res.error) {
      this.term.write(`\r\n\x1b[31m[Terminal 시작 실패] ${res.error}\x1b[0m\r\n`);
      this.statusText = '오류';
      this.panel._refreshStatus();
      return;
    }
    this.sessionId = res.id;
    this.cwd = res.cwd;
    const shellName = res.shell.split(/[\\/]/).pop().replace(/\.exe$/i, '');
    if (!this.userLabel) this.setLabel(shellName);
    this.statusText = `${this.userLabel || shellName}  •  ${res.cwd}`;
    this.panel._refreshStatus();
    this.panel._saveSession();

    this.unsubData = window.api.terminal.onData(this.sessionId, (data) => {
      if (this.term) this.term.write(data);
      this.markDirty();
      try { window.captureClaudeResume && window.captureClaudeResume(data, this.cwd); } catch {}
    });
    this.unsubExit = window.api.terminal.onExit(this.sessionId, ({ exitCode }) => {
      if (this.term) this.term.write(`\r\n\x1b[33m[셸 종료됨, exit=${exitCode}]\x1b[0m\r\n`);
      this.exited = true;
      this.statusText = `${this.label} (exit ${exitCode})`;
      this._renderName();
      this.panel._refreshStatus();
      this._cleanupSubs();
    });
  }

  async restart() {
    if (this.sessionId != null) {
      try { window.api.terminal.kill(this.sessionId); } catch { /* ignore */ }
      this._cleanupSubs();
    }
    this.exited = false;
    this.sessionId = null;
    if (this.term) this.term.clear();
    await this._spawn();
    this.term?.focus();
  }

  _refit() {
    if (!this.fit || !this.term) return;
    if (!this.panel.isActive(this)) return;
    try {
      this.fit.fit();
      if (this.sessionId != null) {
        window.api.terminal.resize(this.sessionId, this.term.cols, this.term.rows);
      }
    } catch { /* ignore */ }
  }

  applyTheme() {
    if (!this.term) return;
    try { this.term.options.theme = TerminalPanel._currentTheme(); } catch { /* ignore */ }
  }

  dispose() {
    if (this.sessionId != null) {
      try { window.api.terminal.kill(this.sessionId); } catch { /* ignore */ }
    }
    this._cleanupSubs();
    try { this.resizeObserver?.disconnect(); } catch { /* ignore */ }
    try { this.term?.dispose(); } catch { /* ignore */ }
    this.term = null;
    this.fit = null;
    this.tabEl.remove();
    this.containerEl.remove();
  }

  _cleanupSubs() {
    try { this.unsubData && this.unsubData(); } catch { /* ignore */ }
    try { this.unsubExit && this.unsubExit(); } catch { /* ignore */ }
    this.unsubData = null;
    this.unsubExit = null;
  }
}
TerminalTab._uid = 0;

const TerminalPanel = {
  tabs: [],
  active: null,
  initialized: false,

  shells: [],
  defaultShell: null,
  adbPath: 'adb',
  fontSize: 13,
  MIN_FONT: 8,
  MAX_FONT: 28,
  SESSION_KEY: 'terminal.session.v1',
  _saveTimer: null,
  _restoring: false,

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    this.tabListEl = document.getElementById('terminal-tab-list');
    this.stackEl = document.getElementById('terminal-stack');
    this.statusEl = document.getElementById('terminal-status');
    this.menuEl = document.getElementById('terminal-tab-menu');
    this.cwdEl = document.getElementById('terminal-cwd-path');
    this.contextMenuEl = document.getElementById('terminal-context-menu');
    this.searchEl = document.getElementById('terminal-search');
    this.searchInputEl = document.getElementById('terminal-search-input');
    this.searchCountEl = document.getElementById('terminal-search-count');

    // localStorage 에서 폰트 크기 복원
    const savedFont = parseInt(localStorage.getItem('terminal-font-size') || '13', 10);
    if (savedFont >= this.MIN_FONT && savedFont <= this.MAX_FONT) this.fontSize = savedFont;

    document.getElementById('terminal-tab-add').addEventListener('click', () => this.newTab());
    document.getElementById('terminal-tab-add-caret').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });
    document.getElementById('terminal-clear-btn').addEventListener('click', () => {
      const tab = this.active;
      if (!tab?.term) return;
      // Ctrl+L 을 셸에 보내서 셸이 직접 화면을 비우고 prompt를 다시 그리게 한다
      if (tab.sessionId != null) {
        try { window.api.terminal.write(tab.sessionId, '\x0c'); } catch { /* ignore */ }
      } else {
        tab.term.clear();
      }
    });
    document.getElementById('terminal-kill-btn').addEventListener('click', () => {
      this.active?.restart();
    });
    document.getElementById('terminal-device-shell-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleDeviceShellClick();
    });

    document.addEventListener('click', (e) => {
      if (!this.menuEl.contains(e.target)) this.hideMenu();
    });

    document.querySelectorAll('.nav-btn[data-panel="terminal"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setTimeout(() => this.onShow(), 30);
      });
    });

    window.addEventListener('keydown', (e) => {
      const panelActive = document.getElementById('panel-terminal')?.classList.contains('active');
      if (!panelActive) return;
      const ctrlShift = e.ctrlKey && e.shiftKey;
      const ctrl = e.ctrlKey && !e.shiftKey && !e.altKey;

      // 중요: xterm 포커스 상태에서는 attachCustomKeyEventHandler 가 처리하므로,
      // 여기서는 xterm 외부에 포커스가 있을 때만 단축키를 처리해 중복을 방지.
      const inTerm = e.target && (e.target.classList?.contains('xterm-helper-textarea') || e.target.closest?.('.terminal-instance'));
      if (inTerm) {
        // paste/copy 등은 xterm 핸들러가 담당
        if (e.key === 'Escape' && this.searchEl.style.display === 'flex') { e.preventDefault(); this.closeSearch(); }
        return;
      }
      if (ctrlShift && (e.key === 'T' || e.key === 't')) { e.preventDefault(); this.newTab(); }
      else if (ctrlShift && (e.key === 'W' || e.key === 'w')) { e.preventDefault(); if (this.active) this.closeTab(this.active); }
      else if (ctrlShift && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); this.copySelection(); }
      else if (ctrlShift && (e.key === 'V' || e.key === 'v')) { e.preventDefault(); this.pasteFromClipboard(); }
      else if (ctrl && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); this.openSearch(); }
      else if (e.key === 'Escape' && this.searchEl.style.display === 'flex') { e.preventDefault(); this.closeSearch(); }
      else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.adjustFontSize(1); }
      else if (ctrl && e.key === '-') { e.preventDefault(); this.adjustFontSize(-1); }
      else if (ctrl && e.key === '0') { e.preventDefault(); this.resetFontSize(); }
    });

    // CWD 바 이벤트
    document.getElementById('terminal-open-folder-btn').addEventListener('click', () => {
      const cwd = this.active?.cwd;
      if (cwd) window.api.terminal.openFolder(cwd);
    });
    this.cwdEl.addEventListener('dblclick', () => {
      const cwd = this.active?.cwd;
      if (cwd) navigator.clipboard.writeText(cwd).then(() => App.toast('경로가 복사되었습니다', 'info'));
    });

    // 우클릭 메뉴
    this.contextMenuEl.querySelectorAll('.menu-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.hideContextMenu();
        const action = el.dataset.action;
        if (action === 'copy') this.copySelection();
        else if (action === 'paste') this.pasteFromClipboard();
        else if (action === 'select-all') this.active?.term?.selectAll();
        else if (action === 'search') this.openSearch();
        else if (action === 'clear') this.active?.term?.clear();
      });
    });
    document.addEventListener('click', () => this.hideContextMenu());

    // 검색 바 이벤트
    document.getElementById('terminal-search-close').addEventListener('click', () => this.closeSearch());
    document.getElementById('terminal-search-prev').addEventListener('click', () => this.searchFind(-1));
    document.getElementById('terminal-search-next').addEventListener('click', () => this.searchFind(1));
    this.searchInputEl.addEventListener('input', () => this.searchFind(1, true));
    this.searchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.searchFind(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeSearch(); }
    });

    window.addEventListener('resize', () => this.active?._refit());

    // 테마 변경 감지 → 모든 탭의 xterm 테마 즉시 갱신
    new MutationObserver((muts) => {
      if (!muts.some((m) => m.attributeName === 'data-theme')) return;
      this.tabs.forEach((t) => t.applyTheme());
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // 디바이스 변경 감지 → 디바이스 셸 버튼 활성/비활성
    document.getElementById('device-selector')?.addEventListener('change', () => this._refreshDeviceShellBtn());
    setInterval(() => this._refreshDeviceShellBtn(), 1000);

    // 셸 목록 / adb 경로 미리 받아두기
    try {
      this.shells = await window.api.terminal.listShells();
      this.defaultShell = this.shells.find((s) => s.default) || this.shells[0] || null;
    } catch { /* keep empty */ }
    try { this.adbPath = await window.api.terminal.getAdbPath() || 'adb'; } catch { /* ignore */ }
  },

  async _refreshDeviceShellBtn() {
    const btn = document.getElementById('terminal-device-shell-btn');
    if (!btn) return;
    let count = 0;
    try { count = (await window.api.getDevices() || []).length; } catch { /* ignore */ }
    btn.disabled = count === 0;
    if (count === 0) btn.title = '연결된 디바이스가 없습니다';
    else if (count === 1) btn.title = '연결된 디바이스에 adb shell 새 탭 열기';
    else btn.title = '디바이스를 선택해 adb shell 새 탭 열기';
  },

  async handleDeviceShellClick() {
    let devices = [];
    try { devices = await window.api.getDevices() || []; } catch { /* ignore */ }
    if (devices.length === 0) {
      App.toast('연결된 디바이스가 없습니다', 'error');
      return;
    }
    if (devices.length === 1) {
      this.openDeviceShell(devices[0].serial);
      return;
    }
    // 여러 대 → 메뉴
    const aliases = (window.App && App.deviceAliases) || {};
    const items = ['<div class="menu-section">디바이스 선택</div>'];
    for (const d of devices) {
      const name = aliases[d.serial] || d.model || d.serial;
      items.push(`<div class="menu-item" data-serial="${d.serial}">
        <span class="menu-icon">📱</span>
        <span>${name}</span>
        <span class="menu-sub">${d.serial}</span>
      </div>`);
    }
    this.menuEl.innerHTML = items.join('');
    this.menuEl.style.display = 'block';
    this.menuEl.querySelectorAll('.menu-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.hideMenu();
        this.openDeviceShell(el.dataset.serial);
      });
    });
  },

  toggleMenu() {
    if (this.menuEl.style.display === 'none') this.showMenu();
    else this.hideMenu();
  },

  hideMenu() { this.menuEl.style.display = 'none'; },

  async showMenu() {
    const items = [];
    items.push('<div class="menu-section">셸</div>');
    for (const sh of this.shells) {
      items.push(`<div class="menu-item" data-action="shell" data-id="${sh.id}">
        <span class="menu-icon">▸</span>
        <span>${sh.label}</span>
        ${sh.default ? '<span class="menu-sub">기본</span>' : ''}
      </div>`);
    }

    let devices = [];
    try { devices = await window.api.getDevices(); } catch { /* ignore */ }
    if (devices.length) {
      const aliases = (window.App && App.deviceAliases) || {};
      items.push('<div class="menu-divider"></div>');
      items.push('<div class="menu-section">디바이스 셸 (adb shell)</div>');
      for (const d of devices) {
        const name = aliases[d.serial] || d.model || d.serial;
        items.push(`<div class="menu-item" data-action="device-shell" data-serial="${d.serial}">
          <span class="menu-icon">📱</span>
          <span>${name}</span>
          <span class="menu-sub">${d.serial}</span>
        </div>`);
      }
    }

    this.menuEl.innerHTML = items.join('');
    this.menuEl.style.display = 'block';

    this.menuEl.querySelectorAll('.menu-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.hideMenu();
        const action = el.dataset.action;
        if (action === 'shell') {
          const sh = this.shells.find((s) => s.id === el.dataset.id);
          if (sh) this.newTab({ shell: sh.shell, args: sh.args, label: sh.label });
        } else if (action === 'device-shell') {
          this.openDeviceShell(el.dataset.serial);
        }
      });
    });
  },

  async openDeviceShell(serial) {
    if (!serial) return App.toast('디바이스를 먼저 선택해주세요', 'error');
    const aliases = (window.App && App.deviceAliases) || {};
    const name = aliases[serial] || serial;
    await this.newTab({
      shell: this.adbPath || 'adb',
      args: ['-s', serial, 'shell'],
      label: `📱 ${name}`,
    });
  },

  _currentTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return isLight
      ? {
          background: '#ffffff',
          foreground: '#1f2233',
          cursor: '#1f2233',
          cursorAccent: '#ffffff',
          selectionBackground: '#cdd6f4',
          black: '#5c6370',
          red: '#d70000',
          green: '#2db400',
          yellow: '#a37e00',
          blue: '#1e66f5',
          magenta: '#a626a4',
          cyan: '#0184bc',
          white: '#3a3f4b',
          brightBlack: '#828791',
          brightRed: '#e85c5c',
          brightGreen: '#42c425',
          brightYellow: '#c79b00',
          brightBlue: '#4084ff',
          brightMagenta: '#c060be',
          brightCyan: '#36b3d9',
          brightWhite: '#1f2233',
        }
      : {
          background: '#11131c',
          foreground: '#cdd6f4',
          cursor: '#f5e0dc',
          cursorAccent: '#11131c',
          selectionBackground: '#45475a',
          black: '#45475a',
          red: '#f38ba8',
          green: '#a6e3a1',
          yellow: '#f9e2af',
          blue: '#89b4fa',
          magenta: '#cba6f7',
          cyan: '#94e2d5',
          white: '#bac2de',
          brightBlack: '#585b70',
          brightRed: '#f38ba8',
          brightGreen: '#a6e3a1',
          brightYellow: '#f9e2af',
          brightBlue: '#89b4fa',
          brightMagenta: '#cba6f7',
          brightCyan: '#94e2d5',
          brightWhite: '#a6adc8',
        };
  },

  async onShow() {
    if (!this.defaultShell && this.shells.length === 0) {
      try {
        this.shells = await window.api.terminal.listShells();
        this.defaultShell = this.shells.find((s) => s.default) || this.shells[0] || null;
      } catch { /* ignore */ }
    }
    if (this.tabs.length === 0) {
      const restored = await this._restoreSession();
      if (!restored) await this.newTab();
    } else {
      await this.active?.ensure();
    }
  },

  _saveSession() {
    if (this._restoring) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const data = {
          activeIndex: Math.max(0, this.tabs.indexOf(this.active)),
          tabs: this.tabs.map((t) => ({
            shell: t.spawnOpts?.shell || null,
            args: t.spawnOpts?.args || null,
            cwd: t.cwd || t.spawnOpts?.cwd || null,
            label: t.userLabel || null,
          })),
        };
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(data));
      } catch { /* ignore */ }
    }, 250);
  },

  async _restoreSession() {
    let data;
    try { data = JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); } catch { data = null; }
    if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) return false;
    this._restoring = true;
    try {
      for (const t of data.tabs) {
        await this.newTab({
          shell: t.shell || undefined,
          args: t.args || undefined,
          cwd: t.cwd || undefined,
          label: t.label || undefined,
        });
      }
      const idx = Math.min(Math.max(0, data.activeIndex || 0), this.tabs.length - 1);
      if (this.tabs[idx]) await this.activateTab(this.tabs[idx]);
    } finally {
      this._restoring = false;
    }
    this._saveSession();
    return true;
  },

  isActive(tab) {
    return this.active === tab;
  },

  async newTab(opts = {}) {
    if (!opts.shell && this.defaultShell) {
      opts = {
        shell: this.defaultShell.shell,
        args: this.defaultShell.args,
        label: this.defaultShell.label,
        ...opts,
      };
    }
    // cwd 가 없으면 현재 활성 탭의 cwd 를 상속 (VSCode 동작)
    if (!opts.cwd && this.active?.cwd) {
      opts.cwd = this.active.cwd;
    }
    // 라벨이 default 셸 라벨 그대로면 폴더명으로 자동 교체 (의미있게)
    if (opts.cwd && (!opts.label || opts.label === this.defaultShell?.label)) {
      const base = opts.cwd.split(/[\\/]/).filter(Boolean).pop();
      if (base) opts.label = base;
    }
    const tab = new TerminalTab(this, opts);
    this.tabs.push(tab);
    this.tabListEl.appendChild(tab.tabEl);
    this.stackEl.appendChild(tab.containerEl);
    await this.activateTab(tab);
    this._saveSession();
    return tab;
  },

  async activateTab(tab) {
    if (this.active === tab) {
      await tab.ensure();
      return;
    }
    if (this.active) {
      this.active.tabEl.classList.remove('active');
      this.active.containerEl.classList.remove('active');
    }
    this.active = tab;
    tab.tabEl.classList.add('active');
    tab.containerEl.classList.add('active');
    tab.clearDirty();
    await tab.ensure();
    this._refreshStatus();
    tab.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this._saveSession();
  },

  closeTab(tab) {
    const idx = this.tabs.indexOf(tab);
    if (idx < 0) return;
    const wasActive = this.active === tab;
    const lastCwd = tab.cwd || tab.spawnOpts?.cwd || null;
    tab.dispose();
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.active = null;
      this._refreshStatus();
      this._saveSession();
      this.newTab(lastCwd ? { cwd: lastCwd } : {});
      return;
    }
    if (wasActive) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.active = null;
      this.activateTab(next);
    }
    this._saveSession();
  },

  _refreshStatus() {
    if (!this.statusEl) return;
    this.statusEl.textContent = this.active?.statusText || '';
    this.statusEl.title = this.active?.statusText || '';
    if (this.cwdEl) {
      const cwd = this.active?.cwd || '—';
      this.cwdEl.textContent = cwd;
      this.cwdEl.title = cwd === '—' ? '' : `${cwd}\n(더블클릭: 복사)`;
    }
    const openBtn = document.getElementById('terminal-open-folder-btn');
    if (openBtn) openBtn.disabled = !this.active?.cwd;
    if (window.FileTreePanel) window.FileTreePanel.onTerminalCwdChanged(this.active?.cwd || null);
  },

  copySelection() {
    const t = this.active?.term;
    if (!t) return;
    const sel = t.getSelection();
    if (!sel) return;
    navigator.clipboard.writeText(sel).then(() => {
      t.clearSelection();
      t.focus();
    });
  },

  pasteFromClipboard() {
    const t = this.active?.term;
    if (!t || this.active.sessionId == null) return;
    navigator.clipboard.readText().then((text) => {
      if (text) window.api.terminal.write(this.active.sessionId, text);
      t.focus();
    });
  },

  showContextMenu(x, y) {
    this.contextMenuEl.style.display = 'block';
    // 화면 밖으로 나가지 않게 보정
    const rect = this.contextMenuEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 4;
    const maxY = window.innerHeight - rect.height - 4;
    this.contextMenuEl.style.left = Math.min(x, maxX) + 'px';
    this.contextMenuEl.style.top = Math.min(y, maxY) + 'px';
  },

  hideContextMenu() {
    this.contextMenuEl.style.display = 'none';
  },

  // 폰트 크기
  adjustFontSize(delta) {
    const next = Math.max(this.MIN_FONT, Math.min(this.MAX_FONT, this.fontSize + delta));
    if (next === this.fontSize) return;
    this.fontSize = next;
    localStorage.setItem('terminal-font-size', String(next));
    this.tabs.forEach((t) => {
      if (t.term) {
        try { t.term.options.fontSize = next; } catch { /* ignore */ }
      }
    });
    setTimeout(() => this.active?._refit(), 30);
  },

  resetFontSize() {
    this.fontSize = 13;
    localStorage.setItem('terminal-font-size', '13');
    this.tabs.forEach((t) => {
      if (t.term) try { t.term.options.fontSize = 13; } catch { /* ignore */ }
    });
    setTimeout(() => this.active?._refit(), 30);
  },

  // 검색
  openSearch() {
    if (!this.active?.search) return;
    this.searchEl.style.display = 'flex';
    this.searchInputEl.value = this.active.term.getSelection() || this.searchInputEl.value;
    this.searchInputEl.focus();
    this.searchInputEl.select();
    if (this.searchInputEl.value) this.searchFind(1, true);
  },

  closeSearch() {
    this.searchEl.style.display = 'none';
    this.searchCountEl.textContent = '';
    if (this.active?.search) {
      try { this.active.search.clearDecorations(); } catch { /* ignore */ }
    }
    this.active?.term?.focus();
  },

  searchFind(direction = 1, fromStart = false) {
    const tab = this.active;
    if (!tab) { this.searchCountEl.textContent = '탭 없음'; return; }
    if (!tab.search) { this.searchCountEl.textContent = '검색 모듈 없음'; console.warn('[Terminal] SearchAddon 미로드'); return; }
    const term = this.searchInputEl.value;
    if (!term) {
      this.searchCountEl.textContent = '';
      try { tab.search.clearDecorations(); } catch { /* ignore */ }
      return;
    }
    // decoration 결과 카운트 받기 위한 1회용 리스너
    if (!tab._searchResultsBound) {
      tab._searchResultsBound = true;
      try {
        tab.search.onDidChangeResults?.(({ resultIndex, resultCount }) => {
          if (resultCount === undefined) return;
          this.searchCountEl.textContent = resultCount > 0
            ? `${resultIndex + 1}/${resultCount}`
            : '없음';
        });
      } catch (e) { console.warn('[Terminal] onDidChangeResults 바인딩 실패', e); }
    }

    const opts = {
      regex: false,
      wholeWord: false,
      caseSensitive: false,
      incremental: fromStart,
      decorations: {
        matchBackground: '#ffd86b',
        matchBorder: '#ff9500',
        matchOverviewRuler: '#ffd86b',
        activeMatchBackground: '#ff9500',
        activeMatchBorder: '#ff5500',
        activeMatchColorOverviewRuler: '#ff5500',
      },
    };
    let found = false;
    try {
      found = (direction > 0)
        ? tab.search.findNext(term, opts)
        : tab.search.findPrevious(term, opts);
    } catch (e) {
      console.error('[Terminal] 검색 실패', e);
      this.searchCountEl.textContent = '오류';
      return;
    }
    if (!found) this.searchCountEl.textContent = '없음';
  },
};

window.TerminalPanel = TerminalPanel;
document.addEventListener('DOMContentLoaded', () => TerminalPanel.init());
