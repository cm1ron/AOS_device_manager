/* eslint-disable no-undef */
// 파일 트리 사이드바 (Terminal 패널 좌측)
// - lazy load: 폴더 펼칠 때만 자식 읽음
// - 우클릭 메뉴: Open Terminal Here / Open in Explorer / Open with VSCode|Cursor / Copy Path
// - 클릭: 파일=기본 앱으로 열기, 폴더=토글
// - Ctrl+클릭(파일): 감지된 에디터로 열기
// - 트리 루트는 활성 터미널 탭의 cwd 자동 추적, 직접 폴더 선택 가능
// - 사이드바 너비 드래그 조절(localStorage 저장)

const TREE_SVG = {
  folder: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/></svg>',
  folderOpen: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M1.5 12V4.5a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1V7"/><path d="M1.5 12l1.7-4.5h11.3L13 12z"/></svg>',
  file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M3.5 1.5h6L13 5v9.5a0 0 0 0 1 0 0H3.5z"/><path d="M9.5 1.5V5h3.5"/></svg>',
};

const FileTreePanel = {
  SVG: TREE_SVG,
  initialized: false,
  rootPath: null,
  showHidden: false,
  editors: [],
  // path -> {expanded:bool, children:Array, loaded:bool, error:string}
  state: new Map(),
  selectedPath: null,
  // 터미널 cwd 자동 추적 여부 (사용자가 수동으로 폴더 선택하면 false)
  followTerminalCwd: true,
  SESSION_KEY: 'tree.session.v1',
  _saveTimer: null,
  _restoring: false,

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    this.body = document.getElementById('tree-body');
    this.rootNameEl = document.getElementById('tree-root-name');
    this.rootPathEl = document.getElementById('tree-root-path');
    this.ctxMenu = document.getElementById('tree-context-menu');
    this.sidebar = document.getElementById('tree-sidebar');
    this.resizer = document.getElementById('tree-resizer');

    if (!this.body) return; // 패널 미존재 시 무시

    // 너비 복원
    const savedWidth = parseInt(localStorage.getItem('tree.sidebar.width') || '0', 10);
    if (savedWidth >= 160 && savedWidth <= 600 && this.sidebar) {
      this.sidebar.style.width = savedWidth + 'px';
    }
    const savedHidden = localStorage.getItem('tree.showHidden') === '1';
    this.showHidden = savedHidden;
    const hidBtn = document.getElementById('tree-toggle-hidden');
    if (hidBtn) hidBtn.classList.toggle('active', this.showHidden);

    document.getElementById('tree-pick-folder')?.addEventListener('click', () => this.pickFolder());
    document.getElementById('tree-refresh')?.addEventListener('click', () => this.refresh());
    document.getElementById('tree-collapse-all')?.addEventListener('click', () => this.collapseAll());
    hidBtn?.addEventListener('click', () => {
      this.showHidden = !this.showHidden;
      localStorage.setItem('tree.showHidden', this.showHidden ? '1' : '0');
      hidBtn.classList.toggle('active', this.showHidden);
      this.refresh();
    });

    this._initResizer();
    this._initBodyEvents();
    document.addEventListener('click', () => this.hideContextMenu());
    window.addEventListener('blur', () => this.hideContextMenu());

    try {
      this.editors = (await window.api.tree.listEditors()) || [];
    } catch { this.editors = []; }

    // 처음에는 루트가 없으니 안내 메시지
    this._renderEmpty();
    // 마지막 세션 복원 (있다면)
    await this._restoreSession();
  },

  _saveSession() {
    if (this._restoring) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const opened = [];
        for (const [k, v] of this.state.entries()) if (v.expanded) opened.push(k);
        const data = {
          rootPath: this.rootPath,
          followTerminalCwd: this.followTerminalCwd,
          opened,
        };
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(data));
      } catch { /* ignore */ }
    }, 250);
  },

  async _restoreSession() {
    let data;
    try { data = JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); } catch { data = null; }
    if (!data || !data.rootPath) return;
    this._restoring = true;
    try {
      this.followTerminalCwd = !!data.followTerminalCwd;
      await this.setRoot(data.rootPath, { fromTerminal: false });
      // 펼쳐둔 폴더들 복원 (루트 하위만)
      const opened = (data.opened || []).filter(p => p !== this.rootPath && p.startsWith(this.rootPath));
      // 짧은 경로(상위)부터 펼치기
      opened.sort((a, b) => a.length - b.length);
      for (const p of opened) {
        if (!this.state.has(p)) this.state.set(p, { expanded: false, children: null, loaded: false });
        const s = this.state.get(p);
        s.expanded = true;
        if (!s.loaded) await this._loadInto(p);
      }
      this._renderRoot();
    } finally {
      this._restoring = false;
    }
  },

  _initResizer() {
    if (!this.resizer || !this.sidebar) return;
    let dragging = false;
    let startX = 0;
    let startW = 0;
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      let w = startW + dx;
      if (w < 160) w = 160;
      if (w > 600) w = 600;
      this.sidebar.style.width = w + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      this.resizer.classList.remove('dragging');
      document.body.classList.remove('tree-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const w = parseInt(this.sidebar.style.width, 10);
      if (w) localStorage.setItem('tree.sidebar.width', String(w));
      // 터미널 fit
      window.dispatchEvent(new Event('resize'));
    };
    this.resizer.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = this.sidebar.getBoundingClientRect().width;
      this.resizer.classList.add('dragging');
      document.body.classList.add('tree-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  },

  _initBodyEvents() {
    this.body.addEventListener('click', (e) => {
      const node = e.target.closest('.tree-node');
      if (!node) return;
      const p = node.dataset.path;
      const isDir = node.dataset.dir === '1';
      this._setSelected(p);
      if (isDir) {
        this.toggleFolder(p);
      }
    });
    this.body.addEventListener('dblclick', (e) => {
      const node = e.target.closest('.tree-node');
      if (!node) return;
      const isDir = node.dataset.dir === '1';
      if (isDir) return; // 폴더는 싱글클릭으로 토글되므로 무시
      const p = node.dataset.path;
      if (e.ctrlKey || e.metaKey) {
        this.openWithEditor(p);
      } else {
        window.api.terminal.openFolder(p);
      }
    });
    this.body.addEventListener('contextmenu', (e) => {
      const node = e.target.closest('.tree-node');
      if (!node) return;
      e.preventDefault();
      const p = node.dataset.path;
      const isDir = node.dataset.dir === '1';
      this._setSelected(p);
      this.showContextMenu(e.clientX, e.clientY, p, isDir);
    });
  },

  _setSelected(p) {
    this.selectedPath = p;
    this.body.querySelectorAll('.tree-node.selected').forEach(n => n.classList.remove('selected'));
    const cur = this.body.querySelector(`.tree-node[data-path="${CSS.escape(p)}"]`);
    if (cur) cur.classList.add('selected');
  },

  _renderEmpty() {
    this.body.innerHTML = `<div class="tree-empty">폴더가 선택되지 않았습니다.<br><br>터미널 탭의 작업 폴더가 자동으로 표시됩니다.<br>또는 좌측 상단 📁 버튼으로 폴더를 직접 선택하세요.</div>`;
    if (this.rootNameEl) this.rootNameEl.textContent = 'EXPLORER';
    if (this.rootPathEl) this.rootPathEl.textContent = '—';
  },

  async onTerminalCwdChanged(cwd) {
    if (!this.initialized || !this.followTerminalCwd) return;
    if (!cwd || cwd === this.rootPath) return;
    await this.setRoot(cwd, { fromTerminal: true });
  },

  async pickFolder() {
    const p = await window.api.tree.pickFolder();
    if (!p) return;
    this.followTerminalCwd = false;
    await this.setRoot(p, { fromTerminal: false });
    // 새 폴더에 대응하는 터미널 탭을 자동으로 열어준다
    if (window.TerminalPanel) {
      try {
        const label = p.split(/[\\/]/).filter(Boolean).pop();
        await window.TerminalPanel.newTab({ cwd: p, label });
      } catch (e) { console.warn('[Tree] 터미널 자동 오픈 실패', e); }
    }
    this._saveSession();
  },

  async setRoot(p, opts = {}) {
    this.rootPath = p;
    this.state.clear();
    if (this.rootNameEl) {
      const base = p.split(/[\\/]/).filter(Boolean).pop() || p;
      this.rootNameEl.textContent = base.toUpperCase();
      this.rootNameEl.title = p;
    }
    if (this.rootPathEl) {
      this.rootPathEl.textContent = p;
      this.rootPathEl.title = p;
    }
    await this._loadInto(p);
    this._renderRoot();
    this._saveSession();
  },

  async refresh() {
    if (!this.rootPath) return;
    // 펼쳐진 폴더 경로들을 보존
    const opened = new Set();
    for (const [k, v] of this.state.entries()) if (v.expanded) opened.add(k);
    this.state.clear();
    await this._loadInto(this.rootPath);
    // 다시 펼치기
    for (const p of opened) {
      if (!this.state.has(p)) this.state.set(p, { expanded: false, children: null, loaded: false });
      const s = this.state.get(p);
      s.expanded = true;
      if (!s.loaded) await this._loadInto(p);
    }
    this._renderRoot();
  },

  collapseAll() {
    for (const v of this.state.values()) v.expanded = false;
    this._renderRoot();
    this._saveSession();
  },

  async _loadInto(p) {
    if (!this.state.has(p)) this.state.set(p, { expanded: p === this.rootPath, children: null, loaded: false });
    const s = this.state.get(p);
    s.loaded = false;
    s.error = null;
    try {
      const res = await window.api.tree.readDir(p, { showHidden: this.showHidden });
      if (res?.error) {
        s.error = res.error;
        s.children = [];
      } else {
        s.children = res.items || [];
      }
      s.loaded = true;
    } catch (e) {
      s.error = e.message || '읽기 실패';
      s.children = [];
      s.loaded = true;
    }
  },

  async toggleFolder(p) {
    if (!this.state.has(p)) this.state.set(p, { expanded: false, children: null, loaded: false });
    const s = this.state.get(p);
    s.expanded = !s.expanded;
    if (s.expanded && !s.loaded) {
      this._renderRoot(); // loading 표시
      await this._loadInto(p);
    }
    this._renderRoot();
    this._saveSession();
  },

  _renderRoot() {
    if (!this.rootPath) { this._renderEmpty(); return; }
    const s = this.state.get(this.rootPath);
    if (!s) { this.body.innerHTML = `<div class="tree-loading">로딩…</div>`; return; }
    const html = this._renderChildren(this.rootPath, 0);
    this.body.innerHTML = html || `<div class="tree-empty">(빈 폴더)</div>`;
  },

  _renderChildren(parentPath, depth) {
    const s = this.state.get(parentPath);
    if (!s) return '';
    if (!s.loaded) return `<div class="tree-loading" style="padding-left:${8 + depth * 14}px">로딩…</div>`;
    if (s.error) return `<div class="tree-error" style="padding-left:${8 + depth * 14}px">⚠ ${this._esc(s.error)}</div>`;
    if (!s.children?.length) return `<div class="tree-empty" style="padding-left:${8 + depth * 14}px">(비어 있음)</div>`;
    let out = '';
    for (const it of s.children) {
      out += this._renderNode(it, depth);
    }
    return out;
  },

  _renderNode(item, depth) {
    const indent = 4 + depth * 14;
    const childState = this.state.get(item.path);
    const expanded = !!(childState && childState.expanded);
    const caret = item.isDir
      ? `<span class="tree-caret ${expanded ? 'open' : ''}">▶</span>`
      : `<span class="tree-caret empty"></span>`;
    const icon = item.isDir
      ? `<span class="tree-icon tree-icon-folder ${expanded ? 'open' : ''}">${expanded ? FileTreePanel.SVG.folderOpen : FileTreePanel.SVG.folder}</span>`
      : `<span class="tree-icon tree-icon-file">${FileTreePanel.SVG.file}</span>`;
    const cls = ['tree-node'];
    if (item.heavy) cls.push('heavy');
    if (this.selectedPath === item.path) cls.push('selected');
    const node = `<div class="${cls.join(' ')}" data-path="${this._esc(item.path)}" data-dir="${item.isDir ? '1' : '0'}" style="padding-left:${indent}px" title="${this._esc(item.path)}">
      ${caret}${icon}<span class="tree-label">${this._esc(item.name)}</span>
    </div>`;
    let children = '';
    if (item.isDir && expanded) {
      children = `<div class="tree-children open">${this._renderChildren(item.path, depth + 1)}</div>`;
    }
    return node + children;
  },

  // (deprecated) ext별 이모지 — 더 이상 사용하지 않음. 통일된 SVG 파일 아이콘 사용

  _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  hideContextMenu() {
    if (this.ctxMenu) this.ctxMenu.style.display = 'none';
  },

  showContextMenu(x, y, p, isDir) {
    if (!this.ctxMenu) return;
    const items = [];
    if (isDir) {
      items.push({ label: '여기서 터미널 열기', sub: '', action: () => this.openTerminalHere(p) });
      items.push({ divider: true });
    } else {
      // editor entries
      for (const ed of this.editors) {
        items.push({ label: `${ed.label}로 열기`, sub: '', action: () => this.openWithEditor(p, ed.id) });
      }
      items.push({ label: '기본 앱으로 열기', sub: '', action: () => window.api.terminal.openFolder(p) });
      items.push({ divider: true });
    }
    items.push({ label: '탐색기에서 보기', sub: '', action: () => window.api.tree.showInFolder(p) });
    items.push({ label: '경로 복사', sub: '', action: () => this._copy(p) });
    items.push({ divider: true });
    items.push({ label: '새로 고침', sub: '', action: () => this.refresh() });

    this.ctxMenu.innerHTML = '';
    for (const it of items) {
      if (it.divider) {
        const d = document.createElement('div');
        d.className = 'menu-divider';
        this.ctxMenu.appendChild(d);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'menu-item';
      el.innerHTML = `<span>${this._esc(it.label)}</span>${it.sub ? `<span class="menu-sub">${this._esc(it.sub)}</span>` : ''}`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.hideContextMenu();
        try { it.action(); } catch (e) { console.error(e); }
      });
      this.ctxMenu.appendChild(el);
    }
    // 위치 결정 (화면 밖 보정)
    this.ctxMenu.style.display = 'block';
    this.ctxMenu.style.left = '0px';
    this.ctxMenu.style.top = '0px';
    const rect = this.ctxMenu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 4;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 4;
    this.ctxMenu.style.left = left + 'px';
    this.ctxMenu.style.top = top + 'px';
  },

  async openTerminalHere(folderPath) {
    if (!window.TerminalPanel) return;
    try {
      await window.TerminalPanel.newTab({ cwd: folderPath, label: folderPath.split(/[\\/]/).filter(Boolean).pop() });
    } catch (e) { console.error(e); }
  },

  openWithEditor(targetPath, preferId) {
    if (!this.editors.length) {
      if (window.App?.toast) window.App.toast('VSCode/Cursor를 찾을 수 없습니다', 'warning');
      return;
    }
    let ed = preferId ? this.editors.find(e => e.id === preferId) : null;
    if (!ed) ed = this.editors.find(e => e.id === 'cursor') || this.editors[0];
    window.api.tree.openWith(ed.command, targetPath);
  },

  _copy(text) {
    navigator.clipboard.writeText(text).then(() => {
      if (window.App?.toast) window.App.toast('경로가 복사되었습니다', 'info');
    }).catch(() => {});
  },
};

// 전역 노출 (terminal.js 가 호출)
window.FileTreePanel = FileTreePanel;

document.addEventListener('DOMContentLoaded', () => FileTreePanel.init());
